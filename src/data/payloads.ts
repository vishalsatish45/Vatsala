/**
 * Pure request builders for the record-keeping RPCs (supabase/migrations/2026100500030*, 0400*, 0600*).
 * Each one maps the app's shape to the RPC allowlist explicitly — no payload is written
 * wholesale, and an unknown key would be refused by the server. Dates only; no clinical interpretation.
 */
import { addDays, daysBetween, eddFromLmp, gestationalAge, PREGNANCY_DAYS } from '@domain/gestation';
import type { Intensity } from '@domain/schedules';

import { previousModeCodes, previousOutcomeCodes } from './codes';
import { e164, isoDay } from './remote';
import type { AccessOverride, BabyId, CaregiverScopes, DoseSlot, EieKind, Id, Mother, MotherId, Pregnancy, PregnancyId, TeamId } from './types';

// ── Re-dating ─────────────────────────────────────────────────────────────────────

/** How the clinician dates the pregnancy. The app shows the resulting EDD; it never chooses between datings. */
export type RedateInput =
  | { method: 'lmp'; lmp: Date; note?: string }
  | { method: 'scan'; scanOn: Date; gaAtScanDays: number; note?: string }
  | { method: 'clinician'; edd: Date; note?: string };

/** The EDD a dating gives, by calendar arithmetic only (LMP + 280 days; scan date + days remaining). */
export function eddFor(input: RedateInput): Date {
  switch (input.method) {
    case 'lmp':
      return eddFromLmp(input.lmp);
    case 'scan':
      return addDays(input.scanOn, PREGNANCY_DAYS - input.gaAtScanDays);
    case 'clinician':
      return input.edd;
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
  | { method: 'clinician'; edd: Date; note?: string };

/** A mother's details as the forms produce them: empty strings / undefined = not documented. */
export type MotherDetails = Omit<Mother, 'id' | 'ipNo'>;

/** One registration, exactly as entered (src/features/care/forms.ts makeRegisterSchema). */
export type RegisterInput = {
  mother: MotherDetails;
  /** A returning mother the clinician confirmed (find_mother): her record is reused and corrected from the form. */
  existingMotherId?: MotherId;
  registeredOn: Date;
  /**
   * Absent from the registration form: the doctor records the dating later (redate_pregnancy, first dating). A
   * register import still carries each row's LMP.
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
  return { ...datingPayload(d), lmp_certain: d.method === 'lmp' ? d.lmpCertain : undefined };
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
