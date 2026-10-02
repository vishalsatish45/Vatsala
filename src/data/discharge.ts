/**
 * The follow-up plan a completed discharge creates (PRD F-21, F-22): the hospital's standard postnatal / newborn
 * visits plus the templates of the clinician-set tags. Calendar arithmetic only — nothing here looks at a clinical
 * value. Shown as a preview before completing, then sent with `complete_discharge` (the server re-checks it).
 */
import { addDays, localDay } from '@domain/gestation';
import { POSTNATAL_STANDARD, TAG_TEMPLATES, type FollowUpDef } from '@domain/schedules';

import { TAGS } from './catalogue';
import type { DbState } from './store';
import type { SubjectId } from './types';

export type PlannedFollowUp = {
  key: string;
  kind: 'pn_visit' | 'nb_visit' | 'template';
  title: string;
  dueFrom: Date;
  dueBy: Date;
  templateKey?: string;
  /** Its window ended before the day of discharge: it cannot be scheduled (said plainly, never dropped silently). */
  closed: boolean;
};

/** Every follow-up the discharge of `subjectId` at `at` would plan, in date order — those already closed included. */
export function dischargePlan(db: Pick<DbState, 'discharges' | 'tags' | 'babies' | 'deliveries'>, subjectId: SubjectId, at: Date): PlannedFollowUp[] {
  const d = db.discharges.find((x) => x.subjectId === subjectId);
  if (!d) return [];
  const isBaby = d.subject === 'baby';
  const tagCodes = db.tags.filter((t) => t.subjectId === subjectId && !t.removedAt).map((t) => t.code);
  const defs: FollowUpDef[] = [
    ...POSTNATAL_STANDARD.filter((f) => f.subject === (isBaby ? 'baby' : 'mother')),
    ...tagCodes.flatMap((c) => {
      const tpl = TAGS.find((t) => t.code === c)?.template;
      return tpl ? (TAG_TEMPLATES[tpl] ?? []) : [];
    }),
  ];
  // Days count from the calendar day of the birth where the phone is (the server uses the hospital's day).
  const born = isBaby ? db.babies.find((b) => b.id === subjectId)?.dob : db.deliveries.find((x) => x.pregnancyId === subjectId)?.at;
  const origin = localDay(born ?? at);
  const today = localDay(at).getTime();
  return defs
    .map((f): PlannedFollowUp => {
      const template = f.key.startsWith('tpl');
      const dueBy = addDays(origin, f.dayTo);
      return {
        key: f.key,
        kind: template ? 'template' : isBaby ? 'nb_visit' : 'pn_visit',
        title: f.label,
        dueFrom: addDays(origin, f.dayFrom),
        dueBy,
        templateKey: template ? f.key : undefined,
        closed: dueBy.getTime() < today,
      };
    })
    .sort((a, b) => a.dueBy.getTime() - b.dueBy.getTime());
}
