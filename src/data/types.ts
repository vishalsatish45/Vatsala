/**
 * Data model for the on-device demo backend. Mirrors PRD §11 so the Supabase layer
 * can replace the store without touching screens. Synthetic data only.
 */
import type { Intensity } from '@domain/schedules';

export type { Intensity };

/** A plain id string (audit rows, composite keys). Entity ids below are branded. */
export type Id = string;

declare const idBrand: unique symbol;
/**
 * A string id that only the adapter boundary (src/data/remote.ts), the id minting in the store, the demo seed and
 * the typed helpers in src/data/ids.ts may produce — a bare `string` (or another entity's id) does not type-check.
 */
export type Branded<B extends string> = string & { readonly [idBrand]: B };

export type MotherId = Branded<'MotherId'>;
export type PregnancyId = Branded<'PregnancyId'>;
export type BabyId = Branded<'BabyId'>;
/** A record a tag, note, task, investigation or discharge belongs to: a pregnancy or a baby. */
export type SubjectId = PregnancyId | BabyId;
export type TagId = Branded<'TagId'>;
/** An encounter: an ANC visit, a newborn observation or a paper-record transcription. */
export type EncounterId = Branded<'EncounterId'>;
export type VisitId = EncounterId;
export type TaskId = Branded<'TaskId'>;
export type InvestigationId = Branded<'InvestigationId'>;
export type ReferralId = Branded<'ReferralId'>;
export type CallbackId = Branded<'CallbackId'>;
export type SelfLogId = Branded<'SelfLogId'>;
export type DeliveryId = Branded<'DeliveryId'>;
export type ImmunizationId = Branded<'ImmunizationId'>;
export type DischargeId = Branded<'DischargeId'>;
export type StaffId = Branded<'StaffId'>;
export type TeamId = Branded<'TeamId'>;
export type PrescriptionId = Branded<'PrescriptionId'>;
export type CaregiverId = Branded<'CaregiverId'>;
export type NoteId = Branded<'NoteId'>;
export type MedDoseId = Branded<'MedDoseId'>;
export type DocumentId = Branded<'DocumentId'>;

export type Mother = {
  id: MotherId;
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

export type PrevPregnancy = { year: number; outcome: string; mode?: string; note?: string };

export type Pregnancy = {
  id: PregnancyId;
  mchId: string;
  motherId: MotherId;
  registeredOn: Date;
  lmp?: Date;
  edd: Date;
  eddSource: 'lmp' | 'scan' | 'clinician';
  gpla: { g: number; p: number; l: number; a: number };
  status: PregnancyStatus;
  intensity: Intensity;
  assignedDoctor?: { name: string; phone?: string };
  history: { conditions: string[]; allergies: string[]; medicines: string[]; bloodGroup?: string; heightCm?: number };
  previous: PrevPregnancy[];
};

export type Tag = {
  id: TagId;
  subjectId: SubjectId;
  code: string;
  note?: string;
  setBy: string;
  setAt: Date;
  removedAt?: Date;
  removedReason?: string;
};

export type ChecklistState = 'done' | 'not_done' | 'na';

export type Visit = {
  id: VisitId;
  pregnancyId: PregnancyId;
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
  id: TaskId;
  kind: TaskKind;
  subjectType: 'pregnancy' | 'baby';
  subjectId: SubjectId;
  title: string;
  /** The referral an appointment belongs to, or the visit that completed the task. */
  refId?: ReferralId | VisitId;
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
  id: InvestigationId;
  subjectId: SubjectId;
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
  review?: { by: string; at: Date; followUp: string };
  notDoneReason?: string;
};

export type ReferralStatus = 'requested' | 'accepted' | 'scheduled' | 'seen' | 'recommendations' | 'closed' | 'declined';

export const REFERRAL_STEPS: ReferralStatus[] = ['requested', 'accepted', 'scheduled', 'seen', 'recommendations', 'closed'];

export type Referral = {
  id: ReferralId;
  pregnancyId: PregnancyId;
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
  id: CallbackId;
  motherId: MotherId;
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
  id: SelfLogId;
  motherId: MotherId;
  subject: 'mother' | 'baby';
  /** Which baby a baby reading is about (needed by the server; the demo store has one baby per mother). */
  babyId?: BabyId;
  kind: 'bp' | 'weight' | 'movements' | 'contractions' | 'feeding' | 'note';
  /** As entered, in English (e.g. "120/80", "62 kg", "4 in last hour"). */
  value: string;
  /** Exact moment the reading was saved, date + time of day — a future backend stores it as timestamptz. */
  at: Date;
  by: string;
};

export type Baby = {
  id: BabyId;
  childId: string;
  motherId: MotherId;
  pregnancyId: PregnancyId;
  dob: Date;
  sex: 'F' | 'M';
  birthWeightG: number;
  gaAtBirthDays: number;
  apgar1?: number;
  apgar5?: number;
  outcome: 'live' | 'stillbirth';
  intensity: Intensity;
};

export type Delivery = {
  id: DeliveryId;
  pregnancyId: PregnancyId;
  at: Date;
  mode: string;
  indication?: string;
  bloodLossMl?: number;
  complications: string[];
  medicines: string[];
  babyIds: BabyId[];
};

export type Immunization = { id: ImmunizationId; babyId: BabyId; code: string; label: string; group: string; dueOn: Date; givenOn?: Date };

export type DischargeItem = { key: string; label: string; state?: 'done' | 'na' | 'deferred'; reason?: string };
/** `id` is the server's discharge id (Supabase mode); the demo store keys discharges by subject. */
export type Discharge = { id?: DischargeId; subjectId: SubjectId; subject: 'mother' | 'baby'; items: DischargeItem[]; completedAt?: Date; completedBy?: string };

/** A Care Team member of the signed-in clinician's hospital (assignment picker, display names). */
export type StaffMember = { id: StaffId; name: string; role: string };

/** A hospital team: departments receive referrals; units hold patients. */
export type TeamRef = { id: TeamId; name: string; kind: 'department' | 'unit'; specialty: string };

/** A clinician-entered prescription — the only medicines that drive Family reminders. */
export type Prescription = { id: PrescriptionId; motherId: MotherId; name: string; dose?: string; slots: ('morning' | 'afternoon' | 'night')[]; instructions?: string };

export type AuditEntry = { id: Id; at: Date; actor: string; action: string; entity: string };

export type CaregiverScopes = { schedule: boolean; baby: boolean; logs: boolean };

export type Caregiver = {
  id: CaregiverId;
  motherId: MotherId;
  name: string;
  relation: string;
  phone: string;
  scopes: CaregiverScopes;
  addedAt: Date;
  revokedAt?: Date;
};

export type Note = { id: NoteId; subjectId: SubjectId; author: string; body: string; at: Date; kind: 'note' | 'ai_verified' };

export type NewbornObs = {
  id: EncounterId;
  babyId: BabyId;
  at: Date;
  by: string;
  weightG?: number;
  tempC?: number;
  respRate?: number;
  feeding?: string;
  jaundice?: string;
};

export type MedDose = { id: MedDoseId; motherId: MotherId; med: string; medicationId?: PrescriptionId; date: string; slot: 'morning' | 'afternoon' | 'night'; status: 'taken' | 'skipped'; at: Date };

export type CaptureField = { key: string; label: string; value: string; confidence: number; confirmed: boolean };

export type CaptureDoc = { id: DocumentId; subjectId: PregnancyId; uri?: string; fields: CaptureField[]; at: Date; by: string; visitId?: VisitId };
