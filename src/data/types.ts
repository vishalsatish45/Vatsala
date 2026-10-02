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

/** The hospital a family sees on the Family face (name, phones, how to get there). */
export type HospitalContact = { name: string; phoneOpd?: string; phoneLabour?: string; address?: string; mapsUrl?: string };

export type Mother = {
  id: MotherId;
  name: string;
  age: number;
  phone: string;
  lang: 'en' | 'kn' | 'hi';
  village: string;
  /** Hospital IP (in-patient) number, assigned by the care team. */
  ipNo?: string;
  /** Empty strings when none was documented (nothing is invented). */
  emergencyContact: { name: string; relation: string; phone: string };
  /** Further details as documented (RCH register fields); absent when not recorded. */
  altPhone?: string;
  husbandName?: string;
  dob?: Date;
  dobEstimated?: boolean;
  district?: string;
  state?: string;
  pincode?: string;
  rchId?: string;
  abhaNumber?: string;
  abhaAddress?: string;
};

export type PregnancyStatus = 'active' | 'admitted' | 'delivered' | 'closed';

/** A previous pregnancy as documented: outcome and mode are the English labels (src/data/codes.ts). */
export type PrevPregnancy = { id?: Id; year: number; outcome: string; mode?: string; gestationWeeks?: number; complications?: string[]; note?: string };

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
  /** Why a closed episode ended (server code, e.g. 'delivered', 'miscarriage'); set with `endedOn`. */
  endReason?: string;
  endedOn?: Date;
  /** The open admission (status 'admitted'), so it can be ended without a delivery. */
  admissionId?: Id;
  /** When the open admission began, and its reason as documented. */
  admittedAt?: Date;
  admissionReason?: string;
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
    /** Fetal movements as the mother reported them ('Normal' | 'Reduced'), stored as reported. */
    fetalMovements?: string;
  };
  checklist: Record<string, { state: ChecklistState; reason?: string }>;
  complaints: string[];
  /** Counselling topics given at the visit (English labels; server codes in src/data/codes.ts). */
  counselling?: string[];
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
  /** Id of the result shown in `result` (for entered-in-error). */
  resultId?: Id;
  review?: { by: string; at: Date; followUp: string };
  notDoneReason?: string;
};

/** `cancelled`: withdrawn by the referring team before it was answered (never counted as answered). */
export type ReferralStatus = 'requested' | 'accepted' | 'scheduled' | 'seen' | 'recommendations' | 'closed' | 'declined' | 'cancelled';

/** A referral that has ended: answered and closed, declined by the department, or cancelled by the referrer. */
export const REFERRAL_ENDED: readonly ReferralStatus[] = ['closed', 'declined', 'cancelled'];

export const REFERRAL_STEPS: ReferralStatus[] = ['requested', 'accepted', 'scheduled', 'seen', 'recommendations', 'closed'];

export type Referral = {
  id: ReferralId;
  /** The pregnancy the referral belongs to (a baby's referral: the baby's birth pregnancy). */
  pregnancyId: PregnancyId;
  /** Set when the referral is about a baby (the paediatric team refers and closes it). */
  babyId?: BabyId;
  /** The receiving department: its members accept, schedule, see and answer (server advance_referral). */
  toTeamId?: TeamId;
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
  /** A recording still on this phone (the family's own request, or mock mode). */
  voiceUri?: string;
  /** Internal storage key of the uploaded voice note — used only to ask for a short-lived signed URL, never shown. */
  voicePath?: string;
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
  /** 'U': sex undetermined at birth (as documented). */
  sex: 'F' | 'M' | 'U';
  /** Not always recorded for a stillborn baby. */
  birthWeightG?: number;
  gaAtBirthDays: number;
  apgar1?: number;
  apgar5?: number;
  outcome: 'live' | 'stillbirth';
  intensity: Intensity;
  /** Birth record as documented (Care Team only). */
  lengthCm?: number;
  headCircCm?: number;
  stillbirthType?: 'fresh' | 'macerated';
  resuscitation?: boolean;
  birthDefects?: string;
  breastfedWithin1h?: boolean;
  vitaminK?: boolean;
  /** A liveborn baby who later died: no reminders and no cheerful content from then on. */
  deceasedAt?: Date;
};

export type Delivery = {
  id: DeliveryId;
  pregnancyId: PregnancyId;
  at: Date;
  mode: string;
  indication?: string;
  bloodLossMl?: number;
  complications: string[];
  /** Free text for "Other" complications / medicines, as documented. */
  complicationsNote?: string;
  medicines: string[];
  medicinesNote?: string;
  babyIds: BabyId[];
  /** As documented (server pick-list codes for place and onset). */
  place?: DeliveryPlace;
  labourOnset?: LabourOnset;
  perineum?: string;
  maternalCondition?: string;
  attendedBy?: string;
};

export type DeliveryPlace = 'this_facility' | 'other_facility' | 'home' | 'in_transit';
export type LabourOnset = 'spontaneous' | 'induced' | 'no_labour';

export type Immunization = {
  id: ImmunizationId;
  babyId: BabyId;
  code: string;
  label: string;
  group: string;
  dueOn: Date;
  givenOn?: Date;
  /** Recorded as not given, with the reason (Care Team only). */
  notGivenReason?: string;
  /** How the dose was recorded (Care Team only): given here, or reported from a card / another facility. */
  given?: VaccineDoseDetails;
};

/** What was documented with a dose (server `record_vaccine`). */
export type VaccineDoseDetails = {
  /** true: given at this facility · false: reported from a card or another facility. */
  here: boolean;
  batch?: string;
  expiryOn?: Date;
  manufacturer?: string;
  site?: string;
  route?: string;
  location?: string;
};

export type DischargeItem = { key: string; label: string; state?: 'done' | 'na' | 'deferred'; reason?: string };
/** `id` is the server's discharge id (Supabase mode); the demo store keys discharges by subject. */
export type Discharge = { id?: DischargeId; subjectId: SubjectId; subject: 'mother' | 'baby'; items: DischargeItem[]; completedAt?: Date; completedBy?: string };

/** A Care Team member of the signed-in clinician's hospital (assignment picker, display names). */
export type StaffMember = { id: StaffId; name: string; role: string };

/** A hospital team: departments receive referrals; units hold patients. */
export type TeamRef = { id: TeamId; name: string; kind: 'department' | 'unit'; specialty: string };

/** A current team membership (who can be named on a unit's patients). */
export type TeamMember = { teamId: TeamId; staffId: StaffId };

export type CareSpecialty = 'obstetrics' | 'paediatrics';

/** Who looks after a pregnancy or a baby now: one per subject and specialty; no `staffId` = the team as a whole. */
export type CareAssignment = { subjectId: SubjectId; specialty: CareSpecialty; teamId: TeamId; staffId?: StaffId };

export type DoseSlot = 'morning' | 'afternoon' | 'night';

/** A clinician-entered prescription — the only medicines that drive Family reminders. The app never suggests one. */
export type Prescription = {
  id: PrescriptionId;
  motherId: MotherId;
  /** Whose prescription: the pregnancy (obstetrician) xor the baby (paediatrician). Unknown on the Family face. */
  pregnancyId?: PregnancyId;
  babyId?: BabyId;
  name: string;
  dose?: string;
  slots: DoseSlot[];
  instructions?: string;
};

/**
 * One audit entry. `action` is the raw action code (e.g. 'view_record'); `entity` is what the entry is about as shown
 * (a table name in Supabase mode, an id or MCH id in the demo store); `entityId` / `motherId` are the record ids
 * (Supabase mode) used to find the entries of one record.
 */
export type AuditEntry = { id: Id; at: Date; actor: string; action: string; entity: string; entityId?: string; motherId?: MotherId };

export type CaregiverScopes = { schedule: boolean; baby: boolean; logs: boolean; tests: boolean };

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
  lengthCm?: number;
  headCircCm?: number;
  note?: string;
};

export type MedDose = { id: MedDoseId; motherId: MotherId; med: string; medicationId?: PrescriptionId; date: string; slot: 'morning' | 'afternoon' | 'night'; status: 'taken' | 'skipped'; at: Date };

export type CaptureField = { key: string; label: string; value: string; confidence: number; confirmed: boolean };

export type CaptureDoc = {
  id: DocumentId;
  subjectId: SubjectId;
  /** The photo on this phone (just captured). */
  uri?: string;
  /** Internal storage key of the uploaded photo — only for a signed URL, never shown. */
  storagePath?: string;
  fields: CaptureField[];
  at: Date;
  by: string;
  visitId?: VisitId;
};

/** A documented history fact of the mother (correctable only by entered-in-error). */
export type DocumentedFact = { id: Id; motherId: MotherId; kind: 'condition' | 'allergy' | 'previous_pregnancy'; label: string };

/** Emergency access ("break the glass") held by the signed-in clinician: 24 hours at most, with a reason. */
export type AccessOverride = { id: Id; motherId: MotherId; reason: string; grantedAt: Date; expiresAt: Date; /** Whose override (Supabase mode). */ staffId?: StaffId };

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
export type SharedResult = { referralId: ReferralId; investigationId: InvestigationId };

/** Kinds of recorded facts that can be marked entered in error (server `mark_entered_in_error`). */
export type EieKind = 'encounter' | 'investigation_result' | 'care_note' | 'self_log' | 'condition' | 'allergy' | 'previous_pregnancy' | 'immunization';
