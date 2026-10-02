/**
 * Care Team form schemas: one Zod schema per form, the form's field types inferred from it,
 * its parsed output shaped for the store action the form calls. Messages shown to the clinician live here.
 *
 * Hackathon rule: clinical values are stored exactly as entered. The only number checks are "is this physically
 * possible" typing guards ("Check value"); nothing here grades, colours or interprets a reading.
 */
import { z } from 'zod';
import { addDays, eddFromLmp } from '@domain/gestation';
import { expectedComponents, type ComponentState } from '@domain/schedules';

import type { DeliveryInput, RegisterInput, VisitInput } from '@/data/store';
import type { CaptureField, ChecklistState, Referral } from '@/data/types';

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

// ── CT-61…66 Register pregnancy ──────────────────────────────────────────────────

export const LANGUAGES = { English: 'en', Kannada: 'kn', Hindi: 'hi' } as const;

/** Parses DD-MM-YYYY or DD/MM/YYYY into a UTC date. */
export function parseDayMonthYear(s: string): Date | undefined {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The EDD each dating source gives, and the one the clinician chose (LMP when she has not chosen the scan). */
export function eddOptions(v: { lmpText: string; scanWeeks: string; eddSource: 'lmp' | 'scan' }, now: Date) {
  const lmp = parseDayMonthYear(v.lmpText);
  const eddLmp = lmp ? eddFromLmp(lmp) : undefined;
  const scanW = Number(v.scanWeeks);
  const eddScan = v.scanWeeks && scanW > 0 && scanW < 42 ? addDays(now, 280 - Math.round(scanW * 7)) : undefined;
  const edd = v.eddSource === 'scan' ? eddScan : (eddLmp ?? eddScan);
  return { lmp, eddLmp, eddScan, edd };
}

export const gplaOf = (v: { g: string; p: string; l: string; a: string }) => ({ g: Number(v.g) || 0, p: Number(v.p) || 0, l: Number(v.l) || 0, a: Number(v.a) || 0 });

/** Which fields each registration step owns — "Next" stays disabled while any of them has an issue. */
export const REGISTER_STEPS = [
  ['name', 'age', 'phone', 'village', 'lang', 'ecName', 'ecPhone'],
  ['lmpText', 'scanWeeks', 'eddSource', 'g', 'p', 'l', 'a', 'previous'],
  ['conditions', 'allergies', 'blood', 'tags', 'intensity'],
] as const;

export function makeRegisterSchema(now: Date) {
  return z
    .object({
      name: text,
      age: text,
      phone: text,
      village: text,
      lang: z.enum(['English', 'Kannada', 'Hindi']),
      ecName: text,
      ecPhone: text,
      lmpText: text,
      scanWeeks: text,
      eddSource: z.enum(['lmp', 'scan']),
      g: text,
      p: text,
      l: text,
      a: text,
      previous: list,
      conditions: list,
      allergies: text,
      blood: choice,
      tags: list,
      intensity,
    })
    .superRefine((v, ctx) => {
      if (v.name.trim().length <= 1) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter her full name' });
      if (!(Number(v.age) > 10)) ctx.addIssue({ code: 'custom', path: ['age'], message: 'Enter her age' });
      if (!MOBILE.test(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a 10-digit mobile number' });
      if (!eddOptions(v, now).edd) ctx.addIssue({ code: 'custom', path: ['lmpText'], message: 'Enter the LMP or the GA by dating scan' });
      const n = gplaOf(v);
      if (n.p + n.a > Math.max(0, n.g - 1)) ctx.addIssue({ code: 'custom', path: ['g'], message: 'P + A must be ≤ G − 1 for a current pregnancy' });
    })
    .transform((v): RegisterInput => {
      const { lmp, eddScan, edd } = eddOptions(v, now);
      return {
        mother: {
          name: v.name.trim(),
          age: Number(v.age),
          phone: v.phone,
          village: v.village.trim() || '—',
          lang: LANGUAGES[v.lang],
          emergencyContact: { name: v.ecName.trim() || '—', relation: 'Family', phone: v.ecPhone || '—' },
        },
        lmp,
        edd: edd!,
        eddSource: v.eddSource === 'scan' && eddScan ? 'scan' : 'lmp',
        gpla: gplaOf(v),
        history: {
          conditions: v.conditions,
          allergies: v.allergies.split(',').map((x) => x.trim()).filter(Boolean),
          medicines: [],
          bloodGroup: v.blood === 'Unknown' ? undefined : v.blood,
        },
        previous: v.previous.map((p) => ({
          year: now.getFullYear() - 2,
          outcome: p === 'LSCS' || p === 'Normal delivery' ? 'Live birth' : p,
          mode: p === 'LSCS' ? 'LSCS' : p === 'Normal delivery' ? 'Normal' : undefined,
        })),
        tagCodes: v.tags,
        intensity: v.intensity,
      };
    });
}
export type RegisterForm = z.input<ReturnType<typeof makeRegisterSchema>>;

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

// ── CT-20 Patient view: assign doctor · care-team note ───────────────────────────

export const assignDoctorSchema = z
  .object({ doctor: text, reason: text })
  .refine((v) => !!v.doctor, { path: ['doctor'], message: 'Choose a doctor' })
  .refine((v) => !!v.reason.trim(), { path: ['reason'], message: 'Add the reason' })
  .transform((v) => ({ doctor: v.doctor, reason: v.reason.trim() }));

export const noteSchema = z.object({ body: text.refine((s) => !!s.trim(), 'Write the note') }).transform((v) => ({ body: v.body.trim() }));
