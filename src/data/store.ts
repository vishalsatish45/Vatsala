/**
 * App data store. Screens read `DbState` and call these actions.
 *
 *  - Mock mode (EXPO_PUBLIC_AUTH_MODE=mock): the store *is* the backend — in memory, seeded with synthetic data.
 *  - Supabase mode: the store is the optimistic layer. Each action updates the screen at once and
 *    queues the matching RPC in the outbox; the server re-validates everything, and the store is reloaded from it
 *    (src/data/sync.ts). Ids are client-generated UUIDs, so the record a screen opens is the one the server saves.
 */
import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';
import { addDays, gestationalAge, localDay, toDateOnly } from '@domain/gestation';
import { ancVisitDates, investigationWindows, vaccineSchedule, type Intensity } from '@domain/schedules';

import { DISCHARGE_BABY, DISCHARGE_MOTHER } from './catalogue';
import { dischargePlan } from './discharge';
import {
  callbackOutcomeCodes,
  complicationCodes,
  contactOutcomeCodes,
  contactSuccessful,
  counsellingCodes,
  deliveryModeCodes,
  followUpCodes,
  labourMedicineCodes,
  previousLabel,
  signLabel,
  splitComplaints,
} from './codes';
import { enqueue, useOutbox } from './outbox';
import {
  caregiverScopesPayload,
  eddFor,
  eiePayload,
  motherUpdatePayload,
  notificationsReadPayload,
  prescribePayload,
  redatePayload,
  registerPayload,
  type MotherDetails,
  type PrescriptionInput,
  type RegisterDating,
  type RegisterInput,
  type Subject,
} from './payloads';
import { e164, emptyState, isoDay } from './remote';
import { useNetwork } from '@/lib/network';
import { isRemote } from '@/lib/supabase';
import { useSession } from '@/state/session';

import { asPregnancyId, asStaffId, type IdKind, type IdOf } from './ids';
import { buildSeed } from './seed';
import type { CardField } from './catalogue';
import type {
  AccessOverride,
  AppNotification,
  AuditEntry,
  BabyId,
  CallbackId,
  CaptureDoc,
  CaptureField,
  CareAssignment,
  CareSpecialty,
  CaregiverId,
  Caregiver,
  CaregiverScopes,
  DocumentedFact,
  EieKind,
  MedDose,
  NewbornObs,
  Note,
  Baby,
  Callback,
  ChecklistState,
  Delivery,
  DeliveryPlace,
  DocumentId,
  Discharge,
  HospitalContact,
  Id,
  Immunization,
  ImmunizationId,
  LabourOnset,
  Investigation,
  InvestigationId,
  Mother,
  MotherId,
  Pregnancy,
  PregnancyId,
  Prescription,
  Referral,
  ReferralId,
  ReferralStatus,
  SelfLog,
  SharedResult,
  SelfLogId,
  StaffId,
  StaffMember,
  SubjectId,
  Tag,
  Task,
  TaskId,
  TeamId,
  TeamMember,
  TeamRef,
  Visit,
  VisitId,
} from './types';

export type DbState = {
  mothers: Mother[];
  pregnancies: Pregnancy[];
  tags: Tag[];
  visits: Visit[];
  tasks: Task[];
  investigations: Investigation[];
  referrals: Referral[];
  callbacks: Callback[];
  selfLogs: SelfLog[];
  deliveries: Delivery[];
  babies: Baby[];
  immunizations: Immunization[];
  discharges: Discharge[];
  audit: AuditEntry[];
  caregivers: Caregiver[];
  cardFields: Record<Id, CardField[]>;
  notes: Note[];
  newbornObs: NewbornObs[];
  medDoses: MedDose[];
  captures: CaptureDoc[];
  /** Care Team of the signed-in clinician's hospital (assignment picker). */
  staff: StaffMember[];
  /** Hospital departments and units (referral destinations; units hold patients). */
  teams: TeamRef[];
  /** Current unit memberships (who can be named on a unit's patients). */
  teamMembers: TeamMember[];
  /** Current care-team assignment of each visible pregnancy and baby, per specialty. */
  assignments: CareAssignment[];
  prescriptions: Prescription[];
  /** The mother's documented conditions, allergies and previous pregnancies, by row (entered-in-error needs ids). */
  facts: DocumentedFact[];
  /** Active emergency overrides visible to the signed-in clinician. */
  overrides: AccessOverride[];
  /** Server notifications for the signed-in person (Supabase mode; the demo store derives its inbox instead). */
  notifications: AppNotification[];
  /** Results shared with referrals (sensitive tests reach a specialist only this way). */
  sharedResults: SharedResult[];
  /** Family face: her hospital's name and phones (from the server; the demo hospital in mock mode). */
  hospital?: HospitalContact;
  mchSeq: number;
};

/** A new record id, typed by its kind. UUIDs, so an id made on the phone is the id the server stores. */
export function uid<K extends IdKind>(kind: K): IdOf[K];
export function uid(kind?: string): Id;
export function uid(_kind?: string): Id {
  return randomUUID();
}

export type { MotherDetails, RegisterInput };

export type VisitInput = Omit<Visit, 'id' | 'pregnancyId' | 'at' | 'by'> & { nextVisitOn: Date };

/** Tag codes to add and to remove (server set_tags deltas). */
export type TagChange = { add: string[]; remove: string[] };

/** A pregnancy whose ANC visits are still planned: ongoing, in the community or admitted. */
export const isOngoing = (p: Pick<Pregnancy, 'status'>) => p.status === 'active' || p.status === 'admitted';

export type BabyInput = {
  sex: 'F' | 'M' | 'U';
  /** Required for a liveborn baby; may be unknown for a stillborn baby. */
  birthWeightG?: number;
  lengthCm?: number;
  headCircCm?: number;
  apgar1?: number;
  apgar5?: number;
  outcome: 'live' | 'stillbirth';
  stillbirthType?: 'fresh' | 'macerated';
  resuscitation?: boolean;
  birthDefects?: string;
  breastfedWithin1h?: boolean;
  vitaminK?: boolean;
  birthDoses: boolean;
};

export type DeliveryInput = {
  at: Date;
  mode: string;
  indication?: string;
  bloodLossMl?: number;
  complications: string[];
  /** Free text for "Other" complications, as documented. */
  complicationsNote?: string;
  medicines: string[];
  medicinesNote?: string;
  place: DeliveryPlace;
  labourOnset?: LabourOnset;
  perineum?: string;
  maternalCondition?: string;
  attendedBy?: string;
  babies: BabyInput[];
};

/** Admission to the labour room / ward: the documented time and reason (server `admit`). */
export type AdmitInput = { at: Date; reason?: string };

/** A vaccine dose as documented (server `record_vaccine`): given here or elsewhere, or not given with a reason. */
export type VaccineDoseInput =
  | {
      action: 'given';
      givenOn: Date;
      /** true: given at this facility · false: reported from a card or another facility. */
      here: boolean;
      batch?: string;
      expiryOn?: Date;
      manufacturer?: string;
      site?: string;
      route?: string;
      location?: string;
    }
  | { action: 'not_given'; reason: string };

type Actions = {
  reset: (now: Date) => void;
  /** Replace the whole state with the server's (Supabase mode). */
  hydrate: (state: DbState) => void;
  registerPregnancy: (input: RegisterInput, by: string, now: Date) => PregnancyId;
  recordVisit: (pregnancyId: PregnancyId, input: VisitInput, by: string, at: Date) => VisitId;
  /**
   * Add and remove tags (deltas, so another clinician's change made meanwhile is never undone). `note` goes with the
   * added tags and is the reason for the removed ones (required when removing).
   */
  setTags: (subjectId: SubjectId, change: TagChange, note: string | undefined, by: string, now: Date) => void;
  /** A pregnancy's future ANC visits are re-planned only while it is ongoing (active or admitted). */
  setIntensity: (subjectId: SubjectId, intensity: Intensity, by: string, now: Date) => void;
  /** Correct a mother's details (update_mother: the changed fields only, version-checked). */
  updateMother: (motherId: MotherId, details: MotherDetails, by: string, now: Date) => void;
  /** Reassign a pregnancy's or a baby's care team, with or without a named doctor (assign_care). */
  assignCare: (subjectId: SubjectId, specialty: CareSpecialty, teamId: TeamId, staffId: StaffId | undefined, reason: string, by: string, now: Date) => void;
  orderInvestigation: (id: InvestigationId, by: string, now: Date) => void;
  enterResult: (id: InvestigationId, value: string, unit: string | undefined, note: string | undefined, by: string, now: Date) => void;
  reviewResult: (id: InvestigationId, followUp: string, by: string, now: Date) => void;
  markNotDone: (id: InvestigationId, reason: string, by: string, now: Date) => void;
  createReferral: (r: Pick<Referral, 'pregnancyId' | 'department' | 'urgency' | 'reason' | 'question'> & { toTeamId?: TeamId }, by: string, now: Date) => ReferralId;
  advanceReferral: (id: ReferralId, to: ReferralStatus, data: { scheduledAt?: Date; place?: string; recommendations?: string; note?: string }, by: string, now: Date) => void;
  /** `signs` are warning-sign codes (catalogue WARNING_SIGNS keys); the record shows their English labels. */
  requestCallback: (motherId: MotherId, signs: string[], note: string | undefined, requestedBy: string, channel: Callback['channel'], now: Date, voice?: { uri: string; seconds: number }) => CallbackId;
  logAccess: (subjectId: SubjectId, actor: string, now: Date) => void;
  closeCallback: (id: CallbackId, outcome: string, note: string | undefined, by: string, now: Date) => void;
  logContact: (taskId: TaskId, outcome: string, by: string, now: Date) => void;
  rescheduleTask: (taskId: TaskId, dueBy: Date, reason: string, by: string, now: Date) => void;
  cancelTask: (taskId: TaskId, reason: string, by: string, now: Date) => void;
  addSelfLog: (log: Omit<SelfLog, 'id'>) => SelfLogId;
  admit: (pregnancyId: PregnancyId, input: AdmitInput, by: string) => void;
  recordDelivery: (pregnancyId: PregnancyId, input: DeliveryInput, by: string) => BabyId[];
  setDischargeItem: (subjectId: SubjectId, key: string, state: 'done' | 'na' | 'deferred' | undefined, reason: string | undefined) => void;
  /** `at`: when the discharge happened (documented time); the follow-up plan counts from the birth. */
  completeDischarge: (subjectId: SubjectId, by: string, at: Date) => void;
  recordVaccine: (immunizationId: ImmunizationId, dose: VaccineDoseInput, by: string, now: Date) => void;
  addCaregiver: (c: Omit<Caregiver, 'id' | 'addedAt'>, now: Date) => void;
  revokeCaregiver: (id: CaregiverId, by: string, now: Date) => void;
  setCardFields: (motherId: MotherId, fields: CardField[]) => void;
  addNote: (subjectId: SubjectId, body: string, author: string, kind: Note['kind'], now: Date) => void;
  addNewbornObs: (obs: Omit<NewbornObs, 'id'>) => void;
  logDose: (d: Omit<MedDose, 'id'>) => void;
  /** `documentId`: the capture already opened on the server for transcription (Supabase mode, ai/capture.ts). */
  saveCapture: (doc: Omit<CaptureDoc, 'id' | 'visitId'> & { documentId?: DocumentId }, now: Date) => VisitId;
  /** Demo mode only: register import rows on the phone (Supabase mode sends them at once, src/data/registration.ts). */
  importRegister: (rows: RegisterInput[], by: string, now: Date) => PregnancyId[];
  /** A clinician-entered prescription for a pregnancy (obstetrics) or a baby (paediatrics). */
  prescribe: (subject: Subject, input: PrescriptionInput, by: string, now: Date) => Id;
  stopMedication: (id: Id, reason: string, by: string, now: Date) => void;
  /**
   * The dating chosen by the clinician. The FIRST dating of a pregnancy registered without one plans the ANC visits
   * and test windows; a re-dating re-plans the future ANC visits from the new EDD.
   */
  redatePregnancy: (pregnancyId: PregnancyId, input: RegisterDating, by: string, now: Date) => void;
  /** End an ongoing pregnancy with its outcome, or close a delivered episode (reason 'delivered'). */
  endPregnancy: (pregnancyId: Id, reason: string, note: string | undefined, endedOn: Date | undefined, by: string, now: Date) => void;
  /** End an admission that did not lead to a delivery, at the documented time `at`. */
  endAdmission: (pregnancyId: Id, by: string, at: Date) => void;
  recordBabyDeath: (babyId: Id, at: Date, note: string | undefined, by: string) => void;
  markEnteredInError: (kind: EieKind, id: Id, reason: string, by: string, now: Date) => void;
  shareResult: (referralId: ReferralId, investigationId: InvestigationId, by: string, now: Date) => void;
  updateCaregiver: (id: Id, scopes: CaregiverScopes, by: string, now: Date) => void;
  markNotificationsRead: (ids: Id[] | 'all', now: Date) => void;
  /** Demo mode only: emergency access is simulated on the phone (Supabase mode asks the server, src/data/emergency.ts). */
  grantOverrideLocal: (mchId: string, reason: string, now: Date) => { motherId: Id; pregnancyId: Id } | undefined;
  endOverride: (id: Id, by: string, now: Date) => void;
};

export type Db = DbState & Actions;

const audit = (s: DbState, actor: string, action: string, entity: string, at: Date): AuditEntry[] => [
  { id: uid('au'), at, actor, action, entity },
  ...s.audit,
];

/** A write the phone cannot send yet (e.g. a record the server has not confirmed): told to the user, not queued. */
function refuse(rpc: string, message: string) {
  useOutbox.setState({ failure: { rpc, message } });
}

/**
 * Supabase mode: vaccine doses planned on this phone for a delivery the server has not loaded back yet. The server
 * plans the schedule itself (with its own ids) when the delivery arrives, and the next reload shows those; until
 * then a dose shown here does not exist on the server, so it cannot be recorded or corrected.
 */
const unsavedDoses = new Set<Id>();

/** True while a dose is only this phone's plan (its delivery is still being saved). */
export const isUnsavedDose = (id: Id) => unsavedDoses.has(id);

export const DOSE_WAIT_MESSAGE = 'The delivery is still being saved — record vaccines once it has synced.';

// ── ANC plan ────────────────────────────────────────────────────────────────────

type Replan = { tasks: Task[]; cancelled: Task[]; fresh: Task[] };

/**
 * Cancel open future ANC visits and plan new ones from `from` using the pregnancy's intensity. An undated pregnancy
 * has no ANC plan: nothing is planned until the doctor records the dating (the server refuses ANC visits until then).
 */
function regenerateAnc(s: DbState, p: Pregnancy, from: Date, firstOn?: Date): Replan {
  const isFutureOpen = (t: Task) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() > from.getTime();
  if (!p.edd) return { tasks: s.tasks, cancelled: [], fresh: [] };
  const cancelled = s.tasks.filter(isFutureOpen);
  const kept = s.tasks.filter((t) => !isFutureOpen(t));
  const start = firstOn ?? from;
  const fresh = ancTasks(p.id, p.edd, [...(firstOn ? [firstOn] : []), ...ancVisitDates(p.edd, p.intensity, start)]);
  return { tasks: [...kept, ...fresh], cancelled, fresh };
}

/** The test windows and ANC visits a dating plans from `now` (registration used to plan them; now the first dating). */
function datingPlan(pregnancyId: PregnancyId, edd: Date, intensity: Intensity, rhNegative: boolean, now: Date) {
  const investigations: Investigation[] = investigationWindows(edd, now, { rhNegative }).map((w) => ({ id: uid('iv'), subjectId: pregnancyId, status: 'due', ...w }));
  const tasks = ancTasks(pregnancyId, edd, ancVisitDates(edd, intensity, now));
  return { investigations, tasks };
}

/** Rh-negative as documented (blood group) or tagged by the clinician: the windows then include the ICT. */
const isRhNegative = (bloodGroup: string | undefined, tagCodes: string[]) => /-|neg/i.test(bloodGroup ?? '') || tagCodes.includes('rh_neg');

/** Planned ANC visits on the given days. */
function ancTasks(pregnancyId: PregnancyId, edd: Date, dates: Date[]): Task[] {
  return dates.map((d) => ({
    id: uid('tk'),
    kind: 'anc_visit',
    subjectType: 'pregnancy',
    subjectId: pregnancyId,
    title: `ANC visit · ${gestationalAge(edd, d).weeks} weeks`,
    dueFrom: addDays(d, -2),
    dueBy: d,
    generatedBy: 'protocol',
    contactAttempts: [],
  }));
}

const taskRows = (tasks: Task[]) => tasks.map((t) => ({ id: t.id, kind: t.kind, title: t.title, due_from: t.dueFrom && isoDay(t.dueFrom), due_by: isoDay(t.dueBy) }));

// ── Payload builders (the RPC contracts in supabase/migrations/2026100500030*–60*) ──

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

/** Content type of a photographed paper record, from its file name (the picker saves JPEG unless told otherwise). */
export function photoMime(uri: string) {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

function observationRows(vitals: Visit['vitals']) {
  return VITAL_CODES.flatMap(([k, code]) => {
    const v = vitals[k];
    if (v === undefined || v === '') return [];
    return [typeof v === 'number' ? { code, value_num: v } : { code, value_text: v }];
  });
}

// ── Paper capture (PRD F-31): confirmed fields → visit values ─────────────────────

/** The dipstick scale urine albumin and sugar are recorded on (observation_codes.allowed_values, supabase/seed.sql). */
export const URINE_SCALE = ['Nil', 'Trace', '1+', '2+', '3+'] as const;

/** Capture fields that are recorded only as one of these values: the screen offers them as choices to confirm. */
export const CAPTURE_CHOICES: Partial<Record<string, readonly string[]>> = { albumin: URINE_SCALE, urine_sugar: URINE_SCALE };

/**
 * Possible-entry bounds of observation_codes (supabase/seed.sql). Data quality only — an entry outside them cannot be
 * a reading (a slip of the pen or of the transcription) and the server refuses it. Never a clinical threshold.
 */
const POSSIBLE = { weight: [20, 250], bp_sys: [40, 300], bp_dia: [20, 200], fundal_height: [5, 60], fhr: [40, 260] } as const;

const possible = (code: keyof typeof POSSIBLE, n: number | undefined) => (n !== undefined && n >= POSSIBLE[code][0] && n <= POSSIBLE[code][1] ? n : undefined);

/** "61 kg" → 61: a plain number, optionally followed by the expected unit; anything else is not read as a number. */
function readNumber(value: string, unit: string): number | undefined {
  const m = new RegExp(`^(\\d{1,3}(?:\\.\\d+)?)\\s*(?:${unit})?$`, 'i').exec(value.trim());
  return m ? Number(m[1]) : undefined;
}

export type CaptureMapping = {
  vitals: Visit['vitals'];
  /** ANC checklist components the confirmed fields complete. */
  components: string[];
  /** Confirmed fields recorded as visit values (observations / checklist), by key. */
  recorded: string[];
  /** Confirmed fields kept on the paper-record document only (dates, Hb — a lab result —, or text not read as a value). */
  documentOnly: string[];
};

/**
 * Which confirmed capture fields become values of the ANC visit, copied exactly as confirmed (never interpreted):
 * weight, BP, FHR, fundal height, urine albumin and sugar. Everything else confirmed stays on the document only.
 */
export function captureVisit(fields: CaptureField[]): CaptureMapping {
  const out: CaptureMapping = { vitals: {}, components: [], recorded: [], documentOnly: [] };
  for (const f of fields) {
    if (!f.confirmed) continue;
    const v = f.value.trim();
    let ok = false;
    switch (f.key) {
      case 'weight': {
        const n = possible('weight', readNumber(v, 'kgs?\\.?'));
        if ((ok = n !== undefined)) out.vitals.weightKg = n;
        break;
      }
      case 'bp': {
        const m = /^(\d{2,3})\s*\/\s*(\d{2,3})\s*(?:mm\s*hg)?$/i.exec(v);
        const sys = possible('bp_sys', m ? Number(m[1]) : undefined);
        const dia = possible('bp_dia', m ? Number(m[2]) : undefined);
        if ((ok = sys !== undefined && dia !== undefined)) Object.assign(out.vitals, { bpSys: sys, bpDia: dia });
        break;
      }
      case 'fhr': {
        const n = possible('fhr', readNumber(v, '\\/\\s*min|bpm|b\\/min'));
        if ((ok = n !== undefined)) out.vitals.fhr = n;
        break;
      }
      case 'fundal_height': {
        const n = possible('fundal_height', readNumber(v, 'cms?\\.?'));
        if ((ok = n !== undefined)) out.vitals.fundalHeightCm = n;
        break;
      }
      case 'albumin':
        if ((ok = URINE_SCALE.includes(v as (typeof URINE_SCALE)[number]))) out.vitals.urineAlbumin = v;
        break;
      case 'urine_sugar':
        if ((ok = URINE_SCALE.includes(v as (typeof URINE_SCALE)[number]))) out.vitals.urineSugar = v;
        break;
    }
    (ok ? out.recorded : out.documentOnly).push(f.key);
  }
  const has = (k: keyof Visit['vitals']) => out.vitals[k] !== undefined;
  // Checklist components (pick list 'anc_component'); urine sugar has none.
  if (has('bpSys')) out.components.push('bp');
  if (has('weightKg')) out.components.push('weight');
  if (has('urineAlbumin')) out.components.push('urine_albumin');
  if (has('fundalHeightCm')) out.components.push('fundal_height');
  if (has('fhr')) out.components.push('fhr');
  return out;
}

/** "11.2 g/dL" → a number and its unit; anything else is kept as text, exactly as entered. */
function resultValue(value: string, unit?: string) {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s][^\d]*)?$/);
  return m ? { value_num: Number(m[1]), unit: unit ?? m[2]?.trim() } : { value_text: value.trim(), unit };
}

/** The signed-in obstetrician's first obstetric unit (when the form did not ask: she has only one). */
function myObstetricUnit() {
  return useSession.getState().account?.care?.teams?.find((t) => t.kind === 'unit' && t.specialty === 'obstetrics')?.id;
}

/**
 * What a registration creates, planned on the phone (ids and — only when the registration carries a dating, as a
 * register import row does — the ANC visits and test windows) and its RPC payload. Nothing is saved yet. Dates only:
 * the plan comes from shared/domain, never from a reading. Without a dating nothing is planned until the doctor
 * records it (`redatePregnancy`, first dating).
 */
export function planRegistration(input: RegisterInput, now: Date) {
  const motherId = input.existingMotherId ?? uid('mo');
  const pregnancyId = uid('pg');
  const edd = input.dating && eddFor(input.dating);
  const { investigations, tasks } = edd
    ? datingPlan(pregnancyId, edd, input.intensity, isRhNegative(input.history.bloodGroup, input.tagCodes), now)
    : { investigations: [] as Investigation[], tasks: [] as Task[] };
  const teamId = input.teamId ?? myObstetricUnit();
  const payload = registerPayload({ ...input, teamId }, { motherId, pregnancyId, investigations, tasks });
  return { motherId, pregnancyId, edd, investigations, tasks, teamId, payload };
}

/** A returning mother's record corrected with what the form entered (blank fields keep her value, as on the server). */
function withEntered(m: Mother, d: MotherDetails): Mother {
  const entered = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== ''));
  return { ...m, ...entered, emergencyContact: d.emergencyContact.phone ? d.emergencyContact : m.emergencyContact };
}

const initial = (): DbState => (isRemote ? emptyState() : buildSeed(new Date()));

export const useDb = create<Db>()((set, get) => {
  /** Registration on the phone (optimistic in Supabase mode); returns the RPC payload. */
  function registerLocal(input: RegisterInput, by: string, now: Date) {
    const s = get();
    const plan = planRegistration(input, now);
    const motherId = plan.motherId;
    const seq = s.mchSeq + 1;
    const p: Pregnancy = {
      id: plan.pregnancyId,
      // In Supabase mode the server assigns the MCH id; it appears once the record is saved.
      mchId: isRemote ? 'MCH id pending' : `MCH-${now.getFullYear()}-${String(seq).padStart(6, '0')}`,
      motherId,
      registeredOn: input.registeredOn,
      lmp: input.dating?.method === 'lmp' ? input.dating.lmp : undefined,
      edd: plan.edd,
      eddSource: input.dating?.method,
      gpla: input.gpla,
      status: 'active',
      intensity: input.intensity,
      // The registering obstetrician is her doctor (the server does the same).
      assignedDoctor: { name: by },
      history: input.history,
      // Supabase mode: the server's row ids arrive with the next load.
      previous: input.previous.map((x) => ({ ...x, id: isRemote ? undefined : uid('pp') })),
    };
    const facts: DocumentedFact[] = isRemote
      ? []
      : [
          ...input.history.conditions.map((label) => ({ id: uid('dc'), motherId, kind: 'condition' as const, label })),
          ...input.history.allergies.map((label) => ({ id: uid('al'), motherId, kind: 'allergy' as const, label })),
          ...p.previous.map((x) => ({ id: x.id!, motherId, kind: 'previous_pregnancy' as const, label: previousLabel(x) })),
        ];
    const tags: Tag[] = input.tagCodes.map((code) => ({ id: uid('tg'), subjectId: p.id, code, note: input.tagNote, setBy: by, setAt: now }));
    const returning = s.mothers.find((m) => m.id === input.existingMotherId);
    const mothers = returning
      ? s.mothers.map((m) => (m.id === returning.id ? withEntered(m, input.mother) : m))
      : [...s.mothers, { id: motherId, ...input.mother, ipNo: isRemote ? undefined : `IP-${now.getFullYear()}-${String(seq).padStart(6, '0')}` }];
    const me = useSession.getState().account?.care?.staffId;
    const paeds = s.teams.find((t) => t.kind === 'unit' && t.specialty === 'paediatrics')?.id;
    const assignments: CareAssignment[] = [
      ...(plan.teamId ? [{ subjectId: p.id, specialty: 'obstetrics' as const, teamId: plan.teamId, staffId: me ? asStaffId(me) : undefined }] : []),
      ...(paeds ? [{ subjectId: p.id, specialty: 'paediatrics' as const, teamId: paeds }] : []),
    ];
    set({
      mothers,
      pregnancies: [...s.pregnancies, p],
      mchSeq: seq,
      tags: [...s.tags, ...tags],
      facts: [...s.facts, ...facts],
      investigations: [...s.investigations, ...plan.investigations],
      tasks: [...s.tasks, ...plan.tasks],
      assignments: [...s.assignments, ...assignments],
      audit: audit(s, by, 'register_pregnancy', p.mchId, now),
    });
    return { id: p.id, payload: plan.payload };
  }

  return {
    ...initial(),

    reset: (now) => {
      if (!isRemote) return set(buildSeed(now));
      enqueue('reset_demo', { confirm: 'RESET DEMO DATA' });
    },

    hydrate: (state) => {
      // Doses of a delivery the server now has come back under the server's own ids.
      for (const id of unsavedDoses) if (!state.immunizations.some((i) => i.id === id)) unsavedDoses.delete(id);
      set(state);
    },

    registerPregnancy: (input, by, now) => {
      const { id, payload } = registerLocal(input, by, now);
      enqueue('register_pregnancy', payload, { entityId: id });
      return id;
    },

    recordVisit: (pregnancyId, input, by, at) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId)!;
      const counselling = input.counselling ?? [];
      const visit: Visit = { id: uid('vs'), pregnancyId, at, by, vitals: input.vitals, checklist: input.checklist, complaints: input.complaints, counselling, note: input.note };
      // Close the open ANC task nearest to this visit (within 14 days after its due date).
      const open = s.tasks
        .filter((t) => t.subjectId === pregnancyId && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() <= addDays(at, 14).getTime())
        .sort((a, b) => Math.abs(a.dueBy.getTime() - at.getTime()) - Math.abs(b.dueBy.getTime() - at.getTime()));
      const closed = open[0];
      const withClosed = s.tasks.map((t) => (t.id === closed?.id ? { ...t, completedAt: at, refId: visit.id } : t));
      const plan = regenerateAnc({ ...s, tasks: withClosed }, p, at, input.nextVisitOn);
      set({ visits: [...s.visits, visit], tasks: plan.tasks, audit: audit(s, by, 'record_visit', p.mchId, at) });
      useNetwork.getState().markPending(visit.id);

      const counted = Object.values(input.checklist).filter((c) => c.state !== 'na');
      const { codes, note: complaintsNote } = splitComplaints(input.complaints);
      enqueue(
        'record_visit',
        {
          encounter_id: visit.id,
          pregnancy_id: pregnancyId,
          at: at.toISOString(),
          ga_days: p.edd && gestationalAge(p.edd, at).totalDays,
          observations: observationRows(input.vitals),
          checklist: Object.entries(input.checklist).map(([component, c]) => ({ component, state: c.state, reason: c.reason })),
          complaints: codes,
          complaints_note: complaintsNote,
          counselling: counselling.flatMap((l) => counsellingCodes.code(l) ?? []),
          note: input.note,
          completeness: counted.length ? Math.round((counted.filter((c) => c.state === 'done').length / counted.length) * 1000) / 1000 : undefined,
          close_task_id: closed?.id,
          cancel_task_ids: plan.cancelled.map((t) => t.id),
          new_tasks: taskRows(plan.fresh),
        },
        { entityId: visit.id },
      );
      return visit.id;
    },

    setTags: (subjectId, change, note, by, now) => {
      const s = get();
      const add = [...new Set(change.add)].filter((c) => !change.remove.includes(c));
      const remove = [...new Set(change.remove)];
      if (!add.length && !remove.length) return;
      // Only these codes change: a tag someone else set or removed meanwhile stays as they left it (server set_tags).
      const active = s.tags.filter((t) => t.subjectId === subjectId && !t.removedAt);
      const removed = active.filter((t) => remove.includes(t.code)).map((t) => t.id);
      const added = add
        .filter((c) => !active.some((t) => t.code === c))
        .map((code): Tag => ({ id: uid('tg'), subjectId, code, note, setBy: by, setAt: now }));
      set({
        tags: [...s.tags.map((t) => (removed.includes(t.id) ? { ...t, removedAt: now, removedReason: note } : t)), ...added],
        audit: audit(s, by, `tags ${[...add.map((c) => `+${c}`), ...remove.map((c) => `−${c}`)].join(' ')}`, subjectId, now),
      });
      const subject = s.babies.some((b) => b.id === subjectId) ? { baby_id: subjectId } : { pregnancy_id: subjectId };
      enqueue(
        'set_tags',
        {
          ...subject,
          add: add.length ? add : undefined,
          remove: remove.length ? remove : undefined,
          note: add.length ? note : undefined,
          removal_reason: remove.length ? note : undefined,
          at: now.toISOString(),
        },
        { entityId: subjectId },
      );
    },

    setIntensity: (subjectId, intensity, by, now) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === subjectId);
      if (p && !isOngoing(p)) {
        // Delivered or closed: the intensity is recorded, but no ANC visit is planned any more (server set_intensity).
        set({ pregnancies: s.pregnancies.map((x) => (x.id === p.id ? { ...x, intensity } : x)), audit: audit(s, by, `intensity → ${intensity}`, p.mchId, now) });
        enqueue('set_intensity', { pregnancy_id: p.id, intensity, at: now.toISOString() }, { entityId: p.id, withVersion: true });
        return;
      }
      if (p) {
        const updated = { ...p, intensity };
        const lastVisit = s.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
        const from = lastVisit && lastVisit.at.getTime() > addDays(now, -28).getTime() ? lastVisit.at : now;
        const pregnancies = s.pregnancies.map((x) => (x.id === p.id ? updated : x));
        const plan = regenerateAnc({ ...s, pregnancies }, updated, from);
        set({ pregnancies, tasks: plan.tasks, audit: audit(s, by, `intensity → ${intensity}`, p.mchId, now) });
        enqueue(
          'set_intensity',
          { pregnancy_id: p.id, intensity, cancel_task_ids: plan.cancelled.map((t) => t.id), new_tasks: taskRows(plan.fresh), at: now.toISOString() },
          { entityId: p.id, withVersion: true },
        );
        return;
      }
      set({ babies: s.babies.map((b) => (b.id === subjectId ? { ...b, intensity } : b)), audit: audit(s, by, `intensity → ${intensity}`, subjectId, now) });
      enqueue('set_intensity', { baby_id: subjectId, intensity, at: now.toISOString() }, { entityId: subjectId, withVersion: true });
    },

    updateMother: (motherId, details, by, now) => {
      const s = get();
      const m = s.mothers.find((x) => x.id === motherId);
      if (!m) return;
      const changed = motherUpdatePayload(m, details);
      if (!Object.keys(changed).length) return;
      set({
        mothers: s.mothers.map((x) => (x.id === motherId ? { ...details, id: x.id, ipNo: x.ipNo } : x)),
        audit: audit(s, by, `update_mother (${Object.keys(changed).join(', ')})`, motherId, now),
      });
      enqueue('update_mother', { mother_id: motherId, ...changed }, { entityId: motherId, withVersion: true });
    },

    assignCare: (subjectId, specialty, teamId, staffId, reason, by, now) => {
      const s = get();
      const doctor = staffId ? s.staff.find((x) => x.id === staffId) : undefined;
      const team = s.teams.find((t) => t.id === teamId)?.name ?? 'team';
      set({
        assignments: [...s.assignments.filter((a) => !(a.subjectId === subjectId && a.specialty === specialty)), { subjectId, specialty, teamId, staffId }],
        pregnancies:
          specialty === 'obstetrics' ? s.pregnancies.map((p) => (p.id === subjectId ? { ...p, assignedDoctor: doctor ? { name: doctor.name } : undefined } : p)) : s.pregnancies,
        audit: audit(s, by, `reassign ${specialty} → ${team}${doctor ? ` · ${doctor.name}` : ''}`, subjectId, now),
      });
      const subject = s.babies.some((b) => b.id === subjectId) ? { baby_id: subjectId } : { pregnancy_id: subjectId };
      enqueue('assign_care', { ...subject, specialty, team_id: teamId, primary_staff_id: staffId, reason, at: now.toISOString() }, { entityId: subjectId });
    },

    orderInvestigation: (id, by, now) => {
      const s = get();
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'ordered', orderedAt: now } : i)), audit: audit(s, by, 'order_investigation', id, now) });
      enqueue('update_investigation', { id, action: 'order', at: now.toISOString() }, { entityId: id, withVersion: true });
    },

    enterResult: (id, value, unit, note, by, now) => {
      const s = get();
      const resultId = uid('rs');
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'resulted', result: { value, unit, note, at: now }, resultId, review: undefined } : i)), audit: audit(s, by, 'enter_result', id, now) });
      enqueue('record_result', { id: resultId, investigation_id: id, ...resultValue(value, unit), reported_at: now.toISOString(), note }, { entityId: id, withVersion: true });
    },

    reviewResult: (id, followUp, by, now) => {
      const s = get();
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'reviewed', review: { by, at: now, followUp } } : i)), audit: audit(s, by, 'review_result', id, now) });
      enqueue('update_investigation', { id, action: 'review', follow_up: followUpCodes.code(followUp), at: now.toISOString() }, { entityId: id, withVersion: true });
    },

    markNotDone: (id, reason, by, now) => {
      const s = get();
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'not_done', notDoneReason: reason } : i)), audit: audit(s, by, 'investigation_not_done', id, now) });
      enqueue('update_investigation', { id, action: 'not_done', reason, at: now.toISOString() }, { entityId: id, withVersion: true });
    },

    createReferral: (r, by, now) => {
      const s = get();
      const team = r.toTeamId ? s.teams.find((t) => t.id === r.toTeamId) : s.teams.find((t) => t.kind === 'department' && t.name === r.department);
      const ref: Referral = { ...r, toTeamId: team?.id, id: uid('rf'), status: 'requested', events: [{ status: 'requested', at: now, by }], createdBy: by };
      set({ referrals: [...s.referrals, ref], audit: audit(s, by, `referral → ${r.department}`, r.pregnancyId, now) });
      enqueue(
        'create_referral',
        { id: ref.id, pregnancy_id: r.pregnancyId, to_team_id: team?.id, urgency: r.urgency, reason: r.reason, question: r.question, at: now.toISOString() },
        { entityId: ref.id },
      );
      return ref.id;
    },

    advanceReferral: (id, to, data, by, now) => {
      const s = get();
      const ref = s.referrals.find((r) => r.id === id)!;
      const next: Referral = {
        ...ref,
        status: to,
        scheduledAt: data.scheduledAt ?? ref.scheduledAt,
        place: data.place ?? ref.place,
        recommendations: data.recommendations ?? ref.recommendations,
        events: [...ref.events, { status: to, at: now, by, note: data.note }],
      };
      let tasks = s.tasks;
      let appointmentId: TaskId | undefined;
      if (to === 'scheduled' && data.scheduledAt) {
        appointmentId = uid('tk');
        tasks = [
          ...tasks.map((t) => (t.refId === id && !t.completedAt && !t.cancelledAt ? { ...t, cancelledAt: now, overrideReason: 'Appointment rescheduled' } : t)),
          { id: appointmentId, kind: 'referral_appt', subjectType: 'pregnancy', subjectId: ref.pregnancyId, title: `${ref.department} appointment`, refId: id, place: data.place, dueFrom: toDateOnly(data.scheduledAt), dueBy: toDateOnly(data.scheduledAt), generatedBy: 'clinician', contactAttempts: [] },
        ];
      }
      if (to === 'seen') tasks = tasks.map((t) => (t.refId === id && !t.completedAt && !t.cancelledAt ? { ...t, completedAt: now } : t));
      // A declined or cancelled referral takes its open appointment with it (the server does the same).
      if (to === 'declined' || to === 'cancelled') {
        tasks = tasks.map((t) => (t.refId === id && !t.completedAt && !t.cancelledAt ? { ...t, cancelledAt: now, overrideReason: `Referral ${to}` } : t));
      }
      set({ referrals: s.referrals.map((r) => (r.id === id ? next : r)), tasks, audit: audit(s, by, `referral ${to}`, id, now) });
      enqueue(
        'advance_referral',
        {
          id,
          to,
          scheduled_at: data.scheduledAt?.toISOString(),
          place: data.place,
          recommendations: data.recommendations,
          note: data.note,
          appointment_task_id: appointmentId,
          at: now.toISOString(),
        },
        { entityId: id, withVersion: true },
      );
    },

    requestCallback: (motherId, signs, note, requestedBy, channel, now, voice) => {
      const s = get();
      const cb: Callback = { id: uid('cb'), motherId, requestedBy, channel, signs: signs.map(signLabel), note, voiceUri: voice?.uri, voiceSeconds: voice?.seconds, at: now };
      useNetwork.getState().markPending(cb.id);
      set({ callbacks: [...s.callbacks, cb], audit: audit(s, requestedBy, 'request_callback', motherId, now) });
      // A voice note goes to the private voice-notes bucket, at the path the server names in its response
      // (voice-notes/<mother>/<call-back>.m4a), right after the request is saved (src/data/outbox.ts).
      enqueue(
        'request_callback',
        {
          id: cb.id,
          mother_id: motherId,
          signs,
          note: note || undefined,
          voice_seconds: voice ? Math.min(300, Math.max(1, Math.round(voice.seconds))) : undefined,
          at: now.toISOString(),
        },
        { entityId: cb.id, upload: voice ? { bucket: 'voice-notes', pathFrom: 'voice_path', localUri: voice.uri, contentType: 'audio/mp4' } : undefined },
      );
      return cb.id;
    },

    closeCallback: (id, outcome, note, by, now) => {
      const s = get();
      set({ callbacks: s.callbacks.map((c) => (c.id === id ? { ...c, closedAt: now, outcome, outcomeNote: note, closedBy: by } : c)), audit: audit(s, by, `callback closed: ${outcome}`, id, now) });
      enqueue('close_callback', { id, outcome: callbackOutcomeCodes.code(outcome), note, at: now.toISOString() }, { entityId: id, withVersion: true });
    },

    logAccess: (subjectId, actor, now) => {
      const s = get();
      // Collapse repeated opens of the same record by the same person within 10 minutes (the server does the same).
      const recent = s.audit.find((a) => a.action === 'view_record' && (a.entityId ?? a.entity) === subjectId && a.actor === actor && now.getTime() - a.at.getTime() < 600_000);
      if (recent) return;
      set({ audit: audit(s, actor, 'view_record', subjectId, now) });
      if (s.pregnancies.some((p) => p.id === subjectId)) enqueue('log_access', { pregnancy_id: subjectId });
      else if (s.babies.some((b) => b.id === subjectId)) enqueue('log_access', { baby_id: subjectId });
    },

    logContact: (taskId, outcome, by, now) => {
      const s = get();
      set({
        tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, contactAttempts: [...t.contactAttempts, { at: now, outcome, by }] } : t)),
        audit: audit(s, by, `contact: ${outcome}`, taskId, now),
      });
      enqueue('log_contact', { id: uid('ct'), task_id: taskId, outcome: contactOutcomeCodes.code(outcome), successful: contactSuccessful(outcome), at: now.toISOString() }, { entityId: taskId });
    },

    rescheduleTask: (taskId, dueBy, reason, by, now) => {
      const s = get();
      set({
        tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, dueFrom: addDays(dueBy, -2), dueBy, overrideReason: reason } : t)),
        audit: audit(s, by, `reschedule (${reason})`, taskId, now),
      });
      enqueue(
        'override_task',
        { id: taskId, action: 'reschedule', due_by: isoDay(dueBy), due_from: isoDay(addDays(dueBy, -2)), reason, at: now.toISOString() },
        { entityId: taskId, withVersion: true },
      );
    },

    cancelTask: (taskId, reason, by, now) => {
      const s = get();
      set({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, cancelledAt: now, overrideReason: reason } : t)), audit: audit(s, by, `cancel task (${reason})`, taskId, now) });
      enqueue('override_task', { id: taskId, action: 'cancel', reason, at: now.toISOString() }, { entityId: taskId, withVersion: true });
    },

    addSelfLog: (log) => {
      const s = get();
      const id = uid('sl');
      const babyId = log.subject === 'baby' ? (log.babyId ?? s.babies.find((b) => b.motherId === log.motherId && b.outcome === 'live')?.id) : undefined;
      set({ selfLogs: [...s.selfLogs, { ...log, babyId, id }] });
      useNetwork.getState().markPending(id);
      enqueue('submit_self_log', { id, mother_id: log.motherId, baby_id: babyId, kind: log.kind, value: log.value, at: log.at.toISOString() }, { entityId: id });
      return id;
    },

    admit: (pregnancyId, input, by) => {
      const s = get();
      const admissionId = uid('ad');
      const reason = input.reason?.trim() || undefined;
      set({
        pregnancies: s.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, status: 'admitted', admissionId, admittedAt: input.at, admissionReason: reason } : p)),
        audit: audit(s, by, 'admit', pregnancyId, input.at),
      });
      enqueue('admit', { id: admissionId, pregnancy_id: pregnancyId, at: input.at.toISOString(), reason }, { entityId: pregnancyId });
    },

    recordDelivery: (pregnancyId, input, by) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId)!;
      // An undated pregnancy has no gestational age at birth (0 = not recorded, as the server's null is read).
      const gaDays = p.edd ? gestationalAge(p.edd, input.at).totalDays : 0;
      const babies: Baby[] = input.babies.map((b, i) => ({
        id: uid('bb'),
        childId: `${p.mchId}-B${i + 1}`,
        motherId: p.motherId,
        pregnancyId,
        dob: input.at,
        sex: b.sex,
        birthWeightG: b.birthWeightG,
        gaAtBirthDays: gaDays,
        apgar1: b.apgar1,
        apgar5: b.apgar5,
        outcome: b.outcome,
        intensity: 'routine',
        lengthCm: b.lengthCm,
        headCircCm: b.headCircCm,
        stillbirthType: b.outcome === 'stillbirth' ? b.stillbirthType : undefined,
        resuscitation: b.resuscitation,
        birthDefects: b.birthDefects,
        breastfedWithin1h: b.outcome === 'live' ? b.breastfedWithin1h : undefined,
        vitaminK: b.outcome === 'live' ? b.vitaminK : undefined,
      }));
      const delivery: Delivery = {
        id: uid('dl'), pregnancyId, at: input.at, mode: input.mode, indication: input.indication, bloodLossMl: input.bloodLossMl,
        complications: input.complications.filter((c) => c !== 'Other'), complicationsNote: input.complicationsNote,
        medicines: input.medicines.filter((c) => c !== 'Other'), medicinesNote: input.medicinesNote, babyIds: babies.map((b) => b.id),
        place: input.place, labourOnset: input.labourOnset, perineum: input.perineum, maternalCondition: input.maternalCondition, attendedBy: input.attendedBy,
      };
      // Doses count from the calendar day of birth (the server uses the hospital's day). Each baby keeps its own
      // "birth doses given" answer — matched by index before filtering, so a stillborn twin never shifts it.
      const birthDay = localDay(input.at);
      const immunizations: Immunization[] = babies.flatMap((b, i) =>
        b.outcome !== 'live'
          ? []
          : vaccineSchedule(birthDay).map((v) => {
              const given = v.group === 'Birth' && !!input.babies[i]?.birthDoses;
              return { id: uid('im'), babyId: b.id, ...v, givenOn: given ? birthDay : undefined, given: given ? { here: true } : undefined };
            }),
      );
      if (isRemote) for (const im of immunizations) unsavedDoses.add(im.id);
      const discharges: Discharge[] = [
        { subjectId: pregnancyId, subject: 'mother', items: DISCHARGE_MOTHER.map((d) => ({ ...d })) },
        ...babies.filter((b) => b.outcome === 'live').map((b): Discharge => ({ subjectId: b.id, subject: 'baby', items: DISCHARGE_BABY.map((d) => ({ ...d })) })),
      ];
      set({
        pregnancies: s.pregnancies.map((x) => (x.id === pregnancyId ? { ...x, status: 'delivered' } : x)),
        tasks: s.tasks.map((t) => (t.subjectId === pregnancyId && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt ? { ...t, cancelledAt: input.at, overrideReason: 'Delivered' } : t)),
        deliveries: [...s.deliveries, delivery],
        babies: [...s.babies, ...babies],
        immunizations: [...s.immunizations, ...immunizations],
        discharges: [...s.discharges, ...discharges],
        audit: audit(s, by, `record_delivery (${babies.map((b) => b.childId).join(', ')})`, p.mchId, input.at),
      });

      const coded = (labels: string[], t: { code: (l: string) => string | undefined }) => ({
        codes: labels.flatMap((l) => t.code(l) ?? []),
        other: labels.filter((l) => !t.code(l)).join(', ') || undefined,
      });
      const comp = coded(input.complications.filter((c) => c !== 'Other'), complicationCodes);
      const meds = coded(input.medicines.filter((c) => c !== 'Other'), labourMedicineCodes);
      const note = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(', ') || undefined;
      enqueue(
        'record_delivery',
        {
          pregnancy_id: pregnancyId,
          delivery: {
            id: delivery.id,
            at: input.at.toISOString(),
            mode: deliveryModeCodes.code(input.mode),
            indication: input.indication,
            blood_loss_ml: input.bloodLossMl,
            complications: input.complications.includes('Other') ? [...comp.codes, 'other'] : comp.codes,
            complications_note: note(comp.other, input.complicationsNote),
            medicines: meds.codes,
            medicines_note: note(meds.other, input.medicinesNote),
            place: input.place,
            labour_onset: input.labourOnset,
            perineum: input.perineum,
            maternal_condition: input.maternalCondition,
            attended_by: input.attendedBy,
          },
          babies: input.babies.map((b, i) => ({
            id: babies[i]!.id,
            sex: b.sex,
            birth_weight_g: b.birthWeightG,
            length_cm: b.lengthCm,
            head_circ_cm: b.headCircCm,
            apgar1: b.apgar1,
            apgar5: b.apgar5,
            outcome: b.outcome,
            stillbirth_type: b.outcome === 'stillbirth' ? b.stillbirthType : undefined,
            resuscitation: b.resuscitation,
            birth_defects: b.birthDefects,
            breastfed_within_1h: b.outcome === 'live' ? b.breastfedWithin1h : undefined,
            vitamin_k: b.outcome === 'live' ? b.vitaminK : undefined,
            birth_doses_given: b.birthDoses,
          })),
        },
        { entityId: delivery.id },
      );
      return babies.map((b) => b.id);
    },

    setDischargeItem: (subjectId, key, state, reason) => {
      const d = get().discharges.find((x) => x.subjectId === subjectId);
      // N/A and Defer are saved together with their reason (the server refuses them without one).
      const why = state === 'na' || state === 'deferred' ? reason?.trim() : undefined;
      if ((state === 'na' || state === 'deferred') && !why) return;
      if (isRemote && !d?.id) return refuse('set_discharge_item', 'The delivery is still being saved — try again in a moment.');
      set((s) => ({
        discharges: s.discharges.map((x) => (x.subjectId === subjectId ? { ...x, items: x.items.map((i) => (i.key === key ? { ...i, state, reason: why } : i)) } : x)),
      }));
      if (d?.id) enqueue('set_discharge_item', { discharge_id: d.id, key, state: state ?? null, reason: why }, { entityId: d.id });
    },

    completeDischarge: (subjectId, by, at) => {
      const s = get();
      const d = s.discharges.find((x) => x.subjectId === subjectId)!;
      if (isRemote && !d.id) return refuse('complete_discharge', 'The delivery is still being saved — try again in a moment.');
      const isBaby = d.subject === 'baby';
      // Follow-ups whose window closed before the day of discharge cannot be planned; the checklist says so.
      const tasks: (Task & { templateKey?: string })[] = dischargePlan(s, subjectId, at)
        .filter((f) => !f.closed)
        .map((f) => ({
          id: uid('tk'),
          kind: f.kind,
          subjectType: isBaby ? 'baby' : 'pregnancy',
          subjectId,
          title: f.title,
          dueFrom: f.dueFrom,
          dueBy: f.dueBy,
          generatedBy: f.templateKey ? 'template' : 'protocol',
          contactAttempts: [],
          templateKey: f.templateKey,
        }));
      set({
        discharges: s.discharges.map((x) => (x.subjectId === subjectId ? { ...x, completedAt: at, completedBy: by } : x)),
        tasks: [...s.tasks, ...tasks.map(({ templateKey: _k, ...t }) => t)],
        audit: audit(s, by, `complete_discharge (+${tasks.length} follow-ups)`, subjectId, at),
      });
      if (d.id) {
        enqueue(
          'complete_discharge',
          { discharge_id: d.id, follow_up_tasks: tasks.map((t) => ({ ...taskRows([t])[0], template_key: t.templateKey })), at: at.toISOString() },
          { entityId: d.id, withVersion: true },
        );
      }
    },

    recordVaccine: (immunizationId, dose, by, now) => {
      if (isUnsavedDose(immunizationId)) return refuse('record_vaccine', DOSE_WAIT_MESSAGE);
      const s = get();
      if (dose.action === 'not_given') {
        const reason = dose.reason.trim();
        set({ immunizations: s.immunizations.map((i) => (i.id === immunizationId ? { ...i, notGivenReason: reason } : i)), audit: audit(s, by, 'vaccine_not_given', immunizationId, now) });
        enqueue('record_vaccine', { id: immunizationId, action: 'not_given', reason }, { entityId: immunizationId, withVersion: true });
        return;
      }
      const text = (v?: string) => v?.trim() || undefined;
      const given = {
        here: dose.here,
        batch: text(dose.batch),
        expiryOn: dose.expiryOn,
        manufacturer: text(dose.manufacturer),
        site: text(dose.site),
        route: text(dose.route),
        location: text(dose.location),
      };
      set({ immunizations: s.immunizations.map((i) => (i.id === immunizationId ? { ...i, givenOn: localDay(dose.givenOn), given } : i)), audit: audit(s, by, 'record_vaccine', immunizationId, now) });
      enqueue(
        'record_vaccine',
        {
          id: immunizationId,
          action: 'given',
          given_on: isoDay(dose.givenOn),
          primary_source: dose.here,
          batch: given.batch,
          expiry_on: given.expiryOn && isoDay(given.expiryOn),
          manufacturer: given.manufacturer,
          site: given.site,
          route: given.route,
          location: given.location,
        },
        { entityId: immunizationId, withVersion: true },
      );
    },

    addCaregiver: (c, now) => {
      const s = get();
      const id = uid('cg');
      set({ caregivers: [...s.caregivers, { ...c, id, addedAt: now }], audit: audit(s, 'mother', `caregiver_added (${c.relation})`, c.motherId, now) });
      enqueue('add_caregiver', { id, phone: e164(c.phone), name: c.name, relation: c.relation, scopes: c.scopes }, { entityId: id });
    },

    revokeCaregiver: (id, by, now) => {
      const s = get();
      set({ caregivers: s.caregivers.map((c) => (c.id === id ? { ...c, revokedAt: now } : c)), audit: audit(s, by, 'caregiver_revoked', id, now) });
      enqueue('revoke_caregiver', { id }, { entityId: id });
    },

    setCardFields: (motherId, fields) => {
      set((s) => ({ cardFields: { ...s.cardFields, [motherId]: fields } }));
      enqueue('set_card_fields', { fields });
    },

    addNote: (subjectId, body, author, kind, now) => {
      const s = get();
      const id = uid('nt');
      set({ notes: [...s.notes, { id, subjectId, author, body, at: now, kind }], audit: audit(s, author, kind === 'ai_verified' ? 'ai_draft_verified' : 'note_added', subjectId, now) });
      const subject = s.babies.some((b) => b.id === subjectId) ? { baby_id: subjectId } : { pregnancy_id: subjectId };
      enqueue('add_note', { id, ...subject, body, at: now.toISOString() }, { entityId: id });
    },

    addNewbornObs: (obs) => {
      const s = get();
      const id = uid('nb');
      set({ newbornObs: [...s.newbornObs, { ...obs, id }], audit: audit(s, obs.by, 'newborn_observation', obs.babyId, obs.at) });
      useNetwork.getState().markPending(id);
      const rows = [
        obs.weightG !== undefined && { code: 'nb_weight', value_num: obs.weightG },
        obs.tempC !== undefined && { code: 'nb_temp', value_num: obs.tempC },
        obs.respRate !== undefined && { code: 'nb_resp_rate', value_num: obs.respRate },
        obs.feeding && { code: 'nb_feeding', value_text: obs.feeding },
        obs.jaundice && { code: 'nb_jaundice', value_text: obs.jaundice },
        obs.lengthCm !== undefined && { code: 'nb_length', value_num: obs.lengthCm },
        obs.headCircCm !== undefined && { code: 'nb_head_circ', value_num: obs.headCircCm },
      ].filter(Boolean);
      enqueue(
        'add_newborn_obs',
        { encounter_id: id, baby_id: obs.babyId, at: obs.at.toISOString(), observations: rows, note: obs.note?.trim() || undefined },
        { entityId: id },
      );
    },

    logDose: (d) => {
      const s = get();
      const medicationId = d.medicationId ?? s.prescriptions.find((p) => p.motherId === d.motherId && p.name === d.med)?.id;
      if (isRemote && !medicationId) return refuse('log_dose', 'Only medicines your doctor prescribed can be logged.');
      set({
        medDoses: [...s.medDoses.filter((x) => !(x.motherId === d.motherId && x.med === d.med && x.date === d.date && x.slot === d.slot)), { ...d, medicationId, id: uid('md') }],
      });
      enqueue('log_dose', { medication_id: medicationId, mother_id: d.motherId, date: d.date, slot: d.slot, status: d.status, at: d.at.toISOString() });
    },

    saveCapture: (doc, now) => {
      const s = get();
      const mapped = captureVisit(doc.fields);
      const visit: Visit = {
        id: uid('vs'),
        pregnancyId: asPregnancyId(doc.subjectId),
        at: now,
        by: `${doc.by} (from paper record)`,
        vitals: mapped.vitals,
        checklist: Object.fromEntries(mapped.components.map((c) => [c, { state: 'done' as const }])),
        complaints: [],
        note: 'Transcribed from paper record — each field confirmed by clinician',
      };
      const { documentId, ...rest } = doc;
      const cap: CaptureDoc = { ...rest, id: documentId ?? uid('cp'), visitId: visit.id };
      set({ visits: [...s.visits, visit], captures: [...s.captures, cap], audit: audit(s, doc.by, `capture_confirmed (${doc.fields.filter((f) => f.confirmed).length} fields)`, doc.subjectId, now) });
      // 1. open the capture: the server chooses the photo's path, and the outbox uploads the photo there;
      // 2. confirm: the checked transcription is kept on the document and ONLY confirmed fields become an ANC visit.
      const mime = doc.uri ? photoMime(doc.uri) : undefined;
      if (!documentId) enqueue(
        'create_document',
        { id: cap.id, pregnancy_id: doc.subjectId, kind: 'anc_card', mime },
        { entityId: cap.id, upload: doc.uri && mime ? { bucket: 'documents', pathFrom: 'storage_path', localUri: doc.uri, contentType: mime } : undefined },
      );
      enqueue(
        'confirm_capture',
        {
          document_id: cap.id,
          encounter_id: visit.id,
          at: now.toISOString(),
          fields: doc.fields.map((f) => ({ key: f.key, label: f.label, value: f.value, confidence: f.confidence, confirmed: f.confirmed })),
          observations: observationRows(visit.vitals),
          checklist: mapped.components.map((component) => ({ component, state: 'done' })),
        },
        { entityId: visit.id },
      );
      return visit.id;
    },

    importRegister: (rows, by, now) => {
      // Supabase mode never imports optimistically: the server answers row by row (src/data/registration.ts).
      if (isRemote) throw new Error('Register import is sent with importRows (src/data/registration.ts)');
      const done = rows.map((r) => registerLocal(r, by, now));
      const s = get();
      set({ audit: audit(s, by, `import_register (${done.length} rows)`, 'register.csv', now) });
      return done.map((d) => d.id);
    },

    prescribe: (subject, input, by, now) => {
      const s = get();
      const motherId = subject.babyId ? s.babies.find((b) => b.id === subject.babyId)?.motherId : s.pregnancies.find((p) => p.id === subject.pregnancyId)?.motherId;
      if (!motherId) return '';
      const id = uid('rx');
      const payload = prescribePayload(id, subject, input, now);
      const rx: Prescription = { id, motherId, pregnancyId: subject.pregnancyId, babyId: subject.babyId, name: payload.name, dose: payload.dose, slots: payload.slots, instructions: payload.instructions };
      set({ prescriptions: [...s.prescriptions, rx], audit: audit(s, by, 'prescribe', subject.babyId ?? subject.pregnancyId ?? '', now) });
      useNetwork.getState().markPending(id);
      enqueue('prescribe', payload, { entityId: id });
      return id;
    },

    stopMedication: (id, reason, by, now) => {
      const s = get();
      set({ prescriptions: s.prescriptions.filter((p) => p.id !== id), audit: audit(s, by, 'stop_medication', id, now) });
      enqueue('stop_medication', { id, reason: reason.trim() }, { entityId: id, withVersion: true });
    },

    redatePregnancy: (pregnancyId, input, by, now) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId);
      if (!p) return;
      const edd = eddFor(input);
      const updated: Pregnancy = { ...p, edd, eddSource: input.method, lmp: input.method === 'lmp' ? input.lmp : undefined };
      const pregnancies = s.pregnancies.map((x) => (x.id === p.id ? updated : x));
      if (!p.edd) {
        // First dating of a pregnancy registered without one: plan what registration used to plan — the ANC visits
        // and the test windows from today (server: redate_pregnancy, audited 'record_dating').
        const rhNegative = isRhNegative(p.history.bloodGroup, s.tags.filter((t) => t.subjectId === p.id && !t.removedAt).map((t) => t.code));
        const plan = datingPlan(p.id, edd, p.intensity, rhNegative, now);
        set({
          pregnancies,
          tasks: [...s.tasks, ...plan.tasks],
          investigations: [...s.investigations, ...plan.investigations],
          audit: audit(s, by, `record_dating (${input.method}) → EDD ${isoDay(edd)}`, p.mchId, now),
        });
        enqueue('redate_pregnancy', redatePayload(p.id, input, { cancelled: [], tasks: plan.tasks, investigations: plan.investigations }, now), {
          entityId: p.id,
          withVersion: true,
        });
        return;
      }
      // Re-dating: the same re-plan as a change of intensity, from the last visit if recent, else from today.
      const lastVisit = s.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      const from = lastVisit && lastVisit.at.getTime() > addDays(now, -28).getTime() ? lastVisit.at : now;
      const plan = regenerateAnc({ ...s, pregnancies }, updated, from);
      set({ pregnancies, tasks: plan.tasks, audit: audit(s, by, `redate (${input.method}) → EDD ${isoDay(edd)}`, p.mchId, now) });
      enqueue('redate_pregnancy', redatePayload(p.id, input, { cancelled: plan.cancelled.map((t) => t.id), tasks: plan.fresh }, now), {
        entityId: p.id,
        withVersion: true,
      });
    },

    endPregnancy: (pregnancyId, reason, note, endedOn, by, now) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId);
      if (!p) return;
      const why = `Pregnancy ended (${reason})`;
      set({
        pregnancies: s.pregnancies.map((x) => (x.id === p.id ? { ...x, status: 'closed', endReason: reason, endedOn: reason === 'delivered' ? x.endedOn : (endedOn ?? now) } : x)),
        tasks: s.tasks.map((t) => (t.subjectId === p.id && !t.completedAt && !t.cancelledAt ? { ...t, cancelledAt: now, overrideReason: why } : t)),
        investigations: s.investigations.map((i) => (i.subjectId === p.id && (i.status === 'due' || i.status === 'ordered') ? { ...i, status: 'not_done', notDoneReason: why } : i)),
        prescriptions: s.prescriptions.filter((x) => x.pregnancyId !== p.id),
        audit: audit(s, by, `end_pregnancy (${reason})`, p.mchId, now),
      });
      enqueue(
        'end_pregnancy',
        { pregnancy_id: p.id, reason, ended_on: reason === 'delivered' ? undefined : isoDay(endedOn ?? now), note: note?.trim() || undefined },
        { entityId: p.id, withVersion: true },
      );
    },

    endAdmission: (pregnancyId, by, at) => {
      const p = get().pregnancies.find((x) => x.id === pregnancyId);
      if (!p) return;
      if (isRemote && !p.admissionId) return refuse('end_admission', 'The admission is still being saved — try again in a moment.');
      set((s) => ({
        pregnancies: s.pregnancies.map((x) => (x.id === p.id ? { ...x, status: 'active', admissionId: undefined, admittedAt: undefined, admissionReason: undefined } : x)),
        audit: audit(s, by, 'end_admission', p.mchId, at),
      }));
      if (p.admissionId) enqueue('end_admission', { admission_id: p.admissionId, at: at.toISOString() }, { entityId: p.admissionId });
    },

    recordBabyDeath: (babyId, at, note, by) => {
      const s = get();
      const why = 'Baby died';
      set({
        babies: s.babies.map((b) => (b.id === babyId ? { ...b, deceasedAt: at } : b)),
        tasks: s.tasks.map((t) => (t.subjectId === babyId && !t.completedAt && !t.cancelledAt ? { ...t, cancelledAt: at, overrideReason: why } : t)),
        // Doses still due are closed as not given (as the server does); given doses stay on record.
        immunizations: s.immunizations.map((i) => (i.babyId === babyId && !i.givenOn && i.notGivenReason === undefined ? { ...i, notGivenReason: why } : i)),
        investigations: s.investigations.map((i) => (i.subjectId === babyId && (i.status === 'due' || i.status === 'ordered') ? { ...i, status: 'not_done', notDoneReason: why } : i)),
        prescriptions: s.prescriptions.filter((x) => x.babyId !== babyId),
        audit: audit(s, by, 'baby_death_recorded', babyId, at),
      });
      enqueue('record_baby_death', { baby_id: babyId, at: at.toISOString(), note: note?.trim() || undefined }, { entityId: babyId, withVersion: true });
    },

    markEnteredInError: (kind, id, reason, by, now) => {
      if (kind === 'immunization' && isUnsavedDose(id)) return refuse('mark_entered_in_error', DOSE_WAIT_MESSAGE);
      const s = get();
      const next: Partial<DbState> = { audit: audit(s, by, `entered_in_error (${kind})`, id, now) };
      // Rows whose server version this correction also bumps: their cached versions are dropped once it is saved.
      let alsoInvalidate: string[] | undefined;
      switch (kind) {
        case 'encounter':
          next.visits = s.visits.filter((v) => v.id !== id);
          next.newbornObs = s.newbornObs.filter((o) => o.id !== id);
          break;
        case 'investigation_result':
          // Withdrawing the shown result sends the test back to waiting for one (the server does the same, and bumps
          // the test's version: trigger reset_test_without_results).
          alsoInvalidate = s.investigations.filter((i) => i.resultId === id).map((i) => i.id);
          next.investigations = s.investigations.map((i) =>
            i.resultId === id ? { ...i, status: i.orderedAt ? 'ordered' : 'due', result: undefined, resultId: undefined, review: undefined } : i,
          );
          break;
        case 'care_note':
          next.notes = s.notes.filter((n) => n.id !== id);
          break;
        case 'self_log':
          next.selfLogs = s.selfLogs.filter((l) => l.id !== id);
          break;
        case 'immunization': {
          // The dose comes back as due under a new id, named for the server so it can be recorded again at once.
          const replacementId = uid('im');
          const dose = s.immunizations.find((i) => i.id === id);
          const baby = s.babies.find((b) => b.id === dose?.babyId);
          const gone = !!baby && (baby.outcome !== 'live' || !!baby.deceasedAt);
          next.immunizations = s.immunizations.map((i) => (i.id === id ? { ...i, id: replacementId, givenOn: undefined, given: undefined, notGivenReason: gone ? 'Baby died' : undefined } : i));
          set(next);
          enqueue('mark_entered_in_error', { ...eiePayload(kind, id, reason, now), replacement_id: replacementId }, { entityId: id });
          return;
        }
        default: {
          const fact = s.facts.find((f) => f.id === id);
          next.facts = s.facts.filter((f) => f.id !== id);
          if (fact) next.pregnancies = s.pregnancies.map((p) => (p.motherId === fact.motherId ? withoutFact(p, fact) : p));
        }
      }
      set(next);
      enqueue('mark_entered_in_error', eiePayload(kind, id, reason, now), { entityId: id, alsoInvalidate });
    },

    shareResult: (referralId, investigationId, by, now) => {
      const s = get();
      if (s.sharedResults.some((x) => x.referralId === referralId && x.investigationId === investigationId)) return;
      set({ sharedResults: [...s.sharedResults, { referralId, investigationId }], audit: audit(s, by, 'result_shared', referralId, now) });
      enqueue('share_result', { referral_id: referralId, investigation_id: investigationId }, { entityId: referralId });
    },

    updateCaregiver: (id, scopes, by, now) => {
      const s = get();
      set({ caregivers: s.caregivers.map((c) => (c.id === id ? { ...c, scopes } : c)), audit: audit(s, by, 'caregiver_scopes_changed', id, now) });
      enqueue('update_caregiver', { id, scopes: caregiverScopesPayload(scopes) }, { entityId: id, withVersion: true });
    },

    markNotificationsRead: (ids, now) => {
      const s = get();
      const unread = s.notifications.filter((n) => !n.readAt && (ids === 'all' || ids.includes(n.id)));
      if (!unread.length) return;
      const marked = new Set(unread.map((n) => n.id));
      set({ notifications: s.notifications.map((n) => (marked.has(n.id) ? { ...n, readAt: now } : n)) });
      enqueue('mark_notifications_read', notificationsReadPayload(ids === 'all' ? 'all' : [...marked]));
    },

    grantOverrideLocal: (mchId, reason, now) => {
      const s = get();
      const p = s.pregnancies.filter((x) => x.mchId === mchId).sort((a, b) => b.registeredOn.getTime() - a.registeredOn.getTime())[0];
      if (!p) return undefined;
      const o: AccessOverride = { id: uid('ov'), motherId: p.motherId, reason: reason.trim(), grantedAt: now, expiresAt: new Date(now.getTime() + 24 * 3_600_000) };
      set({ overrides: [...s.overrides, o], audit: audit(s, useSession.getState().account?.name ?? 'Care Team', 'override_granted', p.mchId, now) });
      return { motherId: p.motherId, pregnancyId: p.id };
    },

    endOverride: (id, by, now) => {
      const s = get();
      set({ overrides: s.overrides.filter((o) => o.id !== id), audit: audit(s, by, 'override_ended', id, now) });
      enqueue('end_override', { override_id: id }, { entityId: id });
    },
  };
});

/** A pregnancy's history without one documented fact (it was entered in error). */
function withoutFact(p: Pregnancy, fact: DocumentedFact): Pregnancy {
  const dropFirst = (xs: string[]) => {
    const i = xs.indexOf(fact.label);
    return i < 0 ? xs : [...xs.slice(0, i), ...xs.slice(i + 1)];
  };
  return {
    ...p,
    history: {
      ...p.history,
      conditions: fact.kind === 'condition' ? dropFirst(p.history.conditions) : p.history.conditions,
      allergies: fact.kind === 'allergy' ? dropFirst(p.history.allergies) : p.history.allergies,
    },
    previous: fact.kind === 'previous_pregnancy' ? p.previous.filter((x) => x.id !== fact.id) : p.previous,
  };
}

export type { ChecklistState };
