/**
 * Data model for the on-device demo backend. Mirrors PRD §11 so the Supabase layer
 * can replace the store without touching screens. Synthetic data only.
 */
import type { Intensity } from '@domain/schedules';

export type { Intensity };

export type Id = string;

export type Mother = {
  id: Id;
  name: string;
  age: number;
  phone: string;
  lang: 'en' | 'kn' | 'hi';
  village: string;
  /** Hospital IP (in-patient) number, assigned by the care team. */
  ipNo?: string;
  emergencyContact: { name: string; relation: string; phone: string };
};

export type PregnancyStatus = 'active' | 'admitted' | 'delivered' | 'closed';

export type PrevPregnancy = { id?: Id; year: number; outcome: string; mode?: string; note?: string };

export type Pregnancy = {
  id: Id;
  mchId: string;
  motherId: Id;
  registeredOn: Date;
  lmp?: Date;
  edd: Date;
  eddSource: 'lmp' | 'scan' | 'clinician';
  gpla: { g: number; p: number; l: number; a: number };
  status: PregnancyStatus;
  intensity: Intensity;
  /** Why a closed episode ended (server code, e.g. 'delivered', 'miscarriage'); set with `endedOn`. */
  endReason?: string;
  endedOn?: Date;
  /** The open admission (status 'admitted'), so it can be ended without a delivery. */
  admissionId?: Id;
  assignedDoctor?: { name: string; phone?: string };
  history: { conditions: string[]; allergies: string[]; medicines: string[]; bloodGroup?: string; heightCm?: number };
  previous: PrevPregnancy[];
};

export type Tag = {
  id: Id;
  subjectId: Id;
  code: string;
  note?: string;
  setBy: string;
  setAt: Date;
  removedAt?: Date;
  removedReason?: string;
};

export type ChecklistState = 'done' | 'not_done' | 'na';

export type Visit = {
  id: Id;
  pregnancyId: Id;
  at: Date;
  by: string;
  vitals: {
    weightKg?: number;
    bpSys?: number;
    bpDia?: number;
    pulse?: number;
    fundalHeightCm?: number;
    fhr?: number;
    presentation?: string;
    urineAlbumin?: string;
    urineSugar?: string;
    oedema?: string;
  };
  checklist: Record<string, { state: ChecklistState; reason?: string }>;
  complaints: string[];
  note?: string;
};

export type TaskKind = 'anc_visit' | 'investigation' | 'referral_appt' | 'pn_visit' | 'nb_visit' | 'vaccine' | 'review_result' | 'template';

export type Task = {
  id: Id;
  kind: TaskKind;
  subjectType: 'pregnancy' | 'baby';
  subjectId: Id;
  title: string;
  refId?: Id;
  /** Where the family should go (referral appointments). */
  place?: string;
  dueFrom?: Date;
  dueBy: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  generatedBy: 'protocol' | 'template' | 'clinician' | 'import';
  overrideReason?: string;
  contactAttempts: { at: Date; outcome: string; by: string }[];
};

export type InvestigationStatus = 'due' | 'ordered' | 'resulted' | 'reviewed' | 'not_done';

export type Investigation = {
  id: Id;
  subjectId: Id;
  code: string;
  label: string;
  kind: 'lab' | 'scan';
  sensitive: boolean;
  dueFrom: Date;
  dueBy: Date;
  late: boolean;
  status: InvestigationStatus;
  orderedAt?: Date;
  result?: { value: string; unit?: string; at: Date; note?: string };
  /** Id of the result shown in `result` (for entered-in-error). */
  resultId?: Id;
  review?: { by: string; at: Date; followUp: string };
  notDoneReason?: string;
};

export type ReferralStatus = 'requested' | 'accepted' | 'scheduled' | 'seen' | 'recommendations' | 'closed' | 'declined';

export const REFERRAL_STEPS: ReferralStatus[] = ['requested', 'accepted', 'scheduled', 'seen', 'recommendations', 'closed'];

export type Referral = {
  id: Id;
  pregnancyId: Id;
  department: string;
  urgency: 'emergency' | '24h' | 'routine';
  reason: string;
  question: string;
  status: ReferralStatus;
  scheduledAt?: Date;
  place?: string;
  recommendations?: string;
  events: { status: ReferralStatus; at: Date; by: string; note?: string }[];
  createdBy: string;
};

export type Callback = {
  id: Id;
  motherId: Id;
  requestedBy: string;
  channel: 'app' | 'whatsapp';
  signs: string[];
  note?: string;
  voiceUri?: string;
  voiceSeconds?: number;
  at: Date;
  closedAt?: Date;
  outcome?: string;
  outcomeNote?: string;
  closedBy?: string;
};

export type SelfLog = {
  id: Id;
  motherId: Id;
  subject: 'mother' | 'baby';
  /** Which baby a baby reading is about (needed by the server; the demo store has one baby per mother). */
  babyId?: Id;
  kind: 'bp' | 'weight' | 'movements' | 'contractions' | 'feeding' | 'note';
  /** As entered, in English (e.g. "120/80", "62 kg", "4 in last hour"). */
  value: string;
  /** Exact moment the reading was saved, date + time of day — a future backend stores it as timestamptz. */
  at: Date;
  by: string;
};

export type Baby = {
  id: Id;
  childId: string;
  motherId: Id;
  pregnancyId: Id;
  dob: Date;
  sex: 'F' | 'M';
  birthWeightG: number;
  gaAtBirthDays: number;
  apgar1?: number;
  apgar5?: number;
  outcome: 'live' | 'stillbirth';
  intensity: Intensity;
  /** A liveborn baby who later died: no reminders and no cheerful content from then on. */
  deceasedAt?: Date;
};

export type Delivery = {
  id: Id;
  pregnancyId: Id;
  at: Date;
  mode: string;
  indication?: string;
  bloodLossMl?: number;
  complications: string[];
  medicines: string[];
  babyIds: Id[];
};

export type Immunization = { id: Id; babyId: Id; code: string; label: string; group: string; dueOn: Date; givenOn?: Date };

export type DischargeItem = { key: string; label: string; state?: 'done' | 'na' | 'deferred'; reason?: string };
/** `id` is the server's discharge id (Supabase mode); the demo store keys discharges by subject. */
export type Discharge = { id?: Id; subjectId: Id; subject: 'mother' | 'baby'; items: DischargeItem[]; completedAt?: Date; completedBy?: string };

/** A Care Team member of the signed-in clinician's hospital (assignment picker, display names). */
export type StaffMember = { id: Id; name: string; role: string };

/** A hospital team: departments receive referrals; units hold patients. */
export type TeamRef = { id: Id; name: string; kind: 'department' | 'unit'; specialty: string };

export type DoseSlot = 'morning' | 'afternoon' | 'night';

/** A clinician-entered prescription — the only medicines that drive Family reminders. The app never suggests one. */
export type Prescription = {
  id: Id;
  motherId: Id;
  /** Whose prescription: the pregnancy (obstetrician) xor the baby (paediatrician). Unknown on the Family face. */
  pregnancyId?: Id;
  babyId?: Id;
  name: string;
  dose?: string;
  slots: DoseSlot[];
  instructions?: string;
};

export type AuditEntry = { id: Id; at: Date; actor: string; action: string; entity: string };

export type CaregiverScopes = { schedule: boolean; baby: boolean; logs: boolean; tests: boolean };

export type Caregiver = {
  id: Id;
  motherId: Id;
  name: string;
  relation: string;
  phone: string;
  scopes: CaregiverScopes;
  addedAt: Date;
  revokedAt?: Date;
};

export type Note = { id: Id; subjectId: Id; author: string; body: string; at: Date; kind: 'note' | 'ai_verified' };

export type NewbornObs = {
  id: Id;
  babyId: Id;
  at: Date;
  by: string;
  weightG?: number;
  tempC?: number;
  respRate?: number;
  feeding?: string;
  jaundice?: string;
};

export type MedDose = { id: Id; motherId: Id; med: string; medicationId?: Id; date: string; slot: 'morning' | 'afternoon' | 'night'; status: 'taken' | 'skipped'; at: Date };

export type CaptureField = { key: string; label: string; value: string; confidence: number; confirmed: boolean };

export type CaptureDoc = { id: Id; subjectId: Id; uri?: string; fields: CaptureField[]; at: Date; by: string; visitId?: Id };

/** A documented history fact of the mother (correctable only by entered-in-error). */
export type DocumentedFact = { id: Id; motherId: Id; kind: 'condition' | 'allergy' | 'previous_pregnancy'; label: string };

/** Emergency access ("break the glass") held by the signed-in clinician: 24 hours at most, with a reason. */
export type AccessOverride = { id: Id; motherId: Id; reason: string; grantedAt: Date; expiresAt: Date; /** Whose override (Supabase mode). */ staffId?: Id };

/** A server notification for the signed-in person (Supabase mode). Text is chosen on the phone from `kind`. */
export type AppNotification = {
  id: Id;
  kind: string;
  targetType?: 'pregnancy' | 'baby' | 'callback' | 'referral' | 'task' | 'investigation';
  targetId?: Id;
  at: Date;
  readAt?: Date;
};

/** A test result the referring team shared with a referral's department (sensitive tests reach specialists only this way). */
export type SharedResult = { referralId: Id; investigationId: Id };

/** Kinds of recorded facts that can be marked entered in error (server `mark_entered_in_error`). */
export type EieKind = 'encounter' | 'investigation_result' | 'care_note' | 'self_log' | 'condition' | 'allergy' | 'previous_pregnancy';
