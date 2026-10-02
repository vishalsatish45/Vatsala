/**
 * Server codes ⇄ the English labels the screens show and the demo store keeps.
 * Mirrors the pick lists in supabase/seed.sql (each code's `en` label); the server refuses unknown codes,
 * so a drift between the two shows up as a clear save error, never as silent data.
 */
import { DISCHARGE_BABY, DISCHARGE_MOTHER, MISSED_OUTCOMES, WARNING_SIGNS } from './catalogue';

type Pairs = readonly (readonly [code: string, label: string])[];

function table(pairs: Pairs) {
  const byCode = new Map(pairs.map(([c, l]) => [c, l]));
  const byLabel = new Map(pairs.map(([c, l]) => [l.toLowerCase(), c]));
  return {
    label: (code: string) => byCode.get(code) ?? code,
    code: (label: string) => byLabel.get(label.toLowerCase()),
  };
}

const snake = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

export const complaintCodes = table([
  ['headache', 'Headache'],
  ['blurred_vision', 'Blurred vision'],
  ['swelling', 'Swelling'],
  ['bleeding', 'Bleeding'],
  ['leaking_fluid', 'Leaking fluid'],
  ['abdominal_pain', 'Abdominal pain'],
  ['fever', 'Fever'],
  ['burning_urine', 'Burning urine'],
  ['vomiting', 'Vomiting'],
  ['breathlessness', 'Breathlessness'],
  ['reduced_fetal_movements', 'Reduced fetal movements'],
]);

export const callbackOutcomeCodes = table([
  ['advised_to_come', 'Advised to come in'],
  ['visit_scheduled', 'Visit scheduled'],
  ['information_given', 'Information given'],
  ['unreachable', 'Unreachable'],
  ['other', 'Other'],
]);

export const contactOutcomeCodes = table(MISSED_OUTCOMES.map((l) => [snake(l), l] as const));
/** A contact that reached the family (three unsuccessful ones in a row mark the visit lost to follow-up). */
export const contactSuccessful = (label: string) => label !== 'Unreachable';

export const deliveryModeCodes = table([
  ['vaginal', 'Normal vaginal'],
  ['assisted', 'Assisted (vacuum/forceps)'],
  ['lscs_elective', 'LSCS (elective)'],
  ['lscs_emergency', 'LSCS (emergency)'],
]);

export const complicationCodes = table([
  ['pph', 'PPH'],
  ['eclampsia', 'Eclampsia'],
  ['retained_placenta', 'Retained placenta'],
  ['perineal_tear', 'Perineal tear'],
  ['other', 'Other'],
]);

export const labourMedicineCodes = table([
  ['oxytocin', 'Oxytocin'],
  ['mgso4', 'MgSO4'],
  ['antibiotics', 'Antibiotics'],
  ['blood_transfusion', 'Blood transfusion'],
  ['antenatal_steroids', 'Steroids (antenatal)'],
]);

export const counsellingCodes = table([
  ['nutrition', 'Nutrition'],
  ['warning_signs', 'Warning signs'],
  ['birth_preparedness', 'Birth preparedness'],
  ['breastfeeding', 'Breastfeeding'],
  ['family_planning', 'Family planning'],
]);

export const followUpCodes = table([
  ['none', 'None'],
  ['repeat', 'Repeat test'],
  ['refer', 'Refer'],
  ['discuss_next_visit', 'Discuss at next visit'],
]);

/** Previous-pregnancy outcomes as the registration form records them. */
export const previousOutcomeCodes = table([
  ['live_birth', 'Live birth'],
  ['stillbirth', 'Stillbirth'],
  ['miscarriage', 'Miscarriage'],
  ['induced_abortion', 'MTP'],
  ['ectopic', 'Ectopic'],
  ['molar', 'Molar'],
  ['neonatal_death', 'Neonatal death'],
]);
export const previousModeCodes = table([
  ['vaginal', 'Normal'],
  ['assisted', 'Assisted'],
  ['lscs', 'LSCS'],
]);

const SIGNS = Object.values(WARNING_SIGNS).flatMap((stage) => Object.entries(stage));
const signLabels = new Map<string, string>(SIGNS);
/** Warning signs are ticked by code; the care team reads the English label. */
export const signLabel = (code: string) => signLabels.get(code) ?? code;
const signCodesByLabel = new Map<string, string>(SIGNS.map(([c, l]) => [l, c]));
/** Best-effort reverse lookup (labels repeat across stages, e.g. "Fits"; the first stage wins). */
export const signCode = (label: string) => signCodesByLabel.get(label);

const DISCHARGE = [...DISCHARGE_MOTHER, ...DISCHARGE_BABY];
export const dischargeLabel = (key: string) => DISCHARGE.find((d) => d.key === key)?.label ?? key;

/** Free-text complaints ("Other: …") have no code; they travel in the visit's complaints note. */
export function splitComplaints(labels: string[]): { codes: string[]; note?: string } {
  const codes: string[] = [];
  const free: string[] = [];
  for (const l of labels) {
    const c = complaintCodes.code(l);
    if (c) codes.push(c);
    else free.push(l);
  }
  return { codes, note: free.length ? free.join('; ') : undefined };
}

/**
 * How a pregnancy episode ends (supabase `pregnancies.end_reason`). The clinician chooses; the app never infers one.
 * 'delivered' closes a delivered episode once postnatal care is done.
 */
export const END_REASONS = [
  ['miscarriage', 'Miscarriage'],
  ['induced_abortion', 'Induced abortion (MTP)'],
  ['ectopic', 'Ectopic pregnancy'],
  ['molar', 'Molar pregnancy'],
  ['maternal_death', 'Maternal death'],
  ['transferred_out', 'Transferred to another facility'],
  ['lost_to_follow_up', 'Lost to follow-up'],
  ['other', 'Other'],
] as const;
export type EndReason = (typeof END_REASONS)[number][0] | 'delivered';
export const endReasonCodes = table([...END_REASONS, ['delivered', 'Delivered · episode closed']]);

/** "2024 · Live birth · LSCS · 38 wk · PPH" — how a previous pregnancy is listed in the documented history. */
export const previousLabel = (x: { year: number; outcome: string; mode?: string; gestationWeeks?: number; complications?: string[]; note?: string }) =>
  [String(x.year), x.outcome, x.mode, x.gestationWeeks ? `${x.gestationWeeks} wk` : undefined, ...(x.complications ?? []), x.note].filter(Boolean).join(' · ');

/** The blood group codes the server stores (observation_codes.allowed_values for 'blood_group', supabase/seed.sql). */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** Previous-pregnancy outcome and mode labels, in the order the registration form offers them. */
export const PREVIOUS_OUTCOMES = ['Live birth', 'Stillbirth', 'Miscarriage', 'MTP', 'Ectopic', 'Molar', 'Neonatal death'] as const;
export const PREVIOUS_MODES = ['Normal', 'Assisted', 'LSCS'] as const;
