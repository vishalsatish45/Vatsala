/**
 * Care-protocol schedules (PRD §10). Pure calendar arithmetic over hospital-configurable
 * protocol data — no clinical thresholds and no clinical judgement (PRD §2.2).
 */
import { addDays, gestationalAge, lmpFromEdd } from './gestation';

export type Intensity = 'routine' | 'enhanced' | 'close';

/** Missed-visit grace per clinician-set follow-up intensity (PRD §10.1). */
export const GRACE_DAYS: Record<Intensity, number> = { routine: 7, enhanced: 4, close: 2 };

/** Weeks between ANC visits at a given GA (PRD §10.1). */
export function ancIntervalWeeks(intensity: Intensity, gaWeeks: number): number {
  if (gaWeeks >= 36) return 1;
  if (intensity === 'close') return 2;
  if (gaWeeks >= 28) return 2;
  return intensity === 'enhanced' ? 3 : 4;
}

/** Future ANC visit dates after `from` (last visit or registration) until the EDD. */
export function ancVisitDates(edd: Date, intensity: Intensity, from: Date): Date[] {
  const out: Date[] = [];
  let d = from;
  for (let guard = 0; guard < 60; guard++) {
    d = addDays(d, ancIntervalWeeks(intensity, gestationalAge(edd, d).weeks) * 7);
    if (d.getTime() > edd.getTime()) break;
    out.push(d);
  }
  return out;
}

// ── Investigations by GA window (PRD §10.2) ─────────────────────────────────────

export type InvestigationDef = {
  code: string;
  label: string;
  fromWeek: number;
  toWeek: number;
  /** Never shown to families (shared-phone privacy, PRD §15.4). */
  sensitive?: boolean;
  /** Only scheduled when a documented fact applies. */
  onlyIf?: 'rhNegative';
  kind: 'lab' | 'scan';
};

export const INVESTIGATIONS: InvestigationDef[] = [
  { code: 'hb1', label: 'Haemoglobin (Hb)', fromWeek: 0, toWeek: 14, kind: 'lab' },
  { code: 'bg', label: 'Blood group & Rh', fromWeek: 0, toWeek: 14, kind: 'lab' },
  { code: 'urine', label: 'Urine routine', fromWeek: 0, toWeek: 14, kind: 'lab' },
  { code: 'hiv', label: 'HIV', fromWeek: 0, toWeek: 14, kind: 'lab', sensitive: true },
  { code: 'vdrl', label: 'Syphilis (VDRL/RPR)', fromWeek: 0, toWeek: 14, kind: 'lab', sensitive: true },
  { code: 'hbsag', label: 'HBsAg', fromWeek: 0, toWeek: 14, kind: 'lab', sensitive: true },
  { code: 'rbs', label: 'Blood sugar (first visit)', fromWeek: 0, toWeek: 14, kind: 'lab' },
  { code: 'tsh', label: 'TSH', fromWeek: 0, toWeek: 14, kind: 'lab' },
  { code: 'dating', label: 'Dating scan', fromWeek: 6, toWeek: 14, kind: 'scan' },
  { code: 'anomaly', label: 'Anomaly scan', fromWeek: 18, toWeek: 22, kind: 'scan' },
  { code: 'ogtt', label: 'OGTT 75 g', fromWeek: 24, toWeek: 28, kind: 'lab' },
  { code: 'hb2', label: 'Repeat Hb', fromWeek: 24, toWeek: 28, kind: 'lab' },
  { code: 'ict', label: 'Indirect Coombs test', fromWeek: 28, toWeek: 29, kind: 'lab', onlyIf: 'rhNegative' },
  { code: 'hb3', label: 'Repeat Hb (3rd trimester)', fromWeek: 32, toWeek: 36, kind: 'lab' },
];

export type InvestigationWindow = {
  code: string;
  label: string;
  dueFrom: Date;
  dueBy: Date;
  /** Window had already closed at registration → shown as "due now", never as a failure. */
  late: boolean;
  sensitive: boolean;
  kind: 'lab' | 'scan';
};

const LATE_WINDOW_DAYS = 14;

export function investigationWindows(edd: Date, registeredOn: Date, facts: { rhNegative?: boolean } = {}): InvestigationWindow[] {
  const lmp = lmpFromEdd(edd);
  return INVESTIGATIONS.filter((d) => !d.onlyIf || facts[d.onlyIf]).map((d) => {
    const dueFrom = addDays(lmp, d.fromWeek * 7);
    const dueBy = addDays(lmp, d.toWeek * 7 + 6);
    const late = dueBy.getTime() < registeredOn.getTime();
    return {
      code: d.code,
      label: d.label,
      dueFrom: late ? registeredOn : dueFrom,
      dueBy: late ? addDays(registeredOn, LATE_WINDOW_DAYS) : dueBy,
      late,
      sensitive: !!d.sensitive,
      kind: d.kind,
    };
  });
}

// ── Immunization — India UIP defaults, 0–24 months (PRD §10.5) ──────────────────

export type VaccineDef = { code: string; label: string; group: string; ageDays: number };

export const UIP: VaccineDef[] = [
  { code: 'bcg', label: 'BCG', group: 'Birth', ageDays: 0 },
  { code: 'opv0', label: 'OPV-0', group: 'Birth', ageDays: 0 },
  { code: 'hepb0', label: 'Hepatitis B birth dose', group: 'Birth', ageDays: 0 },
  { code: 'opv1', label: 'OPV-1', group: '6 weeks', ageDays: 42 },
  { code: 'penta1', label: 'Pentavalent-1', group: '6 weeks', ageDays: 42 },
  { code: 'rvv1', label: 'Rotavirus-1', group: '6 weeks', ageDays: 42 },
  { code: 'fipv1', label: 'fIPV-1', group: '6 weeks', ageDays: 42 },
  { code: 'pcv1', label: 'PCV-1', group: '6 weeks', ageDays: 42 },
  { code: 'opv2', label: 'OPV-2', group: '10 weeks', ageDays: 70 },
  { code: 'penta2', label: 'Pentavalent-2', group: '10 weeks', ageDays: 70 },
  { code: 'rvv2', label: 'Rotavirus-2', group: '10 weeks', ageDays: 70 },
  { code: 'opv3', label: 'OPV-3', group: '14 weeks', ageDays: 98 },
  { code: 'penta3', label: 'Pentavalent-3', group: '14 weeks', ageDays: 98 },
  { code: 'rvv3', label: 'Rotavirus-3', group: '14 weeks', ageDays: 98 },
  { code: 'fipv2', label: 'fIPV-2', group: '14 weeks', ageDays: 98 },
  { code: 'pcv2', label: 'PCV-2', group: '14 weeks', ageDays: 98 },
  { code: 'mr1', label: 'MR-1', group: '9 months', ageDays: 270 },
  { code: 'pcvb', label: 'PCV booster', group: '9 months', ageDays: 270 },
  { code: 'vita1', label: 'Vitamin A (1st)', group: '9 months', ageDays: 270 },
  { code: 'mr2', label: 'MR-2', group: '16–24 months', ageDays: 487 },
  { code: 'dptb1', label: 'DPT booster-1', group: '16–24 months', ageDays: 487 },
  { code: 'opvb', label: 'OPV booster', group: '16–24 months', ageDays: 487 },
  { code: 'vita2', label: 'Vitamin A (2nd)', group: '16–24 months', ageDays: 487 },
];

export function vaccineSchedule(dob: Date): { code: string; label: string; group: string; dueOn: Date }[] {
  return UIP.map((v) => ({ code: v.code, label: v.label, group: v.group, dueOn: addDays(dob, v.ageDays) }));
}

// ── Postnatal & newborn follow-up templates (PRD §10.3) ─────────────────────────

export type FollowUpDef = { key: string; label: string; subject: 'mother' | 'baby'; dayFrom: number; dayTo: number };

export const POSTNATAL_STANDARD: FollowUpDef[] = [
  { key: 'pn_d3', label: 'Postnatal check · day 3', subject: 'mother', dayFrom: 3, dayTo: 4 },
  { key: 'pn_d7', label: 'Postnatal check · day 7', subject: 'mother', dayFrom: 7, dayTo: 8 },
  { key: 'pn_w6', label: 'Postnatal review · week 6', subject: 'mother', dayFrom: 42, dayTo: 49 },
  { key: 'nb_d7', label: 'Newborn check · day 7', subject: 'baby', dayFrom: 7, dayTo: 8 },
];

/** Hospital templates attached to clinician tags — applied only because a clinician set the tag. */
export const TAG_TEMPLATES: Record<string, FollowUpDef[]> = {
  hypertensive: [{ key: 'tpl_bp', label: 'BP check visit · day 3–5', subject: 'mother', dayFrom: 3, dayTo: 5 }],
  gdm: [{ key: 'tpl_glucose', label: 'Glucose test · weeks 6–12', subject: 'mother', dayFrom: 42, dayTo: 84 }],
  lbw: [
    { key: 'tpl_wt1', label: 'Weight visit · week 1', subject: 'baby', dayFrom: 7, dayTo: 9 },
    { key: 'tpl_wt2', label: 'Weight visit · week 2', subject: 'baby', dayFrom: 14, dayTo: 16 },
    { key: 'tpl_wt3', label: 'Weight visit · week 3', subject: 'baby', dayFrom: 21, dayTo: 23 },
    { key: 'tpl_wt4', label: 'Weight visit · week 4', subject: 'baby', dayFrom: 28, dayTo: 30 },
  ],
  jaundice: [{ key: 'tpl_jaundice', label: 'Jaundice follow-up visit', subject: 'baby', dayFrom: 2, dayTo: 3 }],
};

// ── ANC visit completeness (PRD §10.2) ──────────────────────────────────────────

export type VisitComponent = { key: string; label: string; fromWeek?: number };

export const VISIT_COMPONENTS: VisitComponent[] = [
  { key: 'bp', label: 'Blood pressure' },
  { key: 'weight', label: 'Weight' },
  { key: 'urine_albumin', label: 'Urine albumin' },
  { key: 'fundal_height', label: 'Fundal height', fromWeek: 20 },
  { key: 'fhr', label: 'Fetal heart rate', fromWeek: 20 },
  { key: 'fetal_movements', label: 'Fetal movements asked', fromWeek: 28 },
  { key: 'presentation', label: 'Presentation documented', fromWeek: 32 },
  { key: 'ifa', label: 'IFA / calcium dispensed' },
  { key: 'counselling', label: 'Counselling given' },
  { key: 'next_visit', label: 'Next visit scheduled' },
];

export function expectedComponents(gaWeeks: number): VisitComponent[] {
  return VISIT_COMPONENTS.filter((c) => (c.fromWeek ?? 0) <= gaWeeks);
}

export type ComponentState = 'done' | 'not_done' | 'na' | 'missing';

/** Count of expected components recorded. N/A items are excluded from the denominator. */
export function completeness(gaWeeks: number, states: Record<string, ComponentState | undefined>) {
  const expected = expectedComponents(gaWeeks).filter((c) => states[c.key] !== 'na');
  const done = expected.filter((c) => states[c.key] === 'done');
  const missing = expected.filter((c) => !states[c.key] || states[c.key] === 'missing');
  return { done: done.length, expected: expected.length, missing };
}

// ── Task status (PRD F-22, F-23) ────────────────────────────────────────────────

export type TaskStatus = 'done' | 'upcoming' | 'due' | 'overdue' | 'missed';

/**
 * Operational status of an obligation on `now`:
 * upcoming (before window) · due (in window) · overdue (past due, within grace) ·
 * missed (past grace). Pass grace = Infinity for items that never become "missed".
 */
export function taskStatus(t: { dueFrom?: Date; dueBy: Date; completed: boolean }, now: Date, graceDays: number): TaskStatus {
  if (t.completed) return 'done';
  const n = now.getTime();
  if (t.dueFrom && n < t.dueFrom.getTime()) return 'upcoming';
  if (n <= t.dueBy.getTime() + 86_399_999) return 'due';
  if (graceDays === Infinity || n <= addDays(t.dueBy, graceDays).getTime() + 86_399_999) return 'overdue';
  return 'missed';
}
