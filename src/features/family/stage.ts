/**
 * Where the family is in the care journey, decided once and used by every Family screen (Home, Journey, Learn,
 * Ask for a call, Warning signs, Record a reading, Emergency card). Pure: no React, no store.
 *
 * Only episode status and which babies the family can see go in — never a clinical value.
 */
import { localDay } from '@domain/gestation';

import type { SignStage } from '@/data/catalogue';
import type { CaregiverScopes, Pregnancy } from '@/data/types';

type Episode = Pick<Pregnancy, 'status' | 'endReason'> | undefined;

/** A birth happened: the episode is delivered, or the hospital has since closed a delivered episode. */
export const birthHappened = (p: Episode) => !!p && (p.status === 'delivered' || p.endReason === 'delivered');

/** Still pregnant: the only time week counters, EDD and "weeks to go" are shown. */
export const isPregnant = (p: Episode) => !!p && (p.status === 'active' || p.status === 'admitted');

/**
 * - `none`: no pregnancy on record for this account.
 * - `pregnant`: active or admitted.
 * - `baby`: a birth, and at least one living baby this account may see.
 * - `loss`: the pregnancy ended without a birth, or a birth with no living baby — gentle, neutral content only.
 * - `notShared`: a birth, but this caregiver may not see the babies — neutral content, nothing assumed.
 */
export type FamilyStage = 'none' | 'pregnant' | 'baby' | 'loss' | 'notShared';

export function familyStage(p: Episode, livingBabies: number, canSeeBabies: boolean): FamilyStage {
  if (!p) return 'none';
  if (isPregnant(p)) return 'pregnant';
  if (birthHappened(p)) {
    if (!canSeeBabies) return 'notShared';
    return livingBabies > 0 ? 'baby' : 'loss';
  }
  return 'loss';
}

/** Warning-sign groups offered in "Ask for a call": baby signs only with a living baby the family can see. */
export function requestSignStages(stage: FamilyStage): SignStage[] {
  if (stage === 'baby') return ['postnatal', 'baby'];
  if (stage === 'loss' || stage === 'notShared') return ['postnatal'];
  return ['pregnancy'];
}

/** Warning-sign groups offered for reading. After a loss (or when the babies are not shared) only her own. */
export function infoSignStages(stage: FamilyStage): SignStage[] {
  if (stage === 'loss' || stage === 'notShared') return ['postnatal'];
  return ['pregnancy', 'postnatal', 'baby'];
}

export type ReadingKind = 'bp' | 'weight' | 'movements' | 'contractions' | 'feeding';

/**
 * What this account may record (as `add_self_log` allows): her own readings need the `logs` scope, a feeding note
 * needs the `baby` scope and a living baby. Pregnancy-only kinds while pregnant.
 */
export function readingKinds(stage: FamilyStage, scopes: CaregiverScopes): ReadingKind[] {
  const mother: ReadingKind[] = stage === 'pregnant' || stage === 'none' ? ['bp', 'weight', 'movements', 'contractions'] : ['bp', 'weight'];
  return [...(scopes.logs ? mother : []), ...(stage === 'baby' && scopes.baby ? (['feeding'] as const) : [])];
}

/** Today's date as the `YYYY-MM-DD` the phone's calendar shows (never the UTC day, a day behind 00:00–05:30 IST). */
export const todayIso = (now: Date) => localDay(now).toISOString().slice(0, 10);

/** Whole days from one moment to another by the phone's calendar (a birth time, "now"). */
export const localDaysBetween = (from: Date, to: Date) => Math.round((localDay(to).getTime() - localDay(from).getTime()) / 86_400_000);
