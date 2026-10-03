/**
 * Pure request builders for the record-keeping RPCs (supabase/migrations/2026100500030*, 0400*, 0600*).
 * Each one maps the app's shape to the RPC allowlist explicitly — no payload is written
 * wholesale, and an unknown key would be refused by the server. Dates only; no clinical interpretation.
 */
import { addDays, daysBetween, eddFromLmp, gestationalAge, PREGNANCY_DAYS } from '@domain/gestation';
import type { Intensity } from '@domain/schedules';

import { counsellingCodes, previousLabel, previousModeCodes, previousOutcomeCodes, splitComplaints } from './codes';
import { e164, isoDay } from './remote';
import type {
  AccessOverride,
  BabyId,
  CaregiverScopes,
  DoseSlot,
  EieKind,
  Id,
  Mother,
  MotherId,
  NewbornObs,
  Pregnancy,
  PregnancyId,
  PrevPregnancy,
  TeamId,
  Visit,
} from './types';

// ── Re-dating ─────────────────────────────────────────────────────────────────────

/** How the clinician dates the pregnancy. The app shows the resulting EDD; it never chooses between datings. */
export type RedateInput =
  | { method: 'lmp'; lmp: Date; note?: string }
  | { method: 'scan'; scanOn: Date; gaAtScanDays: number; note?: string }
  | { method: 'clinician'; edd: Date; note?: string };

/**
 * The calendar day the server is sent for a date (`isoDay`), as a UTC-midnight date. A picker or "now" may carry a
 * time of day; between 00:00 and 05:30 IST its UTC date is the day before, so arithmetic must start from this day —
 * otherwise the EDD sent is a day off the dates sent with it and the server refuses the dating.
 */
const asDay = (d: Date) => new Date(`${isoDay(d)}T00:00:00Z`);

/** The EDD a dating gives, by calendar arithmetic only (LMP + 280 days; scan date + days remaining). */
export function eddFor(input: RedateInput): Date {
  switch (input.method) {
    case 'lmp':
      return eddFromLmp(asDay(input.lmp));
    case 'scan':
      return addDays(asDay(input.scanOn), PREGNANCY_DAYS - input.gaAtScanDays);
    case 'clinician':
      return asDay(input.edd);
  }
}

/** Input checks the database also enforces (`pregnancy_datings` constraints); returns a message or undefined. */
export function redateProblem(input: RedateInput, now: Date): string | undefined {
  if (input.method === 'lmp' && daysBetween(now, input.lmp) > 0) return 'The LMP cannot be in the future.';
  if (input.method === 'scan') {
    if (daysBetween(now, input.scanOn) > 0) return 'The scan date cannot be in the future.';
    if (!Number.isInteger(input.gaAtScanDays) || input.gaAtScanDays < 28 || input.gaAtScanDays > 300) return 'Enter the gestational age at the scan (4 to 42 weeks).';
  }
  if (input.method === 'clinician' && daysBetween(now, input.edd) < 0) return 'The EDD cannot be in the past for an ongoing pregnancy.';
  return undefined;
}

/** `redate_pregnancy.dating` — exactly the keys of its allowlist that this method uses. */
export function datingPayload(input: RedateInput) {
  const edd = isoDay(eddFor(input));
  const note = input.note?.trim() || undefined;
  switch (input.method) {
    case 'lmp':
      return { method: 'lmp' as const, lmp: isoDay(input.lmp), edd, note };
    case 'scan':
      return { method: 'scan' as const, scan_on: isoDay(input.scanOn), ga_at_scan_days: input.gaAtScanDays, edd, note };
    case 'clinician':
      return { method: 'clinician' as const, edd, note };
  }
}

// ── Registration and a mother's details ───────────────────────────────────────────

/** Dating at registration: a re-dating input, plus whether the LMP is certain (as documented). */
export type RegisterDating =
  | { method: 'lmp'; lmp: Date; lmpCertain?: boolean; note?: string }
  | { method: 'scan'; scanOn: Date; gaAtScanDays: number; note?: string }
  /** `lmp`: an LMP documented alongside an EDD the doctor set (e.g. corrected by a scan); recorded, not used to date. */
  | { method: 'clinician'; edd: Date; lmp?: Date; note?: string };

/** A mother's details as the forms produce them: empty strings / undefined = not documented. */
export type MotherDetails = Omit<Mother, 'id' | 'ipNo'>;

/** One registration, exactly as entered (src/features/care/forms.ts makeRegisterSchema). */
export type RegisterInput = {
  mother: MotherDetails;
  /** A returning mother the clinician confirmed (find_mother): her record is reused and corrected from the form. */
  existingMotherId?: MotherId;
  registeredOn: Date;
  /**
   * From the form's optional Present pregnancy card (LMP / EDD / POG), or each import row's LMP. Absent: the doctor
   * records the dating later (redate_pregnancy, first dating).
   */
  dating?: RegisterDating;
  gpla: Pregnancy['gpla'];
  /** Number of fetuses as documented (register import / older clients; the form no longer asks). */
  fetuses?: number;
  history: Pregnancy['history'];
  previous: Pregnancy['previous'];
  tagCodes: string[];
  tagNote?: string;
  intensity: Intensity;
  /** The obstetric unit that will care for her (server: an active unit of this hospital). */
  teamId?: TeamId;
};

/** `register_pregnancy.dating`: the re-dating keys plus lmp_certain for an LMP dating. */
export function registerDatingPayload(d: RegisterDating) {
  return {
    ...datingPayload(d),
    lmp_certain: d.method === 'lmp' ? d.lmpCertain : undefined,
    // An LMP documented with the doctor's EDD travels with it (the server stores it; the EDD dates the pregnancy)
    ...(d.method === 'clinician' && d.lmp ? { lmp: isoDay(d.lmp) } : {}),
  };
}

/**
 * Every field of a mother's details, mapped to the update_mother / register_pregnancy keys. Phones are stored as
 * 91XXXXXXXXXX. Empty → '' / null, which the server reads as "clear this field".
 */
export function motherPayload(m: MotherDetails) {
  const ec = m.emergencyContact;
  const t = (v: string | undefined) => v?.trim() ?? '';
  // A husband's details are sent only for a married woman (the server refuses them otherwise).
  const married = m.maritalStatus === 'married';
  return {
    name: m.name.trim(),
    dob: m.dob ? isoDay(m.dob) : null,
    dob_estimated: !!m.dob && !!m.dobEstimated,
    // Her age is derived from the date of birth; it is stored only when the date is not known.
    age: m.dob ? undefined : m.age,
    phone: e164(m.phone),
    alt_phone: m.altPhone ? e164(m.altPhone) : '',
    email: t(m.email),
    marital_status: m.maritalStatus ?? '',
    husband_name: married ? t(m.husbandName) : '',
    husband_phone: married && m.husbandPhone ? e164(m.husbandPhone) : '',
    address_line: t(m.addressLine),
    village: t(m.village),
    district: t(m.district),
    state: t(m.state),
    pincode: t(m.pincode),
    rch_id: t(m.rchId),
    aadhaar_last4: t(m.aadhaarLast4),
    abha_number: t(m.abhaNumber),
    abha_address: t(m.abhaAddress),
    lang: m.lang,
    emergency_contact: ec.phone ? { name: ec.name.trim(), relation: ec.relation.trim() || undefined, phone: e164(ec.phone) } : null,
  };
}
type MotherPayload = ReturnType<typeof motherPayload>;

/** Only what was entered: empty fields are left out (a returning mother's other details stay as they are). */
export function enteredOnly(p: MotherPayload): Partial<MotherPayload> {
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== '' && v !== null && v !== undefined && !(k === 'dob_estimated' && v === false)));
}

/** `update_mother`: the fields that changed, and nothing else (the server keeps the rest). */
export function motherUpdatePayload(before: MotherDetails, after: MotherDetails): Partial<MotherPayload> {
  const a = motherPayload(before);
  const b = motherPayload(after);
  return Object.fromEntries((Object.keys(b) as (keyof MotherPayload)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, b[k]]));
}

type PlannedTest = { id: Id; code: string; dueFrom: Date; dueBy: Date; late: boolean };
type PlannedVisit = { id: Id; kind: string; title: string; dueFrom?: Date; dueBy: Date };

/**
 * `register_pregnancy` — every key of its allowlist that the clinician filled in, nothing invented. Without a dating
 * (the registration form) there is no `dating`, no `ga_days` and no plan: those come with the first dating.
 */
export function registerPayload(input: RegisterInput, plan: { motherId: MotherId; pregnancyId: PregnancyId; investigations: PlannedTest[]; tasks: PlannedVisit[] }) {
  const edd = input.dating && eddFor(input.dating);
  const h = input.history;
  return {
    mother: { id: plan.motherId, ...enteredOnly(motherPayload(input.mother)) },
    pregnancy: {
      id: plan.pregnancyId,
      registered_on: input.registeredOn.toISOString(),
      gravida: input.gpla.g,
      para: input.gpla.p,
      living: input.gpla.l,
      abortions: input.gpla.a,
      fetuses: input.fetuses,
    },
    dating: input.dating && registerDatingPayload(input.dating),
    history: {
      conditions: h.conditions,
      allergies: h.allergies,
      medicines: h.medicines,
      blood_group: h.bloodGroup,
      height_cm: h.heightCm,
      weight_kg: h.weightKg,
      previous: input.previous.map((x) => ({
        year: x.year,
        // A label without a code is sent as typed: the server refuses it (visible), it is never guessed.
        outcome: previousOutcomeCodes.code(x.outcome) ?? x.outcome,
        mode: x.mode ? (previousModeCodes.code(x.mode) ?? x.mode) : undefined,
        gestation_weeks: x.gestationWeeks,
        complications: x.complications?.length ? x.complications : undefined,
        note: x.note,
      })),
    },
    team_id: input.teamId,
    intensity: input.intensity,
    tags: input.tagCodes,
    tag_note: input.tagCodes.length ? input.tagNote : undefined,
    investigations: plan.investigations.map((i) => ({ id: i.id, code: i.code, due_from: isoDay(i.dueFrom), due_by: isoDay(i.dueBy), late: i.late })),
    tasks: plan.tasks.map((t) => ({ id: t.id, kind: t.kind, title: t.title, due_from: t.dueFrom && isoDay(t.dueFrom), due_by: isoDay(t.dueBy) })),
    ga_days: edd && gestationalAge(edd, input.registeredOn).totalDays,
  };
}

/**
 * `redate_pregnancy` — the dating, the ANC visits it re-plans and, at the FIRST dating of a pregnancy registered
 * without one, the test windows (what registration used to plan).
 */
export function redatePayload(
  pregnancyId: PregnancyId,
  input: RegisterDating,
  plan: { cancelled: Id[]; tasks: PlannedVisit[]; investigations?: PlannedTest[] },
  at: Date,
) {
  return {
    pregnancy_id: pregnancyId,
    dating: registerDatingPayload(input),
    cancel_task_ids: plan.cancelled,
    new_tasks: plan.tasks.map((t) => ({ id: t.id, kind: t.kind, title: t.title, due_from: t.dueFrom && isoDay(t.dueFrom), due_by: isoDay(t.dueBy) })),
    investigations: plan.investigations?.length
      ? plan.investigations.map((i) => ({ id: i.id, code: i.code, due_from: isoDay(i.dueFrom), due_by: isoDay(i.dueBy), late: i.late }))
      : undefined,
    at: at.toISOString(),
  };
}

// ── Prescriptions ─────────────────────────────────────────────────────────────────

export const SLOTS: readonly DoseSlot[] = ['morning', 'afternoon', 'night'];

/** Free text typed by the clinician — the app never suggests a medicine, dose or schedule. */
export type PrescriptionInput = { name: string; dose?: string; slots: DoseSlot[]; instructions?: string };
export type Subject = { pregnancyId: PregnancyId; babyId?: undefined } | { babyId: BabyId; pregnancyId?: undefined };

export function prescriptionProblem(input: PrescriptionInput): string | undefined {
  if (!input.name.trim()) return 'Enter the medicine as prescribed.';
  if (!input.slots.length) return 'Choose at least one time of day.';
  return undefined;
}

/** `prescribe` payload (one subject: the pregnancy xor the baby). */
export function prescribePayload(id: Id, subject: Subject, input: PrescriptionInput, today: Date) {
  return {
    id,
    ...(subject.babyId ? { baby_id: subject.babyId } : { pregnancy_id: subject.pregnancyId }),
    name: input.name.trim(),
    dose: input.dose?.trim() || undefined,
    // In the fixed morning → night order, each once.
    slots: SLOTS.filter((s) => input.slots.includes(s)),
    instructions: input.instructions?.trim() || undefined,
    start_on: isoDay(today),
  };
}

// ── Visits, newborn observations and their corrections ────────────────────────────

const VITAL_CODES: [keyof Visit['vitals'], string][] = [
  ['weightKg', 'weight'],
  ['bpSys', 'bp_sys'],
  ['bpDia', 'bp_dia'],
  ['pulse', 'pulse'],
  ['fundalHeightCm', 'fundal_height'],
  ['fhr', 'fhr'],
  ['presentation', 'presentation'],
  ['urineAlbumin', 'urine_albumin'],
  ['urineSugar', 'urine_sugar'],
  ['oedema', 'oedema'],
  ['fetalMovements', 'fetal_movements'],
];

/** A visit's values as coded observations, exactly as entered (numbers as numbers, choices as text). */
export function visitObservationRows(vitals: Visit['vitals']) {
  return VITAL_CODES.flatMap(([k, code]) => {
    const v = vitals[k];
    if (v === undefined || v === '') return [];
    return [typeof v === 'number' ? { code, value_num: v } : { code, value_text: v }];
  });
}

/** What a visit records (record_visit and correct_visit share these keys). */
export type VisitRecord = Pick<Visit, 'vitals' | 'checklist' | 'complaints' | 'counselling' | 'note'>;

/** The recorded part of a visit payload: observations, checklist, complaint and counselling codes, completeness. */
export function visitBody(input: VisitRecord, at: Date, edd: Date | undefined) {
  const counted = Object.values(input.checklist).filter((c) => c.state !== 'na');
  const { codes, note: complaintsNote } = splitComplaints(input.complaints);
  return {
    at: at.toISOString(),
    ga_days: edd && gestationalAge(edd, at).totalDays,
    observations: visitObservationRows(input.vitals),
    checklist: Object.entries(input.checklist).map(([component, c]) => ({ component, state: c.state, reason: c.reason })),
    complaints: codes,
    complaints_note: complaintsNote,
    counselling: (input.counselling ?? []).flatMap((l) => counsellingCodes.code(l) ?? []),
    note: input.note,
    completeness: counted.length ? Math.round((counted.filter((c) => c.state === 'done').length / counted.length) * 1000) / 1000 : undefined,
  };
}

/** `correct_visit`: the visit `oldId` replaced by `newId` (the server withdraws the old version as "Corrected"). */
export function correctVisitPayload(oldId: Id, newId: Id, input: VisitRecord, at: Date, edd: Date | undefined) {
  return { id: oldId, encounter_id: newId, ...visitBody(input, at, edd) };
}

/** A newborn observation's values as coded observations, exactly as recorded. */
export function newbornObservationRows(o: Omit<NewbornObs, 'id' | 'babyId' | 'at' | 'by' | 'note'>) {
  return [
    o.weightG !== undefined && { code: 'nb_weight', value_num: o.weightG },
    o.tempC !== undefined && { code: 'nb_temp', value_num: o.tempC },
    o.respRate !== undefined && { code: 'nb_resp_rate', value_num: o.respRate },
    o.feeding && { code: 'nb_feeding', value_text: o.feeding },
    o.jaundice && { code: 'nb_jaundice', value_text: o.jaundice },
    o.lengthCm !== undefined && { code: 'nb_length', value_num: o.lengthCm },
    o.headCircCm !== undefined && { code: 'nb_head_circ', value_num: o.headCircCm },
  ].filter((x): x is { code: string; value_num: number } | { code: string; value_text: string } => !!x);
}

/** `correct_newborn_obs`: the observation `oldId` replaced by `newId`. */
export function correctNewbornPayload(oldId: Id, newId: Id, o: Omit<NewbornObs, 'id' | 'babyId' | 'by'>) {
  return { id: oldId, encounter_id: newId, at: o.at.toISOString(), observations: newbornObservationRows(o), note: o.note?.trim() || undefined };
}

/** "11.2 g/dL" → a number and its unit; anything else is kept as text, exactly as entered. */
export function resultValue(value: string, unit?: string) {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s][^\d]*)?$/);
  return m ? { value_num: Number(m[1]), unit: unit ?? m[2]?.trim() } : { value_text: value.trim(), unit };
}

/** A result as entered, corrected: the value (and unit), the note and the date tested. */
export type ResultCorrection = { value: string; unit?: string; note?: string; testedAt: Date };

/** `correct_result`: the shown result `resultId` replaced by `newId` (the test's version is stamped by the outbox). */
export function correctResultPayload(resultId: Id, newId: Id, c: ResultCorrection) {
  return { result_id: resultId, id: newId, ...resultValue(c.value, c.unit), note: c.note?.trim() || undefined, reported_at: c.testedAt.toISOString() };
}

/** A documented history entry, corrected (as documented). */
export type FactCorrection =
  | { kind: 'condition'; label: string }
  | { kind: 'allergy'; substance: string }
  | { kind: 'previous_pregnancy'; previous: PrevPregnancy };

/** `correct_fact`: exactly the keys of the entry's kind (outcome and mode as codes; a label without one is sent as typed). */
export function correctFactPayload(oldId: Id, newId: Id, c: FactCorrection) {
  const base = { kind: c.kind, id: oldId, new_id: newId };
  switch (c.kind) {
    case 'condition':
      return { ...base, label: c.label.trim() };
    case 'allergy':
      return { ...base, substance: c.substance.trim() };
    case 'previous_pregnancy': {
      const x = c.previous;
      return {
        ...base,
        year: x.year,
        outcome: previousOutcomeCodes.code(x.outcome) ?? x.outcome,
        mode: x.mode ? (previousModeCodes.code(x.mode) ?? x.mode) : undefined,
        gestation_weeks: x.gestationWeeks,
        complications: x.complications?.length ? x.complications : undefined,
        note: x.note?.trim() || undefined,
      };
    }
  }
}

/** The label a corrected history entry is listed with. */
export function factLabel(c: FactCorrection) {
  return c.kind === 'condition' ? c.label.trim() : c.kind === 'allergy' ? c.substance.trim() : previousLabel(c.previous);
}

/** `reschedule_investigation`: the test's new due window (calendar days) and why it moved. */
export function rescheduleTestPayload(id: Id, dueFrom: Date, dueBy: Date, reason: string, at: Date) {
  return { id, due_from: isoDay(dueFrom), due_by: isoDay(dueBy), reason: reason.trim(), at: at.toISOString() };
}

// ── Entered in error, caregivers, notifications, overrides ────────────────────────

export function eiePayload(kind: EieKind, id: Id, reason: string, at: Date) {
  return { kind, id, reason: reason.trim(), at: at.toISOString() };
}

/** `update_caregiver.scopes`: every scope stated, so the server never keeps a value the mother did not see. */
export function caregiverScopesPayload(s: CaregiverScopes) {
  return { schedule: s.schedule, baby: s.baby, logs: s.logs, tests: s.tests };
}

/** `mark_notifications_read`: the rows read, or all of them. */
export function notificationsReadPayload(ids: Id[] | 'all') {
  return ids === 'all' ? { all: true } : { ids };
}

/** An override counts until it ends or expires. */
export const overrideActive = (o: AccessOverride, now: Date) => o.expiresAt.getTime() > now.getTime();

/** A typed or scanned code → the MCH id it carries (the baby suffix is dropped; access is to the mother). */
export function mchIdIn(text: string): string | undefined {
  return text.toUpperCase().match(/MCH-\d{4}-\d{6}/)?.[0];
}

/** Reasons are required and the database wants at least 3 characters. */
export const reasonOk = (r: string) => r.trim().length >= 3;
