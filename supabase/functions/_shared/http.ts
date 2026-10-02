// Shared Edge Function plumbing (Deno): the caller's RLS-scoped client, PT-style JSON errors, the AI model call
// (Gemini or Claude, by which key is set).
// Logs carry codes and counts only — never names, record content, prompts or replies.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

/** The Claude model both functions use when Claude is the provider. */
const MODEL = 'claude-sonnet-5-5';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** PT-style error body, the same shape the app already shows for refused RPCs. */
export function fail(fn: string, e: unknown): Response {
  if (e instanceof HttpError) {
    console.error(JSON.stringify({ fn, code: e.code, status: e.status }));
    return json(e.status, { code: e.code, message: e.message });
  }
  console.error(JSON.stringify({ fn, code: 'PT500', error: e instanceof Error ? e.name : 'unknown' }));
  return json(500, { code: 'PT500', message: 'Something went wrong. Try again.' });
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, 'PT500', `Server misconfigured: ${name} is not set`);
  return v;
}

/** Supabase client acting as the caller: every select and RPC runs under their JWT, so RLS applies. */
export async function callerClient(req: Request): Promise<SupabaseClient> {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) throw new HttpError(401, 'PT401', 'Sign in again.');
  const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(auth.slice('Bearer '.length));
  if (error || !data.user) throw new HttpError(401, 'PT401', 'Sign in again.');
  return db;
}

/** A PostgREST / RPC error → the same PT code and message (PT403/404/409/422 pass through). */
export function fromDb(error: { code?: string; message: string }): HttpError {
  const m = /^PT(\d{3})$/.exec(error.code ?? '');
  if (m) return new HttpError(Number(m[1]), error.code!, error.message);
  return new HttpError(502, 'PT502', 'The record could not be read. Try again.');
}

export async function readJson(req: Request, allowed: string[]): Promise<Record<string, unknown>> {
  if (req.method !== 'POST') throw new HttpError(405, 'PT405', 'Use POST');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(422, 'PT422', 'The request must be JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(422, 'PT422', 'The request must be an object');
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(422, 'PT422', `unexpected field(s) in request: ${extra.join(', ')}`);
  return body as Record<string, unknown>;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the functions send: text, or a file (photo / PDF of a paper card) as base64. */
export type ModelPart = { text: string } | { mime: string; base64: string };

/**
 * One structured-output request to the configured model; returns the parsed JSON object and the model that
 * answered. The provider follows the key that is set: GEMINI_API_KEY (model GEMINI_MODEL, default below) first,
 * else ANTHROPIC_API_KEY (Claude). The prompts, de-identification and citation filter are the same for both.
 */
export function askModel(system: string, parts: ModelPart[], schema: Record<string, unknown>): Promise<{ data: unknown; model: string }> {
  if (Deno.env.get('GEMINI_API_KEY')) return askGemini(system, parts, schema);
  if (Deno.env.get('ANTHROPIC_API_KEY')) {
    return askClaude(
      system,
      parts.map((p): Anthropic.Beta.Messages.BetaContentBlockParam =>
        'text' in p
          ? { type: 'text', text: p.text }
          : p.mime === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
            : { type: 'image', source: { type: 'base64', media_type: p.mime as 'image/jpeg', data: p.base64 } },
      ),
      schema,
    );
  }
  throw new HttpError(503, 'PT503', 'AI drafting is not set up on this server.');
}

/** Gemini default: a stable Flash model (ai.google.dev/gemini-api/docs/models); override with GEMINI_MODEL. */
const GEMINI_MODEL = 'gemini-3.5-flash';

type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
};

async function askGemini(system: string, parts: ModelPart[], schema: Record<string, unknown>): Promise<{ data: unknown; model: string }> {
  const model = Deno.env.get('GEMINI_MODEL') || GEMINI_MODEL;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.base64 } })) }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 8000, temperature: 0 },
  });
  let res: Response | undefined;
  // 60 s per attempt, one retry on a timeout, rate limit or server error — inside the Edge Function wall clock.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': requireEnv('GEMINI_API_KEY') },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt === 0) continue;
      if (e instanceof DOMException && e.name === 'TimeoutError') throw new HttpError(504, 'PT504', 'The AI took too long. Try again.');
      throw new HttpError(502, 'PT502', 'The AI could not be reached. Try again.');
    }
    if (res.ok || !(res.status === 429 || res.status >= 500) || attempt === 1) break;
    await res.body?.cancel();
  }
  if (!res) throw new HttpError(502, 'PT502', 'The AI could not be reached. Try again.');
  if (res.status === 429) throw new HttpError(503, 'PT503', 'The AI is busy. Try again in a minute.');
  if (!res.ok) {
    console.error(JSON.stringify({ fn: 'gemini', status: res.status }));
    throw new HttpError(502, 'PT502', 'The AI could not draft this now. Try again.');
  }
  const reply = (await res.json()) as GeminiReply;
  if (reply.promptFeedback?.blockReason) throw new HttpError(502, 'PT502', 'The AI declined to draft this. Write it by hand.');
  const c = reply.candidates?.[0];
  if (c?.finishReason === 'MAX_TOKENS') throw new HttpError(502, 'PT502', 'The AI reply was cut short. Try again.');
  if (c?.finishReason && c.finishReason !== 'STOP') throw new HttpError(502, 'PT502', 'The AI declined to draft this. Write it by hand.');
  const text = (c?.content?.parts ?? []).flatMap((p) => (p.text && !p.thought ? [p.text] : [])).join('');
  try {
    return { data: JSON.parse(text), model: reply.modelVersion || model };
  } catch {
    throw new HttpError(502, 'PT502', 'The AI reply could not be read. Try again.');
  }
}

let anthropic: Anthropic | undefined;
function claude(): Anthropic {
  // 60 s per attempt, one retry: the whole call stays well inside the Edge Function wall-clock limit.
  anthropic ??= new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), timeout: 60_000, maxRetries: 1 });
  return anthropic;
}

/**
 * One structured-output request to Claude. Returns the parsed JSON object and the model that answered.
 * Server-side fallback ("default") is on: if a safety classifier declines, the API retries on its recommended
 * fallback model in the same call, and `model` reports which one answered.
 */
async function askClaude(
  system: string,
  content: Anthropic.Beta.Messages.BetaContentBlockParam[] | string,
  schema: Record<string, unknown>,
): Promise<{ data: unknown; model: string }> {
  let res: Anthropic.Beta.Messages.BetaMessage;
  try {
    res = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'PT504', 'The AI took too long. Try again.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'PT503', 'The AI is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'PT502', 'The AI could not be reached. Try again.');
    if (e instanceof Anthropic.APIError) {
      console.error(JSON.stringify({ fn: 'claude', status: e.status, type: e.name }));
      throw new HttpError(502, 'PT502', 'The AI could not draft this now. Try again.');
    }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new HttpError(502, 'PT502', 'The AI declined to draft this. Write it by hand.');
  if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'PT502', 'The AI reply was cut short. Try again.');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  try {
    return { data: JSON.parse(text), model: res.model };
  } catch {
    throw new HttpError(502, 'PT502', 'The AI reply could not be read. Try again.');
  }
}
