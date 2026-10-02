/**
 * The Family face's "Ask" assistant (Supabase mode only). Mock mode is handled by the UI.
 *
 *  askFamily → Edge Function `family-ask`: answers from her own record (as her consent and caregiver scopes allow)
 *  and from the education cards the app sends; anything else is "can't advise — ask the hospital to call you",
 *  and warning signs always get "go to the hospital now or call 108".
 *
 * The response is parsed with a strict Zod object. Refusals arrive as AiError with the
 * server's PT code: PT403 not a family user, PT404 no consent, PT422 bad input, PT429 asked too often, PT502/503/504
 * the AI failed, was busy or timed out.
 */
import { z } from 'zod';

import { invoke } from './remote';

export { AiError } from './remote';

export type AskTopic = { id: string; title: string; text: string };

const familyAnswer = z.strictObject({
  answer: z.string().min(1).max(700),
  kind: z.enum(['record', 'education', 'refer', 'urgent']),
  /** Topic ids used and / or record kinds: 'visits' | 'tests' | 'medicines' | 'vaccines' | 'appointments' | 'hospital'. */
  sources: z.array(z.string().min(1)),
  /** The model that answered; null when none was asked (warning sign, nothing in her record). */
  model: z.string().min(1).nullable(),
});
export type FamilyAnswer = z.infer<typeof familyAnswer>;

/** Ask a question (1–500 characters) with up to 40 education cards (id ≤ 60, title ≤ 120, text ≤ 800). */
export async function askFamily(question: string, topics: AskTopic[]): Promise<FamilyAnswer> {
  return invoke(
    'family-ask',
    { question, topics: topics.map((t) => ({ id: t.id, title: t.title, text: t.text })) },
    familyAnswer,
  );
}
