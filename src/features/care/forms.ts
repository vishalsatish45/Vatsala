/**
 * Care Team form schemas: one Zod schema per form, the form's field types inferred from it,
 * its parsed output shaped for the store action the form calls. Messages shown to the clinician live here.
 *
 * Hackathon rule: clinical values are stored exactly as entered. The only number checks are "is this physically
 * possible" typing guards ("Check value"); nothing here grades, colours or interprets a reading.
 */
import { z } from 'zod';
import { daysBetween, PREGNANCY_DAYS } from '@domain/gestation';
import { expectedComponents, type ComponentState } from '@domain/schedules';

import { BLOOD_GROUPS, PREVIOUS_MODES, PREVIOUS_OUTCOMES } from '@/data/codes';
import { asMotherId, asStaffId, asTeamId } from '@/data/ids';
import { eddFor, type MotherDetails, type RegisterDating } from '@/data/payloads';
import type { DeliveryInput, RegisterInput, VisitInput } from '@/data/store';
import type { CaptureField, ChecklistState, Mother, Referral } from '@/data/types';

// ── shared pieces ─────────────────────────────────────────────────────────────────

const text = z.string();
const choice = z.string().optional();
const list = z.array(z.string());
const intensity = z.enum(['routine', 'enhanced', 'close']);
const MOBILE = /^[6-9]\d{9}$/;
const trimmedOrUndefined = (s: string) => s.trim() || undefined;

/** A typed number as the store keeps it: '' → not recorded; a comma decimal is accepted. */
export const numText = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

/** A typing guard only: an empty field is fine, a value outside what is physically possible reads "Check value". */
const reading = (lo: number, hi: number) =>
  text.refine((s) => {
    const v = numText(s);
    return v === undefined || (v >= lo && v <= hi);
  }, 'Check value');

// ── CT-61…66 Register pregnancy · a mother's details ─────────────────────────────
//
// Every bound below is the server's (register_pregnancy / update_mother, supabase/migrations/20261005000980): a form
// that passes here is not refused there for its input, so an optimistic save never vanishes on reload.

export const LANGUAGES = { English: 'en', Kannada: 'kn', Hindi: 'hi' } as const;
type LangLabel = keyof typeof LANGUAGES;
const LANG_LABEL: Record<Mother['lang'], LangLabel> = { en: 'English', kn: 'Kannada', hi: 'Hindi' };

/** Parses DD-MM-YYYY (or / .) into a UTC date. An impossible day (31-02-2026) is refused, never rolled over. */
export function parseDayMonthYear(s: string): Date | undefined {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : undefined;
}

/** The calendar day a picker shows (the phone's local day) as the UTC-midnight date the domain arithmetic uses. */
export const calendarDay = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
/** A UTC-midnight date as the phone's local day (what a picker expects). */
export const localDay = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;

const isWhole = (s: string) => /^\d+$/.test(s.trim());
/** A typed whole number from lo to hi (the server refuses fractions and anything outside the column's range). */
export const wholeIn = (s: string, lo: number, hi: number) => isWhole(s) && Number(s) >= lo && Number(s) <= hi;
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const trimmed = (s: string) => s.trim() || undefined;

export const EC_RELATIONS = ['Husband', 'Mother', 'Father', 'Mother-in-law', 'Sister', 'Brother'] as const;

/** A mother's details: the identity step of registration, and the "Edit details" form. */
const motherFields = {
  name: text,
  age: text,
  phone: text,
  altPhone: text,
  lang: z.enum(['English', 'Kannada', 'Hindi']),
  village: text,
  district: text,
  state: text,
  pincode: text,
  husbandName: text,
  dobText: text,
  dobEstimated: z.boolean(),
  ecName: text,
  ecRelation: text,
  ecPhone: text,
  rchId: text,
  abhaNumber: text,
  abhaAddress: text,
};
type MotherFieldValues = z.input<z.ZodObject<typeof motherFields>>;

export const blankMother = (): MotherFieldValues => ({
  name: '', age: '', phone: '', altPhone: '', lang: 'Kannada', village: '', district: '', state: '', pincode: '', husbandName: '',
  dobText: '', dobEstimated: false, ecName: '', ecRelation: '', ecPhone: '', rchId: '', abhaNumber: '', abhaAddress: '',
});

/** Form values for details already on record (Edit details; a returning mother found by phone). */
export function motherFormValues(m: Partial<MotherDetails>): MotherFieldValues {
  const ec = m.emergencyContact;
  return {
    ...blankMother(),
    name: m.name ?? '',
    age: m.age ? String(m.age) : '',
    phone: m.phone ?? '',
    altPhone: m.altPhone ?? '',
    lang: m.lang ? LANG_LABEL[m.lang] : 'Kannada',
    village: m.village ?? '',
    district: m.district ?? '',
    state: m.state ?? '',
    pincode: m.pincode ?? '',
    husbandName: m.husbandName ?? '',
    dobText: m.dob ? ddmmyyyy(m.dob) : '',
    dobEstimated: !!m.dobEstimated,
    ecName: ec?.name ?? '',
    ecRelation: ec?.relation ?? '',
    ecPhone: ec?.phone ?? '',
    rchId: m.rchId ?? '',
    abhaNumber: m.abhaNumber ?? '',
    abhaAddress: m.abhaAddress ?? '',
  };
}

function checkMother(v: MotherFieldValues, ctx: z.RefinementCtx, now: Date) {
  const at = (path: keyof MotherFieldValues, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const name = v.name.trim();
  if (!name) at('name', 'Enter her full name');
  else if (name.length > 120) at('name', 'Name: up to 120 characters');
  if (!wholeIn(v.age, 10, 60)) at('age', 'Age: a whole number from 10 to 60');
  if (!MOBILE.test(v.phone)) at('phone', 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9');
  if (v.altPhone && !MOBILE.test(v.altPhone)) at('altPhone', 'Alternate number: 10 digits starting with 6, 7, 8 or 9');
  else if (v.altPhone && v.altPhone === v.phone) at('altPhone', 'The alternate number must differ from her mobile');
  if (v.pincode.trim() && !/^[1-9]\d{5}$/.test(v.pincode.trim())) at('pincode', 'PIN code: 6 digits, not starting with 0');
  if (v.husbandName.trim().length > 120) at('husbandName', 'Up to 120 characters');
  if (v.dobText.trim()) {
    const dob = parseDayMonthYear(v.dobText);
    if (!dob) at('dobText', 'Date of birth as DD-MM-YYYY');
    else if (dob.getTime() > calendarDay(now).getTime()) at('dobText', 'The date of birth cannot be in the future');
  }
  if (v.ecName.trim() || v.ecRelation.trim() || v.ecPhone) {
    if (!v.ecName.trim()) at('ecName', "Add the emergency contact's name");
    if (!MOBILE.test(v.ecPhone)) at('ecPhone', 'Emergency contact: 10 digits starting with 6, 7, 8 or 9');
  }
  if (v.rchId.trim() && !/^\d{12}$/.test(v.rchId.trim())) at('rchId', 'An RCH id has 12 digits');
  if (v.abhaNumber.trim() && !/^\d{14}$/.test(v.abhaNumber.trim())) at('abhaNumber', 'An ABHA number has 14 digits');
  if (v.abhaAddress.trim() && !/^[a-z0-9._]+@[a-z]+$/.test(v.abhaAddress.trim())) at('abhaAddress', 'An ABHA address looks like name@abdm');
}

/** The details exactly as entered; blank optional fields stay absent (nothing is filled in for her). */
function motherDetailsOf(v: MotherFieldValues): MotherDetails {
  const dob = parseDayMonthYear(v.dobText);
  return {
    name: v.name.trim(),
    age: Number(v.age),
    phone: v.phone,
    altPhone: trimmed(v.altPhone),
    lang: LANGUAGES[v.lang],
    village: v.village.trim(),
    district: trimmed(v.district),
    state: trimmed(v.state),
    pincode: trimmed(v.pincode),
    husbandName: trimmed(v.husbandName),
    dob,
    dobEstimated: dob ? v.dobEstimated : undefined,
    emergencyContact: v.ecPhone ? { name: v.ecName.trim(), relation: v.ecRelation.trim(), phone: v.ecPhone } : { name: '', relation: '', phone: '' },
    rchId: trimmed(v.rchId),
    abhaNumber: trimmed(v.abhaNumber),
    abhaAddress: trimmed(v.abhaAddress),
  };
}

/** CT-20 "Edit details": correct a mother's details (update_mother). */
export function makeMotherSchema(now: Date) {
  return z
    .object(motherFields)
    .superRefine((v, ctx) => checkMother(v, ctx, now))
    .transform(motherDetailsOf);
}
export type MotherForm = z.input<ReturnType<typeof makeMotherSchema>>;

export const DATING_METHODS = { LMP: 'lmp', Scan: 'scan', 'Clinician EDD': 'clinician' } as const;
export const LMP_CERTAINTY = ['Certain', 'Uncertain'] as const;
export const OTHER_CONDITION = 'Other';
export const MAX_PREVIOUS = 20;

const previousRow = z.object({
  year: text,
  outcome: z.enum(PREVIOUS_OUTCOMES).optional(),
  mode: z.enum(PREVIOUS_MODES).optional(),
  weeks: text,
  complications: text,
  note: text,
});
export type PreviousRow = z.input<typeof previousRow>;
export const blankPrevious = (): PreviousRow => ({ year: '', weeks: '', complications: '', note: '' });

type DatingValues = { method: keyof typeof DATING_METHODS; lmp?: Date; lmpCertain?: (typeof LMP_CERTAINTY)[number]; scanOn: Date; scanWeeks: string; scanDays: string; eddDecided?: Date; datingNote: string };

/** The dating the form describes (the clinician's choice), or undefined while it is incomplete. */
export function registerDating(v: DatingValues): RegisterDating | undefined {
  const note = trimmed(v.datingNote);
  switch (DATING_METHODS[v.method]) {
    case 'lmp':
      return v.lmp ? { method: 'lmp', lmp: calendarDay(v.lmp), lmpCertain: v.lmpCertain ? v.lmpCertain === 'Certain' : undefined, note } : undefined;
    case 'scan':
      if (!wholeIn(v.scanWeeks, 4, 42) || (v.scanDays.trim() !== '' && !wholeIn(v.scanDays, 0, 6))) return undefined;
      return { method: 'scan', scanOn: calendarDay(v.scanOn), gaAtScanDays: Number(v.scanWeeks) * 7 + Number(v.scanDays || 0), note };
    case 'clinician':
      return v.eddDecided ? { method: 'clinician', edd: calendarDay(v.eddDecided), note } : undefined;
  }
}

/** Days of gestation the dating gives on a day (calendar arithmetic only). */
export const gaDaysOn = (d: RegisterDating, day: Date) => PREGNANCY_DAYS - daysBetween(day, eddFor(d));

export const gplaOf = (v: { g: string; p: string; l: string; a: string }) => ({ g: Number(v.g) || 0, p: Number(v.p) || 0, l: Number(v.l) || 0, a: Number(v.a) || 0 });

/** Which fields each registration step owns — "Next" stays disabled while any of them has an issue. */
export const REGISTER_STEPS = [
  ['name', 'age', 'phone', 'altPhone', 'lang', 'village', 'district', 'state', 'pincode', 'husbandName', 'dobText', 'ecName', 'ecRelation', 'ecPhone', 'rchId', 'abhaNumber', 'abhaAddress', 'returningId'],
  ['registeredOn', 'method', 'lmp', 'lmpCertain', 'scanOn', 'scanWeeks', 'scanDays', 'eddDecided', 'datingNote', 'g', 'p', 'l', 'a', 'fetuses', 'previous'],
  ['conditions', 'otherCondition', 'allergies', 'medicines', 'blood', 'height', 'tags', 'tagNote', 'intensity', 'teamId'],
] as const;

/** `units`: the obstetric units the clinician may register into; with several, she must choose one. */
export function makeRegisterSchema(now: Date, opts: { units?: readonly string[] } = {}) {
  return z
    .object({
      ...motherFields,
      /** A returning mother the clinician confirmed (find_mother). */
      returningId: z.string().optional(),
      registeredOn: z.date(),
      method: z.enum(['LMP', 'Scan', 'Clinician EDD']),
      lmp: z.date().optional(),
      lmpCertain: z.enum(LMP_CERTAINTY).optional(),
      scanOn: z.date(),
      scanWeeks: text,
      scanDays: text,
      eddDecided: z.date().optional(),
      datingNote: text,
      g: text,
      p: text,
      l: text,
      a: text,
      fetuses: z.enum(['1', '2', '3', '4']),
      previous: z.array(previousRow),
      conditions: list,
      otherCondition: text,
      allergies: text,
      medicines: text,
      blood: choice,
      height: text,
      tags: list,
      tagNote: text,
      intensity,
      teamId: choice,
    })
    .superRefine((v, ctx) => {
      const at = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
      checkMother(v, ctx, now);

      // Dating (pregnancy_datings, encounters.ga_days 0–320).
      const today = calendarDay(now);
      const method = DATING_METHODS[v.method];
      const field = method === 'lmp' ? 'lmp' : method === 'scan' ? 'scanWeeks' : 'eddDecided';
      const reg = calendarDay(v.registeredOn);
      if (reg.getTime() > today.getTime()) at(['registeredOn'], 'The registration date cannot be in the future');
      const d = registerDating(v);
      if (!d) at([field], method === 'lmp' ? 'Pick the first day of her last period' : method === 'scan' ? 'GA at the scan: 4–42 weeks and 0–6 days' : 'Pick the EDD you decided');
      else if (d.method === 'lmp' && d.lmp.getTime() > today.getTime()) at(['lmp'], 'The LMP cannot be in the future');
      else if (d.method === 'scan' && d.scanOn.getTime() > today.getTime()) at(['scanOn'], 'The scan date cannot be in the future');
      else {
        const ga = gaDaysOn(d, reg);
        if (ga < 0 || ga > 320) at([field], 'This dating gives a gestational age outside 0–45 weeks on the registration date');
      }
      if (v.datingNote.length > 500) at(['datingNote'], 'Note: up to 500 characters');

      // Obstetric summary (pregnancies: G 1–20, P/L/A 0–20, P + A ≤ G − 1 for a current pregnancy).
      if (!wholeIn(v.g, 1, 20)) at(['g'], 'G: a whole number from 1 to 20');
      else if (![v.p, v.l, v.a].every((x) => wholeIn(x, 0, 20))) at(['g'], 'P, L and A: whole numbers from 0 to 20');
      else if (Number(v.p) + Number(v.a) > Number(v.g) - 1) at(['g'], 'P + A must be ≤ G − 1 for a current pregnancy');

      // Previous pregnancies (previous_pregnancies: year 1960–this year, an outcome, 4–45 weeks).
      if (v.previous.length > MAX_PREVIOUS) at(['previous'], `At most ${MAX_PREVIOUS} previous pregnancies`);
      v.previous.forEach((r, i) => {
        if (!wholeIn(r.year, 1960, now.getUTCFullYear())) at(['previous', i, 'year'], `Previous pregnancy ${i + 1}: year 1960–${now.getUTCFullYear()}`);
        if (!r.outcome) at(['previous', i, 'outcome'], `Previous pregnancy ${i + 1}: choose the outcome`);
        if (r.weeks.trim() && !wholeIn(r.weeks, 4, 45)) at(['previous', i, 'weeks'], `Previous pregnancy ${i + 1}: gestation 4–45 weeks`);
      });

      // History (observation codes: blood group codes, height 100–220 cm).
      if (v.conditions.includes(OTHER_CONDITION) && !v.otherCondition.trim()) at(['otherCondition'], 'Name the other condition as documented');
      if (v.blood && v.blood !== 'Unknown' && !(BLOOD_GROUPS as readonly string[]).includes(v.blood)) at(['blood'], 'Choose a blood group');
      const h = numText(v.height);
      if (h !== undefined && !(h >= 100 && h <= 220)) at(['height'], 'Height: 100–220 cm');
      if (opts.units?.length && !opts.units.includes(v.teamId ?? '')) at(['teamId'], 'Choose her obstetric unit');
    })
    .transform((v): RegisterInput => {
      const reg = calendarDay(v.registeredOn);
      const sameDay = reg.getTime() === calendarDay(now).getTime();
      return {
        mother: motherDetailsOf(v),
        existingMotherId: v.returningId ? asMotherId(v.returningId) : undefined,
        // Today → this moment; a back-entered day → noon of that day (so the date is the same in every time zone).
        registeredOn: sameDay ? now : new Date(v.registeredOn.getFullYear(), v.registeredOn.getMonth(), v.registeredOn.getDate(), 12),
        dating: registerDating(v)!,
        gpla: gplaOf(v),
        fetuses: Number(v.fetuses),
        history: {
          conditions: [...v.conditions.filter((c) => c !== OTHER_CONDITION), ...(v.conditions.includes(OTHER_CONDITION) ? [v.otherCondition.trim()] : [])],
          allergies: csv(v.allergies),
          medicines: csv(v.medicines),
          bloodGroup: v.blood && v.blood !== 'Unknown' ? v.blood : undefined,
          heightCm: numText(v.height),
        },
        previous: v.previous.map((r) => ({
          year: Number(r.year),
          outcome: r.outcome!,
          mode: r.mode,
          gestationWeeks: r.weeks.trim() ? Number(r.weeks) : undefined,
          complications: csv(r.complications).length ? csv(r.complications) : undefined,
          note: trimmed(r.note),
        })),
        tagCodes: v.tags,
        tagNote: v.tags.length ? trimmed(v.tagNote) : undefined,
        intensity: v.intensity,
        teamId: v.teamId ? asTeamId(v.teamId) : undefined,
      };
    });
}
export type RegisterForm = z.input<ReturnType<typeof makeRegisterSchema>>;

/** A blank registration (nothing pre-selected beyond the form's own defaults: today, LMP dating, one fetus, routine). */
export const blankRegisterForm = (now: Date): RegisterForm => ({
  ...blankMother(),
  registeredOn: now,
  method: 'LMP',
  scanOn: now,
  scanWeeks: '',
  scanDays: '',
  datingNote: '',
  g: '',
  p: '',
  l: '',
  a: '',
  fetuses: '1',
  previous: [],
  conditions: [],
  otherCondition: '',
  allergies: '',
  medicines: '',
  height: '',
  tags: [],
  tagNote: '',
  intensity: 'routine',
});

// ── CT-30 Record ANC visit ───────────────────────────────────────────────────────

export const OTHER_COMPLAINT = 'Other';

const gap = z.object({ state: z.enum(['done', 'not_done', 'na']), reason: z.string().optional() });

const visitFields = z.object({
  weight: reading(25, 200),
  sys: reading(60, 250),
  dia: reading(30, 160),
  pulse: text,
  fundal: text,
  fhr: reading(60, 220),
  albumin: choice,
  sugar: choice,
  oedema: choice,
  presentation: choice,
  movements: choice,
  ifa: z.boolean(),
  counselling: list,
  complaints: list,
  otherComplaint: text,
  nextOn: z.date(),
  /** Expected components the clinician marked N/A or not done (with a reason) instead of recording. */
  gaps: z.record(z.string(), gap),
});
export type VisitForm = z.input<typeof visitFields>;

/** Which checklist components the entered values already cover. */
export function visitRecorded(v: VisitForm): Record<string, ComponentState | undefined> {
  return {
    bp: v.sys && v.dia ? 'done' : undefined,
    weight: v.weight ? 'done' : undefined,
    urine_albumin: v.albumin ? 'done' : undefined,
    fundal_height: v.fundal ? 'done' : undefined,
    fhr: v.fhr ? 'done' : undefined,
    fetal_movements: v.movements ? 'done' : undefined,
    presentation: v.presentation ? 'done' : undefined,
    ifa: v.ifa ? 'done' : undefined,
    counselling: v.counselling.length ? 'done' : undefined,
    next_visit: 'done',
  };
}

/** "Other" is stored as the text the clinician wrote, so the record reads as one list. */
export const visitComplaints = (v: Pick<VisitForm, 'complaints' | 'otherComplaint'>) =>
  v.complaints.flatMap((c) => (c !== OTHER_COMPLAINT ? [c] : v.otherComplaint.trim() ? [`Other: ${v.otherComplaint.trim()}`] : []));

export function makeVisitSchema(gaWeeks: number) {
  return visitFields.transform((v): VisitInput => {
    const recorded = visitRecorded(v);
    const checklist: Record<string, { state: ChecklistState; reason?: string }> = Object.fromEntries(
      expectedComponents(gaWeeks).map((c) => [c.key, recorded[c.key] === 'done' ? { state: 'done' as const } : (v.gaps[c.key] ?? { state: 'not_done' as const, reason: 'Not recorded' })]),
    );
    return {
      vitals: {
        weightKg: numText(v.weight),
        bpSys: numText(v.sys),
        bpDia: numText(v.dia),
        pulse: numText(v.pulse),
        fundalHeightCm: numText(v.fundal),
        fhr: numText(v.fhr),
        presentation: v.presentation,
        urineAlbumin: v.albumin,
        urineSugar: v.sugar,
        oedema: v.oedema,
      },
      checklist,
      complaints: visitComplaints(v),
      nextVisitOn: v.nextOn,
    };
  });
}

// ── CT-27 Tags & follow-up intensity ─────────────────────────────────────────────

/** `current` = the tag codes active when the screen opened: removing one needs a note. */
export function makeTagsSchema(current: readonly string[]) {
  return z
    .object({ codes: list, intensity, note: text })
    .superRefine((v, ctx) => {
      const removed = current.some((c) => !v.codes.includes(c));
      if (removed && !v.note.trim()) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Please add a note explaining why a tag was removed.' });
    })
    .transform((v) => ({ codes: v.codes, intensity: v.intensity, note: trimmedOrUndefined(v.note) }));
}

// ── CT-51 New referral ───────────────────────────────────────────────────────────

export const URGENCY = { Routine: 'routine', 'Within 24 h': '24h', Emergency: 'emergency' } as const satisfies Record<string, Referral['urgency']>;

export const referSchema = z
  .object({ dept: choice, urgency: z.enum(['Routine', 'Within 24 h', 'Emergency']), reason: text, question: text })
  .superRefine((v, ctx) => {
    if (!v.dept || !v.reason.trim()) ctx.addIssue({ code: 'custom', path: ['dept'], message: 'Choose a department and add the reason.' });
  })
  .transform((v) => ({ department: v.dept ?? '', urgency: URGENCY[v.urgency], reason: v.reason.trim(), question: v.question.trim() }));

// ── CT-56/57 Delivery record ─────────────────────────────────────────────────────

/** Pick-list labels → server codes (deliveries.place, deliveries.labour_onset). */
export const BIRTH_PLACES = { 'This facility': 'this_facility', 'Other facility': 'other_facility', Home: 'home', 'In transit': 'in_transit' } as const;
export const LABOUR_ONSETS = { Spontaneous: 'spontaneous', Induced: 'induced', 'No labour (elective LSCS)': 'no_labour' } as const;
export const PERINEUM = ['Intact', '1st degree tear', '2nd degree tear', '3rd degree tear', '4th degree tear', 'Episiotomy', 'Not applicable (LSCS)'] as const;
export const MAX_BABIES = 4;

const babyFields = z.object({
  sex: z.enum(['F', 'M', 'U']).optional(),
  weight: text,
  length: text,
  head: text,
  apgar1: text,
  apgar5: text,
  outcome: z.enum(['live', 'stillbirth']),
  stillbirthType: z.enum(['fresh', 'macerated']).optional(),
  resuscitation: z.boolean(),
  defects: text,
  breastfed: z.boolean(),
  vitaminK: z.boolean(),
  birthDoses: z.boolean(),
});
export const blankBaby = (): z.input<typeof babyFields> => ({
  weight: '', length: '', head: '', apgar1: '', apgar5: '', outcome: 'live', resuscitation: false, defects: '', breastfed: false, vitaminK: true, birthDoses: true,
});

const pad = (n: number) => String(n).padStart(2, '0');
/** The form's date and time text for an instant: "02-10-2026", "14:05" (the phone's local time). */
export const dateText = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
export const timeText = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Exact time of birth from "DD-MM-YYYY" and "HH:MM" (24-hour, the phone's local time); undefined if unreadable. */
export function birthTime(date: string, time: string): Date | undefined {
  const d = date.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const t = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!d || !t) return undefined;
  const [day, month, year, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (hour > 23 || minute > 59) return undefined;
  const at = new Date(year, month - 1, day, hour, minute);
  // reject 31-02 and the like (Date would roll it over into March)
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day ? at : undefined;
}

const num = (s: string) => (s.trim() ? Number(s) : undefined);
const inRange = (s: string, lo: number, hi: number) => !s.trim() || (Number(s) >= lo && Number(s) <= hi);

/**
 * CT-56/57: everything the server's record_delivery accepts, as documented. `edd` bounds the time of birth to the
 * server's 20–46 weeks of gestation; a birth cannot be in the future.
 */
export function makeDeliverySchema(now: Date, edd: Date) {
  return z
    .object({
      date: text,
      time: text,
      place: z.enum(Object.keys(BIRTH_PLACES) as [keyof typeof BIRTH_PLACES, ...(keyof typeof BIRTH_PLACES)[]]),
      onset: choice,
      mode: choice,
      indication: text,
      loss: text,
      perineum: choice,
      complications: list,
      complicationsNote: text,
      medicines: list,
      medicinesNote: text,
      maternalCondition: text,
      attendedBy: text,
      count: z.enum(['1', '2', '3', '4']),
      babies: z.array(babyFields),
    })
    .superRefine((v, ctx) => {
      const at = birthTime(v.date, v.time);
      if (!at) ctx.addIssue({ code: 'custom', path: ['time'], message: 'Enter the date as DD-MM-YYYY and the time as HH:MM (24-hour).' });
      else if (at.getTime() > now.getTime() + 10 * 60_000) ctx.addIssue({ code: 'custom', path: ['time'], message: 'The time of birth cannot be in the future.' });
      else {
        const gaDays = 280 - Math.round((edd.getTime() - at.getTime()) / 86_400_000);
        if (gaDays < 140 || gaDays > 320) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Check the date: it gives a gestation outside 20–46 weeks for this EDD.' });
      }
      if (!v.mode) ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Please choose the mode of delivery.' });
      if (!inRange(v.loss, 0, 10000)) ctx.addIssue({ code: 'custom', path: ['loss'], message: 'Check value: blood loss 0–10000 ml.' });
      if (v.complications.includes('Other') && !v.complicationsNote.trim()) {
        ctx.addIssue({ code: 'custom', path: ['complicationsNote'], message: 'Describe the other complication as documented.' });
      }
      if (v.medicines.includes('Other') && !v.medicinesNote.trim()) ctx.addIssue({ code: 'custom', path: ['medicinesNote'], message: 'Name the other medicine as documented.' });
      v.babies.slice(0, Number(v.count)).forEach((b, i) => {
        const at = (field: string, message: string) => ctx.addIssue({ code: 'custom', path: ['babies', i, field], message: `Baby ${i + 1}: ${message}` });
        if (!b.sex) at('sex', 'choose the sex (or Undetermined).');
        if (!(Number(b.weight) >= 200 && Number(b.weight) <= 7000)) at('weight', 'birth weight 200–7000 g.');
        if (!inRange(b.length, 20, 70)) at('length', 'check value: length 20–70 cm.');
        if (!inRange(b.head, 15, 50)) at('head', 'check value: head circumference 15–50 cm.');
        if (!inRange(b.apgar1, 0, 10) || !inRange(b.apgar5, 0, 10)) at('apgar1', 'Apgar scores are 0–10.');
      });
    })
    .transform(
      (v): DeliveryInput => ({
        at: birthTime(v.date, v.time)!,
        place: BIRTH_PLACES[v.place],
        labourOnset: v.onset ? LABOUR_ONSETS[v.onset as keyof typeof LABOUR_ONSETS] : undefined,
        mode: v.mode ?? '',
        indication: trimmedOrUndefined(v.indication),
        bloodLossMl: num(v.loss),
        perineum: v.perineum,
        complications: v.complications,
        complicationsNote: v.complications.includes('Other') ? trimmedOrUndefined(v.complicationsNote) : undefined,
        medicines: v.medicines,
        medicinesNote: v.medicines.includes('Other') ? trimmedOrUndefined(v.medicinesNote) : undefined,
        maternalCondition: trimmedOrUndefined(v.maternalCondition),
        attendedBy: trimmedOrUndefined(v.attendedBy),
        babies: v.babies.slice(0, Number(v.count)).map((b) => ({
          sex: b.sex ?? 'U',
          birthWeightG: Number(b.weight),
          lengthCm: num(b.length),
          headCircCm: num(b.head),
          apgar1: num(b.apgar1),
          apgar5: num(b.apgar5),
          outcome: b.outcome,
          stillbirthType: b.outcome === 'stillbirth' ? b.stillbirthType : undefined,
          resuscitation: b.resuscitation,
          birthDefects: trimmedOrUndefined(b.defects),
          breastfedWithin1h: b.outcome === 'live' ? b.breastfed : undefined,
          vitaminK: b.outcome === 'live' ? b.vitaminK : undefined,
          birthDoses: b.outcome === 'live' && b.birthDoses,
        })),
      }),
    );
}
export type DeliveryForm = z.input<ReturnType<typeof makeDeliverySchema>>;

// ── CT-23/24 Investigation ───────────────────────────────────────────────────────

export const FOLLOW_UPS = ['None', 'Repeat test', 'Refer', 'Discuss at next visit'] as const;

export const resultSchema = z
  .object({ value: text.refine((s) => !!s.trim(), 'Enter the result as reported'), note: text })
  .transform((v) => ({ value: v.value.trim(), note: trimmedOrUndefined(v.note) }));

export const notDoneSchema = z.object({ reason: choice }).refine((v) => !!v.reason, { path: ['reason'], message: 'Choose a reason' });

export const reviewSchema = z.object({ followUp: z.enum(FOLLOW_UPS).optional() }).refine((v) => !!v.followUp, { path: ['followUp'], message: 'Choose what happens next' });

// ── CT-96 Task outcome · CT-41/42 Call-back outcome ──────────────────────────────

export const taskOutcomeSchema = z.object({ outcome: choice, inDays: choice }).refine((v) => !!v.outcome, { path: ['outcome'], message: 'Choose an outcome' });

export const closeCallbackSchema = z
  .object({ outcome: choice, note: text })
  .refine((v) => !!v.outcome, { path: ['outcome'], message: 'Choose an outcome' })
  .transform((v) => ({ outcome: v.outcome ?? '', note: trimmedOrUndefined(v.note) }));

// ── CT-52 Referral: appointment / recommendations sheet ─────────────────────────

export const referralStepSchema = z.object({ inDays: z.enum(['1', '2', '3', '5', '7']), recs: text });

// ── CT-92 Newborn observation ────────────────────────────────────────────────────

export const NOTHING_RECORDED = 'Record at least one observation';

export const observeSchema = z
  .object({ weight: reading(300, 8000), temp: reading(30, 43), rr: reading(5, 150), feeding: choice, jaundice: choice })
  .refine((v) => !!(v.weight || v.temp || v.rr || v.feeding || v.jaundice), { path: ['feeding'], message: NOTHING_RECORDED })
  .transform((v) => ({ weightG: numText(v.weight), tempC: numText(v.temp), respRate: numText(v.rr), feeding: v.feeding, jaundice: v.jaundice }));

// ── CT-95 Discharge checklist ────────────────────────────────────────────────────

/** An item is resolved when done, or marked N/A / deferred WITH a reason. */
export const dischargeItemResolved = z.union([
  z.object({ state: z.literal('done') }),
  z.object({ state: z.enum(['na', 'deferred']), reason: z.string().min(1) }),
]);

// ── CT-74/75 Paper record capture ────────────────────────────────────────────────

const captureField = z.object({ key: text, label: text, value: text, confidence: z.number(), confirmed: z.boolean() });
export const captureSchema = z
  .object({ fields: z.array(captureField) })
  .refine((v) => v.fields.some((f) => f.confirmed), { path: ['fields'], message: 'Confirm at least one field' })
  .transform((v): { fields: CaptureField[] } => v);

// ── CT-20 Patient view / CT-90 Newborn view: care team · care-team note ──────────

/**
 * Reassign a care team (assign_care): a unit of the specialty, optionally a named doctor of that unit ('' = the team
 * as a whole), and the recorded reason. `current` is the assignment shown, so "no change" is caught before sending.
 */
export function makeAssignCareSchema(current?: { teamId: string; staffId?: string }) {
  return z
    .object({ team: text, doctor: text, reason: text })
    .superRefine((v, ctx) => {
      if (!v.team) ctx.addIssue({ code: 'custom', path: ['team'], message: 'Choose a team' });
      else if (current && v.team === current.teamId && (v.doctor || undefined) === current.staffId) {
        ctx.addIssue({ code: 'custom', path: ['team'], message: 'This is already the current team and doctor' });
      }
      if (!v.reason.trim()) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Add the reason' });
    })
    .transform((v) => ({ teamId: asTeamId(v.team), staffId: v.doctor ? asStaffId(v.doctor) : undefined, reason: v.reason.trim() }));
}

export const noteSchema = z.object({ body: text.refine((s) => !!s.trim(), 'Write the note') }).transform((v) => ({ body: v.body.trim() }));
