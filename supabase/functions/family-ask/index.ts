// family-ask (the Family face's "Ask" assistant). POST { question, topics? }
//   question  1–500 characters after trimming
//   topics    ≤ 40 education cards the app shows (Learn / diet / exercise): { id ≤ 60, title ≤ 120, text ≤ 800 }
// → 200 { answer, kind: 'record'|'education'|'refer'|'urgent', sources: string[], model: string|null }
//
//  1. Only a family user (the mother, or a caregiver acting for her) may ask: whoami + family_context under the
//     caller's JWT, so consent and caregiver scopes apply exactly as on the Family screens. Staff → PT403.
//  2. Warning signs are detected here, before anything else is spent: the reply is only "go to the hospital now
//     or call 108" (no model call, no quota).
//  3. family_ai_quota counts the call (per user and project-wide caps, PT429).
//  4. Her record is read through the same family read functions the app uses (schedule; tests and medicines only
//     when her scopes allow) and turned into short de-identified facts (no names, phones, ids, addresses, result
//     values) — supabase/functions/_shared/family.ts.
//  5. The model answers from those facts and the cards only; checkAnswer replaces anything interpretive, advisory,
//     identifying or uncited with the fixed "can't advise — ask the hospital to call you" reply.
// Logs carry codes and counts only — never the question or the answer.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

import {
  EMPTY_ANSWER, FAMILY_SCHEMA, FAMILY_SYSTEM, URGENT_ANSWER, factsFromFamily, familyPrompt, finalizeAnswer, parseAsk, urgentReason,
  type FamilyPayload,
} from '../_shared/family.ts';
import { HttpError, askModel, callerClient, fail, fromDb, json, readJson } from '../_shared/http.ts';

const FN = 'family-ask';

async function rpc<T>(db: SupabaseClient, fn: string, p?: Record<string, unknown>): Promise<T> {
  const { data, error } = p === undefined ? await db.rpc(fn) : await db.rpc(fn, { p });
  if (error) throw fromDb(error);
  return data as T;
}

type WhoAmI = {
  mother: { mother_id: string } | null;
  caregiving: { mother_id: string; consented: boolean }[] | null;
};
type Context = FamilyPayload['context'] & { scopes: { schedule: boolean; baby: boolean; logs: boolean; tests: boolean } };

/** The mother this caller acts for and her context (PT403 for anyone who is not family; PT404 without consent). */
async function familyContext(db: SupabaseClient): Promise<{ ctx: Context; forMother: Record<string, unknown> }> {
  const me = await rpc<WhoAmI>(db, 'whoami');
  if (me.mother) return { ctx: await rpc<Context>(db, 'family_context', {}), forMother: {} };
  const caring = [...(me.caregiving ?? [])].sort((a, b) => Number(b.consented) - Number(a.consented));
  if (!caring.length) throw new HttpError(403, 'PT403', 'Ask is for mothers and their families.');
  // A caregiver of more than one mother: the first one whose record she may open (consent + sharing).
  let last: unknown;
  for (const c of caring) {
    const forMother = { mother_id: c.mother_id };
    try {
      return { ctx: await rpc<Context>(db, 'family_context', forMother), forMother };
    } catch (e) {
      last = e;
      if (!(e instanceof HttpError && e.code === 'PT404')) throw e;
    }
  }
  throw last;
}

const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  try {
    const body = await readJson(req, ['question', 'topics']);
    const parsed = parseAsk(body);
    if ('error' in parsed) throw new HttpError(422, 'PT422', parsed.error);
    const { question, topics } = parsed;

    const db = await callerClient(req);
    const { ctx, forMother } = await familyContext(db);

    if (urgentReason(question)) {
      console.log(JSON.stringify({ fn: FN, kind: 'urgent', model: false }));
      return json(200, { answer: URGENT_ANSWER, kind: 'urgent', sources: [], model: null });
    }

    const { error: quotaError } = await db.rpc('family_ai_quota', { p: { fn: FN } });
    if (quotaError) throw fromDb(quotaError);

    const [schedule, tests, medicines] = await Promise.all([
      rpc<FamilyPayload['schedule']>(db, 'family_schedule', forMother),
      ctx.scopes.tests ? rpc<FamilyPayload['tests']>(db, 'family_tests', forMother) : Promise.resolve(null),
      ctx.scopes.logs ? rpc<FamilyPayload['medicines']>(db, 'family_medicines', forMother) : Promise.resolve(null),
    ]);
    const today = indiaToday();
    const { facts, refs, known } = factsFromFamily({ today, context: ctx, schedule, tests, medicines });

    if (!facts.length && !topics.length) {
      console.log(JSON.stringify({ fn: FN, kind: 'refer', facts: 0, topics: 0, model: false }));
      return json(200, { answer: EMPTY_ANSWER, kind: 'refer', sources: [], model: null });
    }

    const { data, model } = await askModel(FAMILY_SYSTEM, [{ text: familyPrompt(today, ctx.role, facts, topics, question) }], FAMILY_SCHEMA);
    const reply = finalizeAnswer(data, { refs, facts, topics, known });
    console.log(JSON.stringify({ fn: FN, kind: reply.kind, facts: facts.length, topics: topics.length, sources: reply.sources.length, blocked: reply.blocked }));
    return json(200, { answer: reply.answer, kind: reply.kind, sources: reply.sources, model });
  } catch (e) {
    return fail(FN, e);
  }
});
