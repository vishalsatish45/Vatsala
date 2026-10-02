/**
 * Server AI drafts (Supabase mode only; PRD F-27, F-31). Mock mode keeps the on-device brief
 * (./brief.ts) and the demo transcription.
 *
 *  - requestBrief  → Edge Function `ai-brief`: de-identified, cited draft saved as 'unverified'.
 *  - verifyDraft   → RPC `verify_ai_draft`: the clinician verifies (→ an 'ai_verified' care note) or discards.
 *  - transcribe    → Edge Function `capture-transcribe`: ANC-card fields as written, every one unconfirmed.
 *
 * Every response is parsed with a strict Zod object: an unknown key or wrong type is a
 * contract defect and fails loudly.
 */
import { randomUUID } from 'expo-crypto';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';

import { supabase } from '@/lib/supabase';

import type { CaptureField } from '@/data/types';

export type DraftKind = 'brief' | 'handoff' | 'discharge';
export type AiSubject = { pregnancyId: string } | { babyId: string };

const sourceKind = z.enum([
  'registration', 'baby', 'delivery', 'visit', 'test', 'referral', 'tag', 'task', 'callback', 'selflog', 'note',
  'medication', 'vaccine', 'discharge',
]);
export type DraftSourceKind = z.infer<typeof sourceKind>;

const sentence = z.strictObject({
  text: z.string().min(1),
  sources: z.array(z.strictObject({ kind: sourceKind, id: z.guid() })).min(1),
});
export type DraftSentence = z.infer<typeof sentence>;

const draft = z.strictObject({
  id: z.guid(),
  kind: z.enum(['brief', 'handoff', 'discharge']),
  status: z.literal('unverified'),
  engine: z.enum(['claude', 'gemini']),
  model: z.string().min(1),
  generated_at: z.string(),
  content: z.array(sentence).min(1),
});
export type Draft = z.infer<typeof draft>;

const briefResponse = z.strictObject({ draft, dropped: z.number().int().min(0) });
const verifyResponse = z.strictObject({ id: z.guid(), status: z.enum(['verified', 'discarded']), note_id: z.guid().nullable() });
const captureResponse = z.strictObject({
  document_id: z.guid(),
  fields: z.array(z.strictObject({ key: z.string(), label: z.string(), value: z.string(), confidence: z.number().min(0).max(1), confirmed: z.literal(false) })),
});
const errorBody = z.strictObject({ code: z.string(), message: z.string() });

/** A refused or failed AI call, with the server's PT code (PT403 role, PT404 not visible, PT409 done, PT5xx AI). */
export class AiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AiError(`Contract mismatch in ${what}: ${z.prettifyError(r.error)}`, 'contract');
  return r.data;
}

/** Calls an Edge Function and parses its reply strictly; a refusal becomes an AiError with the server's PT code. */
export async function invoke<S extends z.ZodType>(fn: string, body: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
  const { data, error } = await supabase().functions.invoke(fn, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      const parsed = errorBody.safeParse(await res.json().catch(() => null));
      if (parsed.success) throw new AiError(parsed.data.message, parsed.data.code);
    }
    throw new AiError('The AI service could not be reached. Check the connection and try again.', 'network');
  }
  return parse(schema, data, fn);
}

/** Ask the server for a cited draft of this record. `today` is the app's clock (demo time travel). */
export async function requestBrief(subject: AiSubject, kind: DraftKind, today?: Date): Promise<{ draft: Draft; dropped: number }> {
  return invoke(
    'ai-brief',
    {
      ...('pregnancyId' in subject ? { pregnancy_id: subject.pregnancyId } : { baby_id: subject.babyId }),
      kind,
      ...(today ? { today: today.toISOString().slice(0, 10) } : {}),
    },
    briefResponse,
  );
}

export type DraftEdits = {
  /** Positions (0-based) of sentences the clinician left out of the note. */
  exclude?: number[];
  /** Discard instead of verifying; nothing is saved to the record. */
  discard?: boolean;
  /** One key per user intent, so a retried tap is applied once. */
  idempotencyKey?: string;
  /** The app's clock (demo time travel); the server ignores it outside demo mode. */
  at?: Date;
};

/** Verify (→ one 'ai_verified' care note) or discard a draft. */
export async function verifyDraft(draftId: string, edits: DraftEdits = {}): Promise<z.infer<typeof verifyResponse>> {
  const p: Record<string, unknown> = {
    idempotency_key: edits.idempotencyKey ?? randomUUID(),
    id: draftId,
    action: edits.discard ? 'discard' : 'verify',
  };
  if (!edits.discard) {
    if (edits.exclude?.length) p.exclude = edits.exclude;
    if (edits.at) p.at = edits.at.toISOString();
  }
  const { data, error } = await supabase().rpc('verify_ai_draft', { p });
  if (error) throw new AiError(error.message, error.code ?? 'error');
  return parse(verifyResponse, data, 'verify_ai_draft');
}

/** Transcribe an uploaded paper record. Returns draft fields for the capture screen, every one unconfirmed. */
export async function transcribe(documentId: string): Promise<CaptureField[]> {
  const res = await invoke('capture-transcribe', { document_id: documentId }, captureResponse);
  return res.fields.map((f) => ({ key: f.key, label: f.label, value: f.value, confidence: f.confidence, confirmed: false }));
}
