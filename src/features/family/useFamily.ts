import { daysBetween, localDay } from '@domain/gestation';
import { GRACE_DAYS, taskStatus, type TaskStatus } from '@domain/schedules';

import type { DbState } from '@/data/store';
import { useDb } from '@/data/store';
import type { Baby, Caregiver, CaregiverScopes, Mother, Pregnancy, SubjectId } from '@/data/types';
import { useSession } from '@/state/session';

import { familyStage, type FamilyStage } from './stage';

export type FamilyContext = {
  mother?: Mother;
  pregnancy?: Pregnancy;
  babies: Baby[];
  isCaregiver: boolean;
  caregiver?: Caregiver;
  /** A caregiver whose access the mother removed: every Family screen gives way to "no longer shared". */
  revoked: boolean;
  /** Pregnant / baby / loss / not shared — see `familyStage`. */
  stage: FamilyStage;
  scopes: CaregiverScopes;
  accountName: string;
  accountId: string;
};

const ALL: CaregiverScopes = { schedule: true, baby: true, logs: true, tests: true };
const NONE: CaregiverScopes = { schedule: false, baby: false, logs: false, tests: false };

/** Resolves the signed-in Family account to the mother it belongs to (mother or consented caregiver). */
export function useFamily(): FamilyContext {
  const account = useSession((s) => s.account);
  const db = useDb();
  const isCaregiver = account?.family?.role === 'caregiver';
  // Supabase mode knows the mother's id; the demo directory matches by name / phone.
  const motherId = account?.family?.motherId;
  const mother = motherId
    ? db.mothers.find((m) => m.id === motherId)
    : isCaregiver
      ? db.mothers.find((m) => m.name === account?.family?.motherName)
      : db.mothers.find((m) => m.phone === account?.phone);
  const pregnancy = mother ? db.pregnancies.filter((p) => p.motherId === mother.id).sort((a, b) => b.registeredOn.getTime() - a.registeredOn.getTime())[0] : undefined;
  const caregiver = isCaregiver ? db.caregivers.find((c) => c.phone === account?.phone && c.motherId === mother?.id && !c.revokedAt) : undefined;
  // Only once her record is loaded: before that a caregiver is simply not resolved yet.
  const revoked = isCaregiver && !!mother && !caregiver;
  const scopes = isCaregiver ? (caregiver?.scopes ?? NONE) : ALL;
  // Living babies only (no stillborn baby, no baby who has died).
  const babies = mother ? db.babies.filter((b) => b.motherId === mother.id && b.outcome === 'live' && !b.deceasedAt) : [];
  return {
    mother,
    pregnancy,
    babies,
    isCaregiver,
    caregiver,
    revoked,
    stage: familyStage(pregnancy, babies.length, scopes.baby),
    scopes,
    accountName: account?.name ?? '',
    accountId: account?.id ?? '',
  };
}

export type FamilyItem = {
  id: string;
  kind: 'visit' | 'test' | 'referral' | 'postnatal' | 'baby' | 'vaccine';
  subject: 'mother' | 'baby';
  /** i18n key + params for the title. */
  titleKey: string;
  titleParams?: Record<string, string>;
  date: Date;
  dueBy?: Date;
  /** Where, as the hospital entered it (shown as is). */
  place?: string;
  /** Where, when the hospital entered nothing: an i18n key (`family.place.*`). Read both through `itemPlace`. */
  placeKey?: string;
  status: TaskStatus;
  bring: string[];
  prep: string[];
  taskId?: string;
};

const TEST_KEYS = ['ogtt', 'hb1', 'hb2', 'hb3', 'anomaly', 'dating', 'bg', 'urine', 'rbs', 'tsh', 'ict'];

/**
 * Everything upcoming for the family, in plain terms (FH-10). Sensitive tests are never
 * included; statuses are date-based only.
 */
export function familyItems(db: DbState, ctx: FamilyContext, now: Date): FamilyItem[] {
  const out: FamilyItem[] = [];
  const p = ctx.pregnancy;
  if (!p) return out;
  const grace = GRACE_DAYS[p.intensity];
  // Statuses by the phone's calendar day (the UTC day is a day behind between 00:00 and 05:30 IST).
  const today = localDay(now);
  const babyIds = new Set<SubjectId>(ctx.babies.map((b) => b.id));

  for (const t of db.tasks.filter((x) => (x.subjectId === p.id || babyIds.has(x.subjectId)) && !x.completedAt && !x.cancelledAt)) {
    const st = taskStatus({ dueFrom: t.dueFrom, dueBy: t.dueBy, completed: false }, today, grace);
    if (daysBetween(today, t.dueBy) > 60) continue;
    const isBaby = babyIds.has(t.subjectId);
    if (isBaby && !ctx.scopes.baby) continue;
    if (!isBaby && !ctx.scopes.schedule) continue;
    const ref = t.kind === 'referral_appt' ? db.referrals.find((r) => r.id === t.refId) : undefined;
    out.push({
      id: t.id,
      taskId: t.id,
      kind: t.kind === 'anc_visit' ? 'visit' : t.kind === 'referral_appt' ? 'referral' : isBaby ? 'baby' : 'postnatal',
      subject: isBaby ? 'baby' : 'mother',
      titleKey: t.kind === 'anc_visit' ? 'family.task.anc' : t.kind === 'referral_appt' ? 'family.task.referral' : isBaby ? 'family.task.nb' : 'family.task.pn',
      // A family never sees the referral itself; the appointment's title names the department.
      titleParams: t.kind === 'referral_appt' ? { dept: ref?.department ?? t.title.replace(/ appointment$/, '') } : undefined,
      date: t.kind === 'anc_visit' ? withTime(t.dueBy, 10) : t.dueBy,
      place: t.place ?? ref?.place,
      placeKey: t.kind === 'anc_visit' ? 'family.place.opdB' : 'family.place.opd',
      status: st,
      bring: ['family.prep.bring'],
      prep: [],
    });
  }

  if (ctx.scopes.schedule && p.status === 'active') {
    for (const i of db.investigations.filter((x) => x.subjectId === p.id && !x.sensitive && (x.status === 'due' || x.status === 'ordered'))) {
      if (daysBetween(today, i.dueFrom) > 21) continue;
      const st = taskStatus({ dueFrom: i.dueFrom, dueBy: i.dueBy, completed: false }, today, Infinity);
      out.push({
        id: i.id,
        kind: 'test',
        subject: 'mother',
        titleKey: TEST_KEYS.includes(i.code) ? `family.tests.${i.code}` : 'family.task.test',
        titleParams: { name: i.label },
        date: i.dueFrom.getTime() > today.getTime() ? i.dueFrom : today,
        dueBy: i.dueBy,
        placeKey: testPlaceKey(i.kind),
        status: st,
        bring: ['family.prep.bring'],
        prep: i.code === 'ogtt' ? ['family.prep.fasting'] : [],
      });
    }
  }

  if (ctx.scopes.baby) {
    for (const im of db.immunizations.filter((x) => babyIds.has(x.babyId) && !x.givenOn && x.notGivenReason === undefined)) {
      if (daysBetween(today, im.dueOn) > 45) continue;
      const st = taskStatus({ dueFrom: im.dueOn, dueBy: im.dueOn, completed: false }, today, 7);
      out.push({ id: im.id, kind: 'vaccine', subject: 'baby', titleKey: 'family.task.vaccine', titleParams: { name: im.label }, date: im.dueOn, placeKey: 'family.place.immunization', status: st === 'missed' ? 'overdue' : st, bring: ['family.prep.bringBaby'], prep: [] });
    }
  }

  const order: Record<TaskStatus, number> = { missed: 0, overdue: 1, due: 2, upcoming: 3, done: 4 };
  return out.sort((a, b) => order[a.status] - order[b.status] || a.date.getTime() - b.date.getTime());
}

/**
 * Home before the birth (FH-01): the next step, plus her next test and her next ANC visit when either is not already
 * that step — so a test never hides the visit after it, and the other way round. Earliest first (a missed item has
 * the earliest date, so it stays on top); ties keep the `familyItems` order. Takes `familyItems` output, so scopes
 * and missed statuses are already applied.
 */
export function homeNextItems(items: FamilyItem[]): FamilyItem[] {
  const next = items[0];
  if (!next) return [];
  const test = items.find((i) => i.kind === 'test');
  const visit = items.find((i) => i.kind === 'visit');
  const picked = items.filter((i) => i === next || i === test || i === visit);
  return picked.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Where a test is done, when the hospital entered nothing (i18n key). */
export const testPlaceKey = (kind: 'lab' | 'scan') => (kind === 'scan' ? 'family.place.radiology' : 'family.place.lab');

function withTime(d: Date, h: number) {
  const x = new Date(d);
  x.setHours(h, 0, 0, 0);
  return x;
}
