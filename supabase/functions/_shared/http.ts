// Shared Edge Function plumbing (Deno): the caller's RLS-scoped client, PT-style JSON errors, the Claude client.
// Logs carry codes and counts only — never names, record content, prompts or replies.
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

/** The model both functions use. */
export const MODEL = 'claude-sonnet-5-5';

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
export async function askClaude(
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
