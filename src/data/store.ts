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
import { addDays, daysBetween, gestationalAge, toDateOnly } from '@domain/gestation';
import { POSTNATAL_STANDARD, TAG_TEMPLATES, ancVisitDates, investigationWindows, vaccineSchedule, type Intensity } from '@domain/schedules';

import { DISCHARGE_BABY, DISCHARGE_MOTHER, TAGS } from './catalogue';
import {
  callbackOutcomeCodes,
  complicationCodes,
  contactOutcomeCodes,
  contactSuccessful,
  deliveryModeCodes,
  followUpCodes,
  labourMedicineCodes,
  previousModeCodes,
  previousOutcomeCodes,
  signLabel,
  splitComplaints,
} from './codes';
import { enqueue, useOutbox } from './outbox';
import { e164, emptyState, isoDay } from './remote';
import { useNetwork } from '@/lib/network';
import { isRemote } from '@/lib/supabase';
import { useSession } from '@/state/session';

import type { IdKind, IdOf } from './ids';
import { buildSeed } from './seed';
import type { CardField } from './catalogue';
import type {
  AuditEntry,
  BabyId,
  CallbackId,
  CaptureDoc,
  CaregiverId,
  Caregiver,
  MedDose,
  NewbornObs,
  Note,
  Baby,
  Callback,
  ChecklistState,
  Delivery,
  Discharge,
  Id,
  Immunization,
  ImmunizationId,
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
  SelfLogId,
  StaffId,
  StaffMember,
  SubjectId,
  Tag,
  Task,
  TaskId,
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
  /** Hospital departments and units (referral destinations). */
  teams: TeamRef[];
  prescriptions: Prescription[];
  mchSeq: number;
};

/** A new record id, typed by its kind. UUIDs, so an id made on the phone is the id the server stores. */
export function uid<K extends IdKind>(kind: K): IdOf[K];
export function uid(kind?: string): Id;
export function uid(_kind?: string): Id {
  return randomUUID();
}

export type RegisterInput = {
  mother: Omit<Mother, 'id'>;
  lmp?: Date;
  edd: Date;
  eddSource: Pregnancy['eddSource'];
  gpla: Pregnancy['gpla'];
  history: Pregnancy['history'];
  previous: Pregnancy['previous'];
  tagCodes: string[];
  intensity: Intensity;
};

export type VisitInput = Omit<Visit, 'id' | 'pregnancyId' | 'at' | 'by'> & { nextVisitOn: Date };

export type BabyInput = { sex: 'F' | 'M'; birthWeightG: number; apgar1?: number; apgar5?: number; outcome: 'live' | 'stillbirth'; birthDoses: boolean };

export type DeliveryInput = {
  at: Date;
  mode: string;
  indication?: string;
  bloodLossMl?: number;
  complications: string[];
  medicines: string[];
  babies: BabyInput[];
};

type Actions = {
  reset: (now: Date) => void;
  /** Replace the whole state with the server's (Supabase mode). */
  hydrate: (state: DbState) => void;
  registerPregnancy: (input: RegisterInput, by: string, now: Date) => PregnancyId;
  recordVisit: (pregnancyId: PregnancyId, input: VisitInput, by: string, at: Date) => VisitId;
  setTags: (subjectId: SubjectId, codes: string[], note: string | undefined, by: string, now: Date) => void;
  setIntensity: (subjectId: SubjectId, intensity: Intensity, by: string, now: Date) => void;
  assignDoctor: (pregnancyId: PregnancyId, doctor: { name: string; staffId?: StaffId }, reason: string, by: string, now: Date) => void;
  orderInvestigation: (id: InvestigationId, by: string, now: Date) => void;
  enterResult: (id: InvestigationId, value: string, unit: string | undefined, note: string | undefined, by: string, now: Date) => void;
  reviewResult: (id: InvestigationId, followUp: string, by: string, now: Date) => void;
  markNotDone: (id: InvestigationId, reason: string, by: string, now: Date) => void;
  createReferral: (r: Pick<Referral, 'pregnancyId' | 'department' | 'urgency' | 'reason' | 'question'>, by: string, now: Date) => ReferralId;
  advanceReferral: (id: ReferralId, to: ReferralStatus, data: { scheduledAt?: Date; place?: string; recommendations?: string; note?: string }, by: string, now: Date) => void;
  /** `signs` are warning-sign codes (catalogue WARNING_SIGNS keys); the record shows their English labels. */
  requestCallback: (motherId: MotherId, signs: string[], note: string | undefined, requestedBy: string, channel: Callback['channel'], now: Date, voice?: { uri: string; seconds: number }) => CallbackId;
  logAccess: (subjectId: SubjectId, actor: string, now: Date) => void;
  closeCallback: (id: CallbackId, outcome: string, note: string | undefined, by: string, now: Date) => void;
  logContact: (taskId: TaskId, outcome: string, by: string, now: Date) => void;
  rescheduleTask: (taskId: TaskId, dueBy: Date, reason: string, by: string, now: Date) => void;
  cancelTask: (taskId: TaskId, reason: string, by: string, now: Date) => void;
  addSelfLog: (log: Omit<SelfLog, 'id'>) => SelfLogId;
  admit: (pregnancyId: PregnancyId, by: string, now: Date) => void;
  recordDelivery: (pregnancyId: PregnancyId, input: DeliveryInput, by: string) => BabyId[];
  setDischargeItem: (subjectId: SubjectId, key: string, state: 'done' | 'na' | 'deferred' | undefined, reason: string | undefined) => void;
  completeDischarge: (subjectId: SubjectId, by: string, now: Date) => void;
  recordVaccine: (immunizationId: ImmunizationId, givenOn: Date, by: string) => void;
  addCaregiver: (c: Omit<Caregiver, 'id' | 'addedAt'>, now: Date) => void;
  revokeCaregiver: (id: CaregiverId, by: string, now: Date) => void;
  setCardFields: (motherId: MotherId, fields: CardField[]) => void;
  addNote: (subjectId: SubjectId, body: string, author: string, kind: Note['kind'], now: Date) => void;
  addNewbornObs: (obs: Omit<NewbornObs, 'id'>) => void;
  logDose: (d: Omit<MedDose, 'id'>) => void;
  saveCapture: (doc: Omit<CaptureDoc, 'id' | 'visitId'>, now: Date) => VisitId;
  importRegister: (rows: RegisterInput[], by: string, now: Date) => PregnancyId[];
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

// ── ANC plan ────────────────────────────────────────────────────────────────────

type Replan = { tasks: Task[]; cancelled: Task[]; fresh: Task[] };

/** Cancel open future ANC visits and plan new ones from `from` using the pregnancy's intensity. */
function regenerateAnc(s: DbState, p: Pregnancy, from: Date, firstOn?: Date): Replan {
  const isFutureOpen = (t: Task) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() > from.getTime();
  const cancelled = s.tasks.filter(isFutureOpen);
  const kept = s.tasks.filter((t) => !isFutureOpen(t));
  const start = firstOn ?? from;
  const dates = [...(firstOn ? [firstOn] : []), ...ancVisitDates(p.edd, p.intensity, start)];
  const fresh: Task[] = dates.map((d) => ({
    id: uid('tk'),
    kind: 'anc_visit',
    subjectType: 'pregnancy',
    subjectId: p.id,
    title: `ANC visit · ${gestationalAge(p.edd, d).weeks} weeks`,
    dueFrom: addDays(d, -2),
    dueBy: d,
    generatedBy: 'protocol',
    contactAttempts: [],
  }));
  return { tasks: [...kept, ...fresh], cancelled, fresh };
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
];

function observationRows(vitals: Visit['vitals']) {
  return VITAL_CODES.flatMap(([k, code]) => {
    const v = vitals[k];
    if (v === undefined || v === '') return [];
    return [typeof v === 'number' ? { code, value_num: v } : { code, value_text: v }];
  });
}

/** "11.2 g/dL" → a number and its unit; anything else is kept as text, exactly as entered. */
function resultValue(value: string, unit?: string) {
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s][^\d]*)?$/);
  return m ? { value_num: Number(m[1]), unit: unit ?? m[2]?.trim() } : { value_text: value.trim(), unit };
}

/** The signed-in obstetrician's own unit: where a newly registered pregnancy is cared for. */
function myObstetricUnit() {
  return useSession.getState().account?.care?.teams?.find((t) => t.kind === 'unit' && t.specialty === 'obstetrics')?.id;
}

function registerPayload(input: RegisterInput, p: Pregnancy, motherId: MotherId, inv: Investigation[], tasks: Task[], now: Date) {
  const m = input.mother;
  const ec = m.emergencyContact;
  const scanDays = 280 - daysBetween(now, input.edd);
  const dating =
    input.eddSource === 'lmp' && input.lmp
      ? { method: 'lmp', lmp: isoDay(input.lmp), edd: isoDay(input.edd) }
      : input.eddSource === 'scan' && scanDays >= 28 && scanDays <= 300
        ? { method: 'scan', scan_on: isoDay(now), ga_at_scan_days: scanDays, lmp: input.lmp && isoDay(input.lmp), edd: isoDay(input.edd) }
        : { method: 'clinician', edd: isoDay(input.edd) };
  return {
    mother: {
      id: motherId,
      phone: e164(m.phone),
      name: m.name,
      age: m.age,
      lang: m.lang,
      village: m.village && m.village !== '—' ? m.village : undefined,
      emergency_contact: /^[6-9]\d{9}$/.test(ec.phone) ? { name: ec.name, relation: ec.relation, phone: e164(ec.phone) } : undefined,
    },
    pregnancy: { id: p.id, registered_on: now.toISOString(), gravida: p.gpla.g, para: p.gpla.p, living: p.gpla.l, abortions: p.gpla.a },
    dating,
    history: {
      conditions: input.history.conditions,
      allergies: input.history.allergies,
      medicines: input.history.medicines,
      blood_group: input.history.bloodGroup,
      height_cm: input.history.heightCm,
      previous: input.previous.map((x) => ({
        year: x.year,
        outcome: previousOutcomeCodes.code(x.outcome) ?? 'live_birth',
        mode: x.mode ? previousModeCodes.code(x.mode) : undefined,
        note: x.note,
      })),
    },
    team_id: myObstetricUnit(),
    intensity: input.intensity,
    tags: input.tagCodes,
    investigations: inv.map((i) => ({ id: i.id, code: i.code, due_from: isoDay(i.dueFrom), due_by: isoDay(i.dueBy), late: i.late })),
    tasks: taskRows(tasks),
    ga_days: gestationalAge(input.edd, now).totalDays,
  };
}

const initial = (): DbState => (isRemote ? emptyState() : buildSeed(new Date()));

export const useDb = create<Db>()((set, get) => {
  /** Registration on the phone; returns the RPC payload so a register import can send all rows in one call. */
  function registerLocal(input: RegisterInput, by: string, now: Date) {
    const s = get();
    const motherId = uid('mo');
    const seq = s.mchSeq + 1;
    const p: Pregnancy = {
      id: uid('pg'),
      // In Supabase mode the server assigns the MCH id; it appears once the record is saved.
      mchId: isRemote ? 'MCH id pending' : `MCH-${now.getFullYear()}-${String(seq).padStart(6, '0')}`,
      motherId,
      registeredOn: now,
      lmp: input.lmp,
      edd: input.edd,
      eddSource: input.eddSource,
      gpla: input.gpla,
      status: 'active',
      intensity: input.intensity,
      history: input.history,
      previous: input.previous,
    };
    const rhNegative = /-|neg/i.test(input.history.bloodGroup ?? '') || input.tagCodes.includes('rh_neg');
    const inv: Investigation[] = investigationWindows(p.edd, now, { rhNegative }).map((w) => ({ id: uid('iv'), subjectId: p.id, status: 'due', ...w }));
    const tags: Tag[] = input.tagCodes.map((code) => ({ id: uid('tg'), subjectId: p.id, code, setBy: by, setAt: now }));
    const ipNo = isRemote ? undefined : (input.mother.ipNo ?? `IP-${now.getFullYear()}-${String(seq).padStart(6, '0')}`);
    const base: DbState = { ...s, mothers: [...s.mothers, { id: motherId, ...input.mother, ipNo }], pregnancies: [...s.pregnancies, p], mchSeq: seq };
    const plan = regenerateAnc(base, p, now);
    set({
      mothers: base.mothers,
      pregnancies: base.pregnancies,
      mchSeq: seq,
      tags: [...s.tags, ...tags],
      investigations: [...s.investigations, ...inv],
      tasks: plan.tasks,
      audit: audit(s, by, 'register_pregnancy', p.mchId, now),
    });
    return { id: p.id, payload: registerPayload(input, p, motherId, inv, plan.fresh, now) };
  }

  return {
    ...initial(),

    reset: (now) => {
      if (!isRemote) return set(buildSeed(now));
      enqueue('reset_demo', { confirm: 'RESET DEMO DATA' });
    },

    hydrate: (state) => set(state),

    registerPregnancy: (input, by, now) => {
      const { id, payload } = registerLocal(input, by, now);
      enqueue('register_pregnancy', payload, { entityId: id });
      return id;
    },

    recordVisit: (pregnancyId, input, by, at) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId)!;
      const visit: Visit = { id: uid('vs'), pregnancyId, at, by, vitals: input.vitals, checklist: input.checklist, complaints: input.complaints, note: input.note };
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
          ga_days: gestationalAge(p.edd, at).totalDays,
          observations: observationRows(input.vitals),
          checklist: Object.entries(input.checklist).map(([component, c]) => ({ component, state: c.state, reason: c.reason })),
          complaints: codes,
          complaints_note: complaintsNote,
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

    setTags: (subjectId, codes, note, by, now) => {
      const s = get();
      const active = s.tags.filter((t) => t.subjectId === subjectId && !t.removedAt);
      const removed = active.filter((t) => !codes.includes(t.code)).map((t) => t.id);
      const added = codes
        .filter((c) => !active.some((t) => t.code === c))
        .map((code): Tag => ({ id: uid('tg'), subjectId, code, note, setBy: by, setAt: now }));
      set({
        tags: [...s.tags.map((t) => (removed.includes(t.id) ? { ...t, removedAt: now, removedReason: note } : t)), ...added],
        audit: audit(s, by, `tags ${added.map((a) => '+' + a.code).join(' ')} ${removed.length ? `−${removed.length}` : ''}`.trim(), subjectId, now),
      });
      if (!added.length && !removed.length) return;
      const subject = s.babies.some((b) => b.id === subjectId) ? { baby_id: subjectId } : { pregnancy_id: subjectId };
      enqueue('set_tags', { ...subject, codes, note: added.length ? note : undefined, removal_reason: removed.length ? note : undefined, at: now.toISOString() }, { entityId: subjectId });
    },

    setIntensity: (subjectId, intensity, by, now) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === subjectId);
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

    assignDoctor: (pregnancyId, doctor, reason, by, now) => {
      const s = get();
      set({
        pregnancies: s.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, assignedDoctor: { name: doctor.name } } : p)),
        audit: audit(s, by, `assign_doctor (${doctor.name})`, pregnancyId, now),
      });
      enqueue('assign_care', { pregnancy_id: pregnancyId, specialty: 'obstetrics', primary_staff_id: doctor.staffId, reason, at: now.toISOString() }, { entityId: pregnancyId });
    },

    orderInvestigation: (id, by, now) => {
      const s = get();
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'ordered', orderedAt: now } : i)), audit: audit(s, by, 'order_investigation', id, now) });
      enqueue('update_investigation', { id, action: 'order', at: now.toISOString() }, { entityId: id, withVersion: true });
    },

    enterResult: (id, value, unit, note, by, now) => {
      const s = get();
      set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'resulted', result: { value, unit, note, at: now } } : i)), audit: audit(s, by, 'enter_result', id, now) });
      enqueue('record_result', { id: uid('rs'), investigation_id: id, ...resultValue(value, unit), reported_at: now.toISOString(), note }, { entityId: id, withVersion: true });
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
      const ref: Referral = { ...r, id: uid('rf'), status: 'requested', events: [{ status: 'requested', at: now, by }], createdBy: by };
      set({ referrals: [...s.referrals, ref], audit: audit(s, by, `referral → ${r.department}`, r.pregnancyId, now) });
      const team = s.teams.find((t) => t.kind === 'department' && t.name === r.department);
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
      if (to === 'seen') tasks = tasks.map((t) => (t.refId === id && !t.completedAt ? { ...t, completedAt: now } : t));
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
      // Voice notes stay on the phone until upload to Storage is built; the team is told one exists.
      const voiceLine = voice ? `Voice note recorded (${voice.seconds} s) — kept on the family's phone` : undefined;
      enqueue('request_callback', { id: cb.id, mother_id: motherId, signs, note: [note, voiceLine].filter(Boolean).join('\n') || undefined, at: now.toISOString() }, { entityId: cb.id });
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
      const recent = s.audit.find((a) => a.action === 'view_record' && a.entity === subjectId && a.actor === actor && now.getTime() - a.at.getTime() < 600_000);
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

    admit: (pregnancyId, by, now) => {
      const s = get();
      set({ pregnancies: s.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, status: 'admitted' } : p)), audit: audit(s, by, 'admit', pregnancyId, now) });
      enqueue('admit', { id: uid('ad'), pregnancy_id: pregnancyId, at: now.toISOString() }, { entityId: pregnancyId });
    },

    recordDelivery: (pregnancyId, input, by) => {
      const s = get();
      const p = s.pregnancies.find((x) => x.id === pregnancyId)!;
      const gaDays = gestationalAge(p.edd, input.at).totalDays;
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
      }));
      const delivery: Delivery = { id: uid('dl'), pregnancyId, at: input.at, mode: input.mode, indication: input.indication, bloodLossMl: input.bloodLossMl, complications: input.complications, medicines: input.medicines, babyIds: babies.map((b) => b.id) };
      const immunizations: Immunization[] = babies
        .filter((b) => b.outcome === 'live')
        .flatMap((b, i) =>
          vaccineSchedule(b.dob).map((v) => ({ id: uid('im'), babyId: b.id, ...v, givenOn: v.group === 'Birth' && input.babies[i]?.birthDoses ? input.at : undefined })),
        );
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
      const comp = coded(input.complications, complicationCodes);
      const meds = coded(input.medicines, labourMedicineCodes);
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
            complications: comp.codes,
            complications_note: comp.other,
            medicines: meds.codes,
            medicines_note: meds.other,
          },
          babies: input.babies.map((b, i) => ({
            id: babies[i]!.id,
            sex: b.sex,
            birth_weight_g: b.birthWeightG,
            apgar1: b.apgar1,
            apgar5: b.apgar5,
            outcome: b.outcome,
            birth_doses_given: b.birthDoses,
          })),
        },
        { entityId: delivery.id },
      );
      return babies.map((b) => b.id);
    },

    setDischargeItem: (subjectId, key, state, reason) => {
      const d = get().discharges.find((x) => x.subjectId === subjectId);
      if (isRemote && !d?.id) return refuse('set_discharge_item', 'The delivery is still being saved — try again in a moment.');
      set((s) => ({
        discharges: s.discharges.map((x) => (x.subjectId === subjectId ? { ...x, items: x.items.map((i) => (i.key === key ? { ...i, state, reason } : i)) } : x)),
      }));
      if (d?.id) enqueue('set_discharge_item', { discharge_id: d.id, key, state: state ?? null, reason }, { entityId: d.id });
    },

    completeDischarge: (subjectId, by, now) => {
      const s = get();
      const d = s.discharges.find((x) => x.subjectId === subjectId)!;
      if (isRemote && !d.id) return refuse('complete_discharge', 'The delivery is still being saved — try again in a moment.');
      const isBaby = d.subject === 'baby';
      const tagCodes = s.tags.filter((t) => t.subjectId === subjectId && !t.removedAt).map((t) => t.code);
      const templates = [
        ...POSTNATAL_STANDARD.filter((f) => f.subject === (isBaby ? 'baby' : 'mother')),
        ...tagCodes.flatMap((c) => {
          const tpl = TAGS.find((t) => t.code === c)?.template;
          return tpl ? (TAG_TEMPLATES[tpl] ?? []) : [];
        }),
      ];
      const origin = isBaby ? s.babies.find((b) => b.id === subjectId)!.dob : (s.deliveries.find((x) => x.pregnancyId === subjectId)?.at ?? now);
      // A follow-up whose window has already closed by discharge cannot be planned.
      const today = toDateOnly(now).getTime();
      const tasks: (Task & { templateKey?: string })[] = templates
        .filter((f) => addDays(origin, f.dayTo).getTime() >= today)
        .map((f) => ({
          id: uid('tk'),
          kind: f.key.startsWith('tpl') ? 'template' : isBaby ? 'nb_visit' : 'pn_visit',
          subjectType: isBaby ? 'baby' : 'pregnancy',
          subjectId,
          title: f.label,
          dueFrom: addDays(origin, f.dayFrom),
          dueBy: addDays(origin, f.dayTo),
          generatedBy: f.key.startsWith('tpl') ? 'template' : 'protocol',
          contactAttempts: [],
          templateKey: f.key.startsWith('tpl') ? f.key : undefined,
        }));
      set({
        discharges: s.discharges.map((x) => (x.subjectId === subjectId ? { ...x, completedAt: now, completedBy: by } : x)),
        tasks: [...s.tasks, ...tasks.map(({ templateKey: _k, ...t }) => t)],
        audit: audit(s, by, `complete_discharge (+${tasks.length} follow-ups)`, subjectId, now),
      });
      if (d.id) {
        enqueue(
          'complete_discharge',
          { discharge_id: d.id, follow_up_tasks: tasks.map((t) => ({ ...taskRows([t])[0], template_key: t.templateKey })), at: now.toISOString() },
          { entityId: d.id, withVersion: true },
        );
      }
    },

    recordVaccine: (immunizationId, givenOn, by) => {
      const s = get();
      set({ immunizations: s.immunizations.map((i) => (i.id === immunizationId ? { ...i, givenOn } : i)), audit: audit(s, by, 'record_vaccine', immunizationId, givenOn) });
      enqueue('record_vaccine', { id: immunizationId, action: 'given', given_on: isoDay(givenOn), primary_source: true }, { entityId: immunizationId, withVersion: true });
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
      ].filter(Boolean);
      enqueue('add_newborn_obs', { encounter_id: id, baby_id: obs.babyId, at: obs.at.toISOString(), observations: rows }, { entityId: id });
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
      const val = (k: string) => doc.fields.find((f) => f.key === k && f.confirmed)?.value;
      const bp = val('bp')?.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      const visit: Visit = {
        id: uid('vs'),
        pregnancyId: doc.subjectId,
        at: now,
        by: `${doc.by} (from paper record)`,
        vitals: {
          weightKg: val('weight') ? Number(val('weight')!.replace(/[^\d.]/g, '')) : undefined,
          bpSys: bp ? Number(bp[1]) : undefined,
          bpDia: bp ? Number(bp[2]) : undefined,
          fhr: val('fhr') ? Number(val('fhr')!.replace(/[^\d]/g, '')) : undefined,
          urineAlbumin: val('albumin'),
        },
        checklist: Object.fromEntries(doc.fields.filter((f) => f.confirmed).map((f) => [f.key === 'albumin' ? 'urine_albumin' : f.key, { state: 'done' as const }])),
        complaints: [],
        note: 'Transcribed from paper record — each field confirmed by clinician',
      };
      const cap: CaptureDoc = { ...doc, id: uid('cp'), visitId: visit.id };
      set({ visits: [...s.visits, visit], captures: [...s.captures, cap], audit: audit(s, doc.by, `capture_confirmed (${doc.fields.filter((f) => f.confirmed).length} fields)`, doc.subjectId, now) });
      // Only clinician-confirmed fields are saved, as an ANC encounter (the photo itself stays on the phone until Storage, S2).
      const p = s.pregnancies.find((x) => x.id === doc.subjectId);
      const checklistKeys = new Set(['bp', 'weight', 'urine_albumin', 'fhr']);
      enqueue(
        'record_visit',
        {
          encounter_id: visit.id,
          pregnancy_id: doc.subjectId,
          at: now.toISOString(),
          ga_days: p ? gestationalAge(p.edd, now).totalDays : undefined,
          observations: observationRows(visit.vitals),
          checklist: Object.keys(visit.checklist).filter((k) => checklistKeys.has(k)).map((component) => ({ component, state: 'done' })),
          note: visit.note,
        },
        { entityId: visit.id },
      );
      return visit.id;
    },

    importRegister: (rows, by, now) => {
      const done = rows.map((r) => registerLocal(r, by, now));
      const s = get();
      set({ audit: audit(s, by, `import_register (${done.length} rows)`, 'register.csv', now) });
      enqueue('confirm_import', { file_name: 'register.csv', rows: done.map((d) => d.payload) });
      return done.map((d) => d.id);
    },
  };
});

export type { ChecklistState };
