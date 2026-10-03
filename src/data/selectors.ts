/**
 * Read models derived from the store (PRD §11.3 views). Operational only: statuses come
 * from dates and completion — never from clinical values (PRD §2.2).
 */
import { addDays, daysBetween, formatGA, gestationalAge } from '@domain/gestation';
import { GRACE_DAYS, taskStatus, type TaskStatus } from '@domain/schedules';

import type { DbState } from './store';
import { REFERRAL_ENDED, type Baby, type Intensity, type Investigation, type Pregnancy, type Referral, type SubjectId, type Task, type TeamId, type Visit } from './types';

// ── helpers ─────────────────────────────────────────────────────────────────────

export function ago(from: Date, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export const fmtDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = (d: Date) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

export const motherOf = (db: DbState, motherId: string) => db.mothers.find((m) => m.id === motherId)!;

/**
 * A mother's current pregnancy: the ongoing one (active or admitted; the latest registered if ever two), else her
 * latest registered episode. A returning mother has several pregnancies; anything shown "for her" uses this one.
 */
export function currentPregnancy(db: Pick<DbState, 'pregnancies'>, motherId: string): Pregnancy | undefined {
  const mine = db.pregnancies.filter((p) => p.motherId === motherId).sort((a, b) => b.registeredOn.getTime() - a.registeredOn.getTime());
  return mine.find((p) => p.status === 'active' || p.status === 'admitted') ?? mine[0];
}

const REFERRAL_LABEL: Record<Referral['status'], string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  seen: 'Seen',
  recommendations: 'Recommendations',
  closed: 'Closed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
/** A referral status as shown ("Cancelled" stays distinct from an answered, closed referral). */
export const referralStatusLabel = (s: Referral['status']) => REFERRAL_LABEL[s];

/** Still open: not closed, declined or cancelled. */
export const referralOpen = (r: Pick<Referral, 'status'>) => !REFERRAL_ENDED.includes(r.status);
export const activeTags = (db: DbState, subjectId: string) => db.tags.filter((t) => t.subjectId === subjectId && !t.removedAt);

/** Shown wherever a gestational age would be, until the doctor records the dating. */
export const DATING_NOT_RECORDED = 'Dating not recorded';

export function gaLabel(p: Pick<Pregnancy, 'edd'>, now: Date) {
  return p.edd ? `${formatGA(gestationalAge(p.edd, now))} weeks` : DATING_NOT_RECORDED;
}

/** Days from `now` to the EDD; undefined while undated (an undated pregnancy is never "due soon"). */
export const daysToEdd = (p: Pick<Pregnancy, 'edd'>, now: Date) => (p.edd ? daysBetween(now, p.edd) : undefined);

/** Sorts dated pregnancies by EDD, undated ones last. */
export const byEdd = (a: Pick<Pregnancy, 'edd'>, b: Pick<Pregnancy, 'edd'>) => (a.edd?.getTime() ?? Infinity) - (b.edd?.getTime() ?? Infinity);

export function babyAgeLabel(b: Baby, now: Date) {
  const d = daysBetween(b.dob, now);
  if (d < 14) return `Day ${d}`;
  if (d < 91) return `${Math.floor(d / 7)} weeks`;
  return `${Math.floor(d / 30.4)} months`;
}

function intensityOfSubject(db: DbState, t: Task): Intensity {
  if (t.subjectType === 'baby') return db.babies.find((b) => b.id === t.subjectId)?.intensity ?? 'routine';
  return db.pregnancies.find((p) => p.id === t.subjectId)?.intensity ?? 'routine';
}

export function taskState(db: DbState, t: Task, now: Date): TaskStatus {
  if (t.cancelledAt) return 'done';
  return taskStatus({ dueFrom: t.dueFrom, dueBy: t.dueBy, completed: !!t.completedAt }, now, GRACE_DAYS[intensityOfSubject(db, t)]);
}

/** Investigation status for display. "resulted" = awaiting clinician review. */
export function invState(i: Investigation, now: Date): { status: TaskStatus; label: string } {
  if (i.status === 'reviewed') return { status: 'done', label: 'Reviewed' };
  if (i.status === 'not_done') return { status: 'done', label: `Not done · ${i.notDoneReason ?? ''}` };
  if (i.status === 'resulted') return { status: 'due', label: 'Awaiting review' };
  const s = taskStatus({ dueFrom: i.dueFrom, dueBy: i.dueBy, completed: false }, now, Infinity);
  const ordered = i.status === 'ordered' ? 'Ordered · ' : '';
  if (s === 'upcoming') return { status: 'upcoming', label: `${ordered}From ${fmtDate(i.dueFrom)}` };
  if (s === 'due') return { status: 'due', label: `${ordered}Due by ${fmtDate(i.dueBy)}${i.late ? ' (late registration)' : ''}` };
  return { status: 'overdue', label: `${ordered}Window closed ${fmtDate(i.dueBy)}` };
}

const lastEventAt = (r: Referral) => r.events[r.events.length - 1]!.at;

export function referralStale(r: Referral, now: Date) {
  if (!referralOpen(r) || r.status === 'recommendations') return false;
  const limitH = r.urgency === 'routine' ? 72 : 24;
  return now.getTime() - lastEventAt(r).getTime() > limitH * 3_600_000;
}

// ── Patient (pregnancy) view ────────────────────────────────────────────────────

export type DueItem = {
  key: string;
  kind: 'visit' | 'investigation' | 'result' | 'referral' | 'checklist';
  label: string;
  detail: string;
  status: TaskStatus;
  refId: string;
};

/** "Still due" panel (F-12): care gaps for this pregnancy right now. */
export function stillDue(db: DbState, p: Pregnancy, now: Date): DueItem[] {
  const items: DueItem[] = [];
  for (const t of db.tasks.filter((x) => x.subjectId === p.id && !x.completedAt && !x.cancelledAt)) {
    const st = taskState(db, t, now);
    if (st === 'overdue' || st === 'missed' || (st === 'due' && daysBetween(now, t.dueBy) <= 0)) {
      items.push({ key: t.id, kind: 'visit', label: t.title, detail: st === 'missed' ? `Missed · due ${fmtDate(t.dueBy)}` : `Due ${fmtDate(t.dueBy)}`, status: st, refId: t.id });
    }
  }
  for (const i of db.investigations.filter((x) => x.subjectId === p.id)) {
    const s = invState(i, now);
    if (i.status === 'resulted') items.push({ key: i.id, kind: 'result', label: `${i.label} result`, detail: 'Awaiting your review', status: 'due', refId: i.id });
    else if ((i.status === 'due' || i.status === 'ordered') && (s.status === 'overdue' || (s.status === 'due' && daysBetween(now, i.dueBy) <= 14)))
      items.push({ key: i.id, kind: 'investigation', label: i.label, detail: s.label, status: s.status, refId: i.id });
  }
  for (const r of db.referrals.filter((x) => x.pregnancyId === p.id)) {
    if (r.status === 'recommendations') items.push({ key: r.id, kind: 'referral', label: `${r.department} referral`, detail: 'Recommendations documented — close it', status: 'due', refId: r.id });
    else if (referralStale(r, now)) items.push({ key: r.id, kind: 'referral', label: `${r.department} referral`, detail: `No update for ${ago(lastEventAt(r), now)}`, status: 'overdue', refId: r.id });
  }
  const order: Record<TaskStatus, number> = { missed: 0, overdue: 1, due: 2, upcoming: 3, done: 4 };
  return items.sort((a, b) => order[a.status] - order[b.status]);
}

/** A planned ANC visit as the Visits tab lists it: its dates and its status from dates and completion only. */
export type AncSlot = { task: Task; status: TaskStatus; label: string };

/**
 * Visits tab (CT-20): the visits recorded for this pregnancy (newest first) and its scheduled ANC visits (every
 * planned anc_visit task not cancelled, by due date) with their status — due, upcoming, overdue, missed or done.
 * Statuses come from dates and completion only, never from a reading.
 */
export function visitsTab(db: DbState, pregnancyId: string, now: Date): { recorded: Visit[]; scheduled: AncSlot[] } {
  const recorded = db.visits.filter((v) => v.pregnancyId === pregnancyId).sort((a, b) => b.at.getTime() - a.at.getTime());
  const scheduled = db.tasks
    .filter((t) => t.subjectId === pregnancyId && t.kind === 'anc_visit' && !t.cancelledAt)
    .sort((a, b) => a.dueBy.getTime() - b.dueBy.getTime())
    .map((task): AncSlot => {
      const status = taskState(db, task, now);
      const window = task.dueFrom && task.dueFrom.getTime() !== task.dueBy.getTime() ? `${fmtDate(task.dueFrom)} – ${fmtDate(task.dueBy)}` : fmtDay(task.dueBy);
      const label =
        status === 'done'
          ? `Done · seen ${fmtDay(task.completedAt ?? task.dueBy)}`
          : status === 'missed'
            ? `Missed · was due ${fmtDay(task.dueBy)}`
            : status === 'overdue'
              ? `Overdue · was due ${fmtDay(task.dueBy)}`
              : status === 'due'
                ? `Due · ${window}`
                : `Upcoming · ${window}`;
      return { task, status, label };
    });
  return { recorded, scheduled };
}

export function nextVisit(db: DbState, subjectId: string, now: Date) {
  return db.tasks
    .filter((t) => t.subjectId === subjectId && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() >= addDays(now, -1).getTime())
    .sort((a, b) => a.dueBy.getTime() - b.dueBy.getTime())[0];
}

// ── Worklist (F-10) ─────────────────────────────────────────────────────────────

export type WorkGroup = 'now' | 'today' | 'week';

export type WorkItem = {
  id: string;
  group: WorkGroup;
  name: string;
  what: string;
  context: string;
  status: TaskStatus;
  statusLabel: string;
  intensity?: Intensity;
  familySign?: boolean;
  stats?: { label: string; value: string }[];
  /** Patient identifiers for the Name / Age+OBS / IP rows. */
  motherId: string;
  pregnancyId?: string;
  /** `discharge`: the checklist of a mother (pregnancy id) or a baby (baby id). */
  target: { type: 'pregnancy' | 'baby' | 'callback' | 'task' | 'investigation' | 'referral' | 'discharge'; id: string };
  audience: 'ob' | 'paed' | 'both';
  /**
   * Referral items: whose move it is (server advance_referral). `receiving`: the department's members (accept,
   * schedule, see, answer); `referring`: the referring team (close); `either`: a stale referral both sides follow.
   */
  referral?: { side: 'receiving' | 'referring' | 'either'; toTeamId?: TeamId; baby: boolean };
};

const SUBS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'] as const;
const subNum = (n: number) => String(n).split('').map((d) => SUBS[Number(d)]).join('');

/** Obstetric score with subscripted digits, e.g. G₂P₁L₁A₀. */
export function obsScore(gpla: { g: number; p: number; l: number; a: number }): string {
  return `G${subNum(gpla.g)}P${subNum(gpla.p)}L${subNum(gpla.l)}A${subNum(gpla.a)}`;
}

/** Identifier rows for a patient: Age + OBS score, and IP number. */
export function patientIds(db: DbState, motherId: string, pregnancyId?: string): { ageObs: string; ip: string } {
  const m = db.mothers.find((x) => x.id === motherId);
  const p = pregnancyId ? db.pregnancies.find((x) => x.id === pregnancyId) : currentPregnancy(db, motherId);
  if (!m) return { ageObs: '', ip: '' };
  return {
    ageObs: `Age ${m.age}${p ? ` · ${obsScore(p.gpla)}` : ''}`,
    ip: m.ipNo ? `IP ${m.ipNo}` : '',
  };
}

const langName = { en: 'English', kn: 'Kannada', hi: 'Hindi' } as const;

export function worklist(db: DbState, now: Date): WorkItem[] {
  const out: WorkItem[] = [];
  const pById = new Map<SubjectId, Pregnancy>(db.pregnancies.map((p) => [p.id, p]));
  const bById = new Map<SubjectId, Baby>(db.babies.map((b) => [b.id, b]));

  for (const c of db.callbacks.filter((x) => !x.closedAt)) {
    const m = motherOf(db, c.motherId);
    const p = currentPregnancy(db, m.id);
    out.push({
      id: c.id, group: 'now', name: m.name, what: `Call-back requested · ${c.channel === 'whatsapp' ? 'WhatsApp' : 'app'}`, context: p ? (p.status === 'delivered' ? 'Postnatal' : gaLabel(p, now)) : '',
      status: 'due', statusLabel: `Waiting ${ago(c.at, now)}`, intensity: p?.intensity, familySign: c.signs.length > 0, motherId: m.id, pregnancyId: p?.id, target: { type: 'callback', id: c.id }, audience: 'both',
    });
  }

  for (const t of db.tasks.filter((x) => !x.completedAt && !x.cancelledAt)) {
    const st = taskState(db, t, now);
    if (st === 'upcoming') continue;
    const isBaby = t.subjectType === 'baby';
    const p = isBaby ? undefined : pById.get(t.subjectId);
    const b = isBaby ? bById.get(t.subjectId) : undefined;
    if (!p && !b) continue;
    if (p && p.status !== 'active' && t.kind === 'anc_visit') continue;
    const intensity = intensityOfSubject(db, t);
    const name = b ? `Baby of ${motherOf(db, b.motherId).name}` : motherOf(db, p!.motherId).name;
    const context = b ? babyAgeLabel(b, now) : p!.status === 'delivered' ? 'Postnatal' : gaLabel(p!, now);
    const dueToday = daysBetween(now, t.dueBy) === 0;
    if (st === 'due' && !dueToday) continue;
    const lastVisit = p ? db.visits.filter((v) => v.pregnancyId === p.id).sort((a, z) => z.at.getTime() - a.at.getTime())[0] : undefined;
    const mother = motherOf(db, b ? b.motherId : p!.motherId);
    out.push({
      id: t.id,
      group: st === 'missed' ? (intensity === 'close' ? 'now' : 'today') : st === 'overdue' ? 'today' : 'today',
      name,
      what: st === 'due' ? `${t.title} · today` : st === 'missed' ? `Missed · ${t.title}` : `Overdue · ${t.title}`,
      context,
      status: st,
      statusLabel: st === 'due' ? 'Scheduled today' : `${daysBetween(t.dueBy, now)} days since due`,
      intensity,
      motherId: mother.id,
      pregnancyId: isBaby ? b!.pregnancyId : p!.id,
      stats: st === 'missed' ? [
        { label: 'Due', value: fmtDate(t.dueBy) },
        { label: 'Last visit', value: lastVisit ? fmtDate(lastVisit.at) : '—' },
        { label: 'Attempts', value: String(t.contactAttempts.length) },
        { label: 'Language', value: langName[mother.lang] },
      ] : undefined,
      target: { type: 'task', id: t.id },
      audience: isBaby ? 'paed' : 'ob',
    });
  }

  for (const i of db.investigations) {
    const p = pById.get(i.subjectId);
    if (!p || p.status !== 'active') continue;
    const m = motherOf(db, p.motherId);
    if (i.status === 'resulted') {
      out.push({ id: i.id, group: 'today', name: m.name, what: `Result awaiting review · ${i.label}`, context: gaLabel(p, now), status: 'due', statusLabel: `Entered ${ago(i.result!.at, now)} ago`, intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'investigation', id: i.id }, audience: 'ob' });
      continue;
    }
    if (i.status !== 'due' && i.status !== 'ordered') continue;
    const left = daysBetween(now, i.dueBy);
    if (left < 0) out.push({ id: i.id, group: 'week', name: m.name, what: `Test window closed · ${i.label}`, context: gaLabel(p, now), status: 'overdue', statusLabel: `Closed ${fmtDate(i.dueBy)}`, intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'investigation', id: i.id }, audience: 'ob' });
    else if (left <= 7 && now.getTime() >= i.dueFrom.getTime()) out.push({ id: i.id, group: 'week', name: m.name, what: `Test window closing · ${i.label}`, context: gaLabel(p, now), status: 'due', statusLabel: `Closes in ${left} days`, intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'investigation', id: i.id }, audience: 'ob' });
  }

  for (const r of db.referrals) {
    const p = pById.get(r.pregnancyId);
    if (!p) continue;
    const m = motherOf(db, p.motherId);
    const audience = r.babyId ? 'paed' : 'ob';
    const ref = (side: 'receiving' | 'referring' | 'either') => ({ side, toTeamId: r.toTeamId, baby: !!r.babyId });
    if (r.status === 'requested') out.push({ id: r.id, group: 'today', name: m.name, what: `Referral to accept · ${r.department}`, context: gaLabel(p, now), status: 'due', statusLabel: `Requested ${ago(r.events[0]!.at, now)} ago`, intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'referral', id: r.id }, audience, referral: ref('receiving') });
    else if (r.status === 'recommendations') out.push({ id: r.id, group: 'today', name: m.name, what: `Referral answered · ${r.department}`, context: gaLabel(p, now), status: 'due', statusLabel: 'Review & close', intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'referral', id: r.id }, audience, referral: ref('referring') });
    else if (referralStale(r, now)) out.push({ id: r.id, group: 'week', name: m.name, what: `Referral · ${r.department} · no update`, context: gaLabel(p, now), status: 'overdue', statusLabel: ago(lastEventAt(r), now), intensity: p.intensity, motherId: m.id, pregnancyId: p.id, target: { type: 'referral', id: r.id }, audience, referral: ref('either') });
  }

  for (const d of db.discharges.filter((x) => !x.completedAt)) {
    const isBaby = d.subject === 'baby';
    const b = isBaby ? bById.get(d.subjectId) : undefined;
    const p = isBaby ? pById.get(b!.pregnancyId) : pById.get(d.subjectId);
    if (!p) continue;
    const m = motherOf(db, p.motherId);
    if (isBaby && (b!.outcome !== 'live' || b!.deceasedAt)) continue;
    const openItems = d.items.filter((i) => !i.state).length;
    const since = db.deliveries.find((x) => x.pregnancyId === p.id)?.at ?? now;
    out.push({
      id: `dc_${d.subjectId}`, group: 'week', name: isBaby ? `Baby of ${m.name}` : m.name,
      what: openItems ? `Discharge checklist · ${openItems} open` : 'Discharge checklist · ready to complete',
      context: isBaby ? babyAgeLabel(b!, now) : 'Postnatal', status: 'due', statusLabel: `Open ${ago(since, now)}`, motherId: m.id, pregnancyId: p.id,
      target: { type: 'discharge', id: d.subjectId }, audience: isBaby ? 'paed' : 'ob',
    });
  }

  for (const b of db.babies) {
    const overdue = db.immunizations.filter((i) => i.babyId === b.id && !i.givenOn && i.notGivenReason === undefined && daysBetween(i.dueOn, now) > 7);
    if (!overdue.length) continue;
    const first = overdue.sort((a, z) => a.dueOn.getTime() - z.dueOn.getTime())[0]!;
    out.push({ id: `vx_${b.id}`, group: 'week', name: `Baby of ${motherOf(db, b.motherId).name}`, what: `Vaccines overdue · ${first.label}${overdue.length > 1 ? ` +${overdue.length - 1}` : ''}`, context: babyAgeLabel(b, now), status: 'overdue', statusLabel: `${daysBetween(first.dueOn, now)} days`, intensity: b.intensity, motherId: b.motherId, pregnancyId: b.pregnancyId, target: { type: 'baby', id: b.id }, audience: 'paed' });
  }

  return out;
}

// ── KPI (PRD §18) ───────────────────────────────────────────────────────────────

const KPI_KINDS = new Set(['anc_visit', 'pn_visit', 'nb_visit', 'template']);

/** Start of the ISO week (Monday) containing `d`, as a UTC date. */
function weekStart(d: Date) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return addDays(x, -((x.getUTCDay() + 6) % 7));
}

export type KpiReport = {
  weeks: { start: Date; due: number; onTime: number; rate: number | null }[];
  onTimeRate: number | null;
  completeness: number | null;
  contactWithin48h: number | null;
  vaccineTimeliness: number | null;
  referralMedianDays: number | null;
};

/**
 * Primary KPI: on-time completion of scheduled maternal & newborn visits — a visit counts
 * once it is decided (completed, or past due + grace). Secondary KPIs per PRD §18.2.
 */
export function kpi(db: DbState, now: Date, weeks = 8): KpiReport {
  const graceOf = (t: Task) => GRACE_DAYS[intensityOfSubject(db, t)];
  const decided = db.tasks.filter((t) => KPI_KINDS.has(t.kind) && !t.cancelledAt && (t.completedAt || addDays(t.dueBy, graceOf(t)).getTime() < now.getTime()));
  const onTime = (t: Task) => !!t.completedAt && t.completedAt.getTime() <= addDays(t.dueBy, graceOf(t) + 1).getTime();

  const thisWeek = weekStart(now);
  const series = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(thisWeek, -7 * (weeks - 1 - i));
    const end = addDays(start, 7);
    const inWeek = decided.filter((t) => t.dueBy.getTime() >= start.getTime() && t.dueBy.getTime() < end.getTime());
    const ok = inWeek.filter(onTime).length;
    return { start, due: inWeek.length, onTime: ok, rate: inWeek.length ? ok / inWeek.length : null };
  });
  const due = series.reduce((a, w) => a + w.due, 0);
  const ok = series.reduce((a, w) => a + w.onTime, 0);

  const recentVisits = db.visits.filter((v) => daysBetween(v.at, now) <= 30);
  const ratios = recentVisits.map((v) => {
    const items = Object.values(v.checklist).filter((c) => c.state !== 'na');
    return items.length ? items.filter((c) => c.state === 'done').length / items.length : 1;
  });

  const lapsed = decided.filter((t) => !onTime(t));
  const contacted = lapsed.filter((t) => {
    const first = t.contactAttempts[0];
    return first && first.at.getTime() - addDays(t.dueBy, graceOf(t)).getTime() <= 48 * 3_600_000;
  });

  const decidedVax = db.immunizations.filter((i) => i.notGivenReason === undefined && (i.givenOn || daysBetween(i.dueOn, now) > 7));
  const vaxOnTime = decidedVax.filter((i) => i.givenOn && daysBetween(i.dueOn, i.givenOn) <= 7);

  // Days from request to the department's answer. A cancelled or declined referral was never answered: excluded.
  const closedRefs = db.referrals
    .filter((r) => r.status !== 'cancelled' && r.status !== 'declined')
    .map((r) => {
      const answered = r.events.find((e) => e.status === 'recommendations' || e.status === 'closed');
      return answered ? daysBetween(r.events[0]!.at, answered.at) : undefined;
    })
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);

  return {
    weeks: series,
    onTimeRate: due ? ok / due : null,
    completeness: ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null,
    contactWithin48h: lapsed.length ? contacted.length / lapsed.length : null,
    vaccineTimeliness: decidedVax.length ? vaxOnTime.length / decidedVax.length : null,
    referralMedianDays: closedRefs.length ? closedRefs[Math.floor(closedRefs.length / 2)]! : null,
  };
}

// ── Mother–baby continuity timeline (F-06) ──────────────────────────────────────

export type TimelineKind = 'registered' | 'visit' | 'test' | 'tag' | 'referral' | 'delivery' | 'planned_visit' | 'pn_visit' | 'nb_visit' | 'vaccine' | 'callback';

export type TimelineEvent = {
  id: string;
  at: Date;
  lane: 'mother' | 'baby' | 'shared';
  kind: TimelineKind;
  state: 'past' | 'planned' | 'missed';
  label: string;
  sub?: string;
  babyIndex?: number;
};

/**
 * One journey: mother lane until delivery, then mother + baby lanes (twins → more babies
 * share the baby lane with an index). `audience: 'family'` drops clinician-only items.
 */
export function continuityEvents(db: DbState, pregnancyId: string, now: Date, audience: 'care' | 'family'): TimelineEvent[] {
  const p = db.pregnancies.find((x) => x.id === pregnancyId);
  if (!p) return [];
  const babies = db.babies.filter((b) => b.pregnancyId === p.id);
  const babyIdx = new Map<SubjectId, number>(babies.map((b, i) => [b.id, i]));
  const ev: TimelineEvent[] = [{ id: 'reg', at: p.registeredOn, lane: 'mother', kind: 'registered', state: 'past', label: 'Registered', sub: p.mchId }];

  for (const v of db.visits.filter((x) => x.pregnancyId === p.id)) {
    ev.push({ id: v.id, at: v.at, lane: 'mother', kind: 'visit', state: 'past', label: 'ANC visit', sub: p.edd ? `${gestationalAge(p.edd, v.at).weeks} weeks` : undefined });
  }
  if (audience === 'care') {
    for (const i of db.investigations.filter((x) => x.subjectId === p.id && x.result)) ev.push({ id: i.id, at: i.result!.at, lane: 'mother', kind: 'test', state: 'past', label: i.label, sub: 'Result documented' });
    for (const t of db.tags.filter((x) => x.subjectId === p.id)) ev.push({ id: t.id, at: t.setAt, lane: 'mother', kind: 'tag', state: 'past', label: 'Tagged', sub: t.code });
    for (const r of db.referrals.filter((x) => x.pregnancyId === p.id)) ev.push({ id: r.id, at: r.events[0]!.at, lane: 'mother', kind: 'referral', state: 'past', label: `Referred · ${r.department}`, sub: r.status });
  }
  const delivery = db.deliveries.find((d) => d.pregnancyId === p.id);
  if (delivery) {
    ev.push({ id: delivery.id, at: delivery.at, lane: 'shared', kind: 'delivery', state: 'past', label: 'Delivery', sub: delivery.mode });
    for (const b of babies) {
      for (const im of db.immunizations.filter((x) => x.babyId === b.id)) {
        if (im.notGivenReason !== undefined || (!im.givenOn && daysBetween(now, im.dueOn) > 60)) continue;
        const missed = !im.givenOn && daysBetween(im.dueOn, now) > 7;
        ev.push({ id: im.id, at: im.givenOn ?? im.dueOn, lane: 'baby', kind: 'vaccine', state: im.givenOn ? 'past' : missed ? 'missed' : 'planned', label: im.label, sub: im.group, babyIndex: babyIdx.get(b.id) });
      }
    }
  }
  const subjects = new Set([p.id, ...babies.map((b) => b.id)]);
  for (const t of db.tasks.filter((x) => subjects.has(x.subjectId) && !x.cancelledAt)) {
    if (t.kind === 'anc_visit' && t.completedAt) continue; // shown as the visit itself
    if (t.kind === 'referral_appt' && audience === 'family') continue;
    if (!t.completedAt && daysBetween(now, t.dueBy) > 45) continue;
    const isBaby = t.subjectType === 'baby';
    const st = taskState(db, t, now);
    ev.push({
      id: t.id,
      at: t.completedAt ?? t.dueBy,
      lane: isBaby ? 'baby' : 'mother',
      kind: t.kind === 'anc_visit' ? 'planned_visit' : isBaby ? 'nb_visit' : 'pn_visit',
      state: t.completedAt ? 'past' : st === 'missed' ? 'missed' : 'planned',
      label: t.title,
      babyIndex: isBaby ? babyIdx.get(t.subjectId) : undefined,
    });
  }
  return ev.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** A dialable tel: link from a phone number as shown ("080-2222-0000" → "tel:08022220000"). */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Baby sex as documented: Girl, Boy, or undetermined at birth. */
export const sexLabel = (sex: 'F' | 'M' | 'U') => (sex === 'F' ? 'Girl' : sex === 'M' ? 'Boy' : 'Sex undetermined');
