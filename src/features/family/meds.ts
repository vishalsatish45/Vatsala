/**
 * Her prescribed medicines for the Family screens — the one list Home's "x/y doses taken" and the medicines view
 * share, so they never disagree. Pure (the caller says which mode it is in).
 */
import { medSlots } from '@/data/catalogue';
import type { DbState } from '@/data/store';
import type { CaregiverScopes, Mother, Pregnancy, PrescriptionId } from '@/data/types';

import { todayIso } from './stage';

export type FamilyMed = { name: string; id?: PrescriptionId; slots: ('morning' | 'afternoon' | 'night')[]; note: string };

type Who = { mother?: Pick<Mother, 'id'>; pregnancy?: Pick<Pregnancy, 'history'>; scopes: Pick<CaregiverScopes, 'logs'> };

/**
 * Supabase mode (`remote`): the prescriptions the clinician entered, with their times of day. Demo: documented
 * medicines with the catalogue's times. A caregiver needs the `logs` scope (as `family_medicines`).
 */
export function familyMedsFrom(db: Pick<DbState, 'prescriptions'>, who: Who, remote: boolean): FamilyMed[] {
  const mother = who.mother;
  if (!mother || !who.scopes.logs) return [];
  return remote
    ? db.prescriptions.filter((p) => p.motherId === mother.id).map((p) => ({ name: p.name, id: p.id, slots: p.slots, note: p.instructions ?? '' }))
    : (who.pregnancy?.history.medicines ?? []).map((name) => ({ name, ...medSlots(name) }));
}

/** Doses marked taken today (the phone's calendar day), out of today's doses. */
export function dosesToday(db: Pick<DbState, 'medDoses'>, motherId: string, meds: FamilyMed[], now: Date) {
  const today = todayIso(now);
  const total = meds.reduce((n, m) => n + m.slots.length, 0);
  const taken = meds.reduce(
    (n, m) => n + m.slots.filter((s) => db.medDoses.some((d) => d.motherId === motherId && d.med === m.name && d.date === today && d.slot === s && d.status === 'taken')).length,
    0,
  );
  return { taken, total };
}
