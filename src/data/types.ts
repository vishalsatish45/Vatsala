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

export type PrevPregnancy = { year: number; outcome: string; mode?: string; note?: string };

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
export type Discharge = { subjectId: Id; subject: 'mother' | 'baby'; items: DischargeItem[]; completedAt?: Date; completedBy?: string };

export type AuditEntry = { id: Id; at: Date; actor: string; action: string; entity: string };

export type CaregiverScopes = { schedule: boolean; baby: boolean; logs: boolean };

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

export type MedDose = { id: Id; motherId: Id; med: string; date: string; slot: 'morning' | 'afternoon' | 'night'; status: 'taken' | 'skipped'; at: Date };

export type CaptureField = { key: string; label: string; value: string; confidence: number; confirmed: boolean };

export type CaptureDoc = { id: Id; subjectId: Id; uri?: string; fields: CaptureField[]; at: Date; by: string; visitId?: Id };
