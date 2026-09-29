/**
 * Hospital-configurable catalogues (PRD §10.4). Tags are documentation labels a
 * clinician selects — the system never assigns or suggests them.
 */

export type TagDef = { code: string; label: string; group: 'Obstetric' | 'Medical' | 'Social' | 'Newborn'; template?: string };

export const TAGS: TagDef[] = [
  { code: 'prev_cs', label: 'Previous caesarean', group: 'Obstetric' },
  { code: 'multiple', label: 'Multiple pregnancy', group: 'Obstetric' },
  { code: 'prev_stillbirth', label: 'Previous stillbirth', group: 'Obstetric' },
  { code: 'prev_preterm', label: 'Previous preterm birth', group: 'Obstetric' },
  { code: 'prev_pph', label: 'Previous PPH', group: 'Obstetric' },
  { code: 'placental', label: 'Placental condition', group: 'Obstetric' },
  { code: 'rh_neg', label: 'Rh-negative', group: 'Obstetric' },
  { code: 'hypertensive', label: 'Hypertensive disorder', group: 'Medical', template: 'hypertensive' },
  { code: 'gdm', label: 'Diabetes / GDM', group: 'Medical', template: 'gdm' },
  { code: 'anaemia', label: 'Anaemia under treatment', group: 'Medical' },
  { code: 'heart', label: 'Heart disease', group: 'Medical' },
  { code: 'kidney', label: 'Kidney disease', group: 'Medical' },
  { code: 'thyroid', label: 'Thyroid disorder', group: 'Medical' },
  { code: 'epilepsy', label: 'Epilepsy', group: 'Medical' },
  { code: 'infection_nb', label: 'Infection needing newborn follow-up', group: 'Medical' },
  { code: 'adolescent', label: 'Adolescent pregnancy', group: 'Social' },
  { code: 'amat', label: 'Advanced maternal age', group: 'Social' },
  { code: 'support', label: 'Social support needed', group: 'Social' },
  { code: 'lbw', label: 'LBW follow-up', group: 'Newborn', template: 'lbw' },
  { code: 'preterm_fu', label: 'Preterm follow-up', group: 'Newborn' },
  { code: 'jaundice_fu', label: 'Jaundice follow-up', group: 'Newborn', template: 'jaundice' },
  { code: 'feeding', label: 'Feeding support', group: 'Newborn' },
  { code: 'nicu', label: 'NICU graduate', group: 'Newborn' },
];

export const tagLabel = (code: string) => TAGS.find((t) => t.code === code)?.label ?? code;

export const DEPARTMENTS = ['Cardiology', 'General Medicine', 'Endocrinology', 'Anaesthesia', 'Psychiatry', 'Nephrology', 'Paediatrics', 'Radiology'];

export const COMPLAINTS = ['Headache', 'Blurred vision', 'Swelling', 'Bleeding', 'Leaking fluid', 'Abdominal pain', 'Fever', 'Burning urine', 'Vomiting', 'Breathlessness', 'Reduced fetal movements'];

export const CALLBACK_OUTCOMES = ['Advised to come in', 'Visit scheduled', 'Information given', 'Unreachable', 'Other'];

export const MISSED_OUTCOMES = ['Will come', 'Rescheduled', 'Delivered elsewhere', 'Moved away', 'Unreachable', 'Declined'];

export const NOT_DONE_REASONS = ['Kit unavailable', 'Patient declined', 'Time constraint', 'Done elsewhere', 'Other'];

/**
 * Warning signs (PRD F-42, §10.6) — static educational list. Families may tick signs when
 * asking for a call; nothing ever evaluates them. Keys are translated in the Family app;
 * the English label is what the care team sees.
 */
export const WARNING_SIGNS = {
  pregnancy: { bleeding: 'Bleeding', headache_vision: 'Severe headache / blurred vision', fits: 'Fits', leaking: 'Leaking water', movements: 'Baby moving less', belly_pain: 'Severe belly pain', fever: 'High fever', breathless: 'Difficulty breathing' },
  postnatal: { heavy_bleeding: 'Heavy bleeding', pn_fever: 'Fever', wound: 'Wound pain or pus', breast: 'Breast pain / redness', low_mood: 'Feeling very low' },
  baby: { not_feeding: 'Not feeding', baby_fits: 'Fits', fast_breathing: 'Fast breathing', cold: 'Feels cold', sleepy: 'Very sleepy / hard to wake', yellow: 'Yellow skin or eyes', cord: 'Cord redness or pus' },
} as const;

export type SignStage = keyof typeof WARNING_SIGNS;

/** Emergency-card fields the mother can choose (PRD F-45). Sensitive items are never offered. */
export const CARD_FIELDS = ['name', 'age', 'blood', 'weeks', 'allergies', 'conditions', 'hospital', 'emergency'] as const;
export type CardField = (typeof CARD_FIELDS)[number];
export const CARD_DEFAULT: CardField[] = ['name', 'blood', 'weeks', 'allergies', 'hospital', 'emergency'];

export const DISCHARGE_MOTHER = [
  { key: 'vitals', label: 'Vitals documented' },
  { key: 'meds', label: 'Medicines & instructions documented' },
  { key: 'warning', label: 'Warning signs explained (in her language)' },
  { key: 'pn_visit', label: 'Postnatal visits scheduled' },
  { key: 'fp', label: 'Family-planning counselling documented' },
  { key: 'bf', label: 'Breastfeeding support given' },
];

export const DISCHARGE_BABY = [
  { key: 'feeding', label: 'Feeding documented' },
  { key: 'weight', label: 'Discharge weight documented' },
  { key: 'birth_doses', label: 'Birth-dose vaccines documented' },
  { key: 'jaundice', label: 'Jaundice assessment documented' },
  { key: 'nb_visit', label: 'Newborn follow-up scheduled' },
  { key: 'education', label: 'Parent education given' },
];

/** Default dosing slots for prescribed medicines (as prescribed — the app never suggests medicines). */
export const MED_SLOTS: Record<string, { slots: ('morning' | 'afternoon' | 'night')[]; note: string }> = {
  IFA: { slots: ['afternoon'], note: 'After lunch' },
  Calcium: { slots: ['morning', 'night'], note: 'After breakfast and dinner' },
};
export const medSlots = (name: string) => MED_SLOTS[name] ?? { slots: ['morning' as const], note: 'As prescribed' };
