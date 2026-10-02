/**
 * On-device demo backend (UI-first phase). Actions mirror the future Supabase RPCs
 * (PRD §16.1) so screens won't change when the backend lands. In-memory only;
 * "Reset demo data" reseeds. Synthetic data only.
 */
import { create } from 'zustand';
import { addDays, gestationalAge } from '@domain/gestation';
import { POSTNATAL_STANDARD, TAG_TEMPLATES, ancVisitDates, investigationWindows, vaccineSchedule, type Intensity } from '@domain/schedules';

import { DISCHARGE_BABY, DISCHARGE_MOTHER, TAGS } from './catalogue';
import { useNetwork } from '@/lib/network';

import { buildSeed } from './seed';
import type { CardField } from './catalogue';
import type {
  AuditEntry,
  CaptureDoc,
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
  Investigation,
  Mother,
  Pregnancy,
  Referral,
  ReferralStatus,
  SelfLog,
  Tag,
  Task,
  Visit,
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
  mchSeq: number;
};

let counter = 0;
export const uid = (p: string) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}`;

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
  registerPregnancy: (input: RegisterInput, by: string, now: Date) => Id;
  recordVisit: (pregnancyId: Id, input: VisitInput, by: string, at: Date) => Id;
  setTags: (subjectId: Id, codes: string[], note: string | undefined, by: string, now: Date) => void;
  setIntensity: (subjectId: Id, intensity: Intensity, by: string, now: Date) => void;
  assignDoctor: (pregnancyId: Id, doctor: { name: string; phone?: string }, by: string, now: Date) => void;
  orderInvestigation: (id: Id, by: string, now: Date) => void;
  enterResult: (id: Id, value: string, unit: string | undefined, note: string | undefined, by: string, now: Date) => void;
  reviewResult: (id: Id, followUp: string, by: string, now: Date) => void;
  markNotDone: (id: Id, reason: string, by: string, now: Date) => void;
  createReferral: (r: Pick<Referral, 'pregnancyId' | 'department' | 'urgency' | 'reason' | 'question'>, by: string, now: Date) => Id;
  advanceReferral: (id: Id, to: ReferralStatus, data: { scheduledAt?: Date; place?: string; recommendations?: string; note?: string }, by: string, now: Date) => void;
  requestCallback: (motherId: Id, signs: string[], note: string | undefined, requestedBy: string, channel: Callback['channel'], now: Date, voice?: { uri: string; seconds: number }) => Id;
  logAccess: (entity: string, actor: string, now: Date) => void;
  closeCallback: (id: Id, outcome: string, note: string | undefined, by: string, now: Date) => void;
  logContact: (taskId: Id, outcome: string, by: string, now: Date) => void;
  rescheduleTask: (taskId: Id, dueBy: Date, reason: string, by: string, now: Date) => void;
  cancelTask: (taskId: Id, reason: string, by: string, now: Date) => void;
  addSelfLog: (log: Omit<SelfLog, 'id'>) => Id;
  admit: (pregnancyId: Id, by: string, now: Date) => void;
  recordDelivery: (pregnancyId: Id, input: DeliveryInput, by: string) => Id[];
  setDischargeItem: (subjectId: Id, key: string, state: 'done' | 'na' | 'deferred' | undefined, reason: string | undefined) => void;
  completeDischarge: (subjectId: Id, by: string, now: Date) => void;
  recordVaccine: (immunizationId: Id, givenOn: Date, by: string) => void;
  addCaregiver: (c: Omit<Caregiver, 'id' | 'addedAt'>, now: Date) => void;
  revokeCaregiver: (id: Id, by: string, now: Date) => void;
  setCardFields: (motherId: Id, fields: CardField[]) => void;
  addNote: (subjectId: Id, body: string, author: string, kind: Note['kind'], now: Date) => void;
  addNewbornObs: (obs: Omit<NewbornObs, 'id'>) => void;
  logDose: (d: Omit<MedDose, 'id'>) => void;
  saveCapture: (doc: Omit<CaptureDoc, 'id' | 'visitId'>, now: Date) => Id;
  importRegister: (rows: RegisterInput[], by: string, now: Date) => Id[];
};

export type Db = DbState & Actions;

const audit = (s: DbState, actor: string, action: string, entity: string, at: Date): AuditEntry[] => [
  { id: uid('au'), at, actor, action, entity },
  ...s.audit,
];

/** Cancel open future ANC visits and regenerate from `from` using the pregnancy's intensity. */
function regenerateAnc(s: DbState, p: Pregnancy, from: Date, firstOn?: Date): Task[] {
  const kept = s.tasks.filter(
    (t) => !(t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() > from.getTime()),
  );
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
  return [...kept, ...fresh];
}

export const useDb = create<Db>()((set, get) => ({
  ...buildSeed(new Date()),

  reset: (now) => set(buildSeed(now)),

  registerPregnancy: (input, by, now) => {
    const s = get();
    const motherId = uid('mo');
    const seq = s.mchSeq + 1;
    const p: Pregnancy = {
      id: uid('pg'),
      mchId: `MCH-${now.getFullYear()}-${String(seq).padStart(6, '0')}`,
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
    const base: DbState = { ...s, mothers: [...s.mothers, { id: motherId, ...input.mother, ipNo: input.mother.ipNo ?? `IP-${now.getFullYear()}-${String(seq).padStart(6, '0')}` }], pregnancies: [...s.pregnancies, p], mchSeq: seq };
    set({
      mothers: base.mothers,
      pregnancies: base.pregnancies,
      mchSeq: seq,
      tags: [...s.tags, ...tags],
      investigations: [...s.investigations, ...inv],
      tasks: regenerateAnc(base, p, now),
      audit: audit(s, by, 'register_pregnancy', p.mchId, now),
    });
    return p.id;
  },

  recordVisit: (pregnancyId, input, by, at) => {
    const s = get();
    const p = s.pregnancies.find((x) => x.id === pregnancyId)!;
    const visit: Visit = { id: uid('vs'), pregnancyId, at, by, vitals: input.vitals, checklist: input.checklist, complaints: input.complaints, note: input.note };
    // Close the open ANC task nearest to this visit (within 14 days after its due date).
    const open = s.tasks
      .filter((t) => t.subjectId === pregnancyId && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() <= addDays(at, 14).getTime())
      .sort((a, b) => Math.abs(a.dueBy.getTime() - at.getTime()) - Math.abs(b.dueBy.getTime() - at.getTime()));
    let tasks = s.tasks.map((t) => (t.id === open[0]?.id ? { ...t, completedAt: at, refId: visit.id } : t));
    tasks = regenerateAnc({ ...s, tasks }, p, at, input.nextVisitOn);
    set({ visits: [...s.visits, visit], tasks, audit: audit(s, by, 'record_visit', p.mchId, at) });
    useNetwork.getState().markPending(visit.id);
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
  },

  setIntensity: (subjectId, intensity, by, now) => {
    const s = get();
    const p = s.pregnancies.find((x) => x.id === subjectId);
    if (p) {
      const updated = { ...p, intensity };
      const lastVisit = s.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      const from = lastVisit && lastVisit.at.getTime() > addDays(now, -28).getTime() ? lastVisit.at : now;
      const pregnancies = s.pregnancies.map((x) => (x.id === p.id ? updated : x));
      set({ pregnancies, tasks: regenerateAnc({ ...s, pregnancies }, updated, from), audit: audit(s, by, `intensity → ${intensity}`, p.mchId, now) });
      return;
    }
    set({ babies: s.babies.map((b) => (b.id === subjectId ? { ...b, intensity } : b)), audit: audit(s, by, `intensity → ${intensity}`, subjectId, now) });
  },

  assignDoctor: (pregnancyId, doctor, by, now) => {
    const s = get();
    set({
      pregnancies: s.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, assignedDoctor: doctor } : p)),
      audit: audit(s, by, `assign_doctor (${doctor.name})`, pregnancyId, now),
    });
  },

  orderInvestigation: (id, by, now) => {
    const s = get();
    set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'ordered', orderedAt: now } : i)), audit: audit(s, by, 'order_investigation', id, now) });
  },

  enterResult: (id, value, unit, note, by, now) => {
    const s = get();
    set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'resulted', result: { value, unit, note, at: now } } : i)), audit: audit(s, by, 'enter_result', id, now) });
  },

  reviewResult: (id, followUp, by, now) => {
    const s = get();
    set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'reviewed', review: { by, at: now, followUp } } : i)), audit: audit(s, by, 'review_result', id, now) });
  },

  markNotDone: (id, reason, by, now) => {
    const s = get();
    set({ investigations: s.investigations.map((i) => (i.id === id ? { ...i, status: 'not_done', notDoneReason: reason } : i)), audit: audit(s, by, 'investigation_not_done', id, now) });
  },

  createReferral: (r, by, now) => {
    const s = get();
    const ref: Referral = { ...r, id: uid('rf'), status: 'requested', events: [{ status: 'requested', at: now, by }], createdBy: by };
    set({ referrals: [...s.referrals, ref], audit: audit(s, by, `referral → ${r.department}`, r.pregnancyId, now) });
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
    if (to === 'scheduled' && data.scheduledAt) {
      tasks = [
        ...tasks,
        { id: uid('tk'), kind: 'referral_appt', subjectType: 'pregnancy', subjectId: ref.pregnancyId, title: `${ref.department} appointment`, refId: id, dueFrom: data.scheduledAt, dueBy: data.scheduledAt, generatedBy: 'clinician', contactAttempts: [] },
      ];
    }
    if (to === 'seen') tasks = tasks.map((t) => (t.refId === id && !t.completedAt ? { ...t, completedAt: now } : t));
    set({ referrals: s.referrals.map((r) => (r.id === id ? next : r)), tasks, audit: audit(s, by, `referral ${to}`, id, now) });
  },

  requestCallback: (motherId, signs, note, requestedBy, channel, now, voice) => {
    const s = get();
    const cb: Callback = { id: uid('cb'), motherId, requestedBy, channel, signs, note, voiceUri: voice?.uri, voiceSeconds: voice?.seconds, at: now };
    useNetwork.getState().markPending(cb.id);
    set({ callbacks: [...s.callbacks, cb], audit: audit(s, requestedBy, 'request_callback', motherId, now) });
    return cb.id;
  },

  closeCallback: (id, outcome, note, by, now) => {
    const s = get();
    set({ callbacks: s.callbacks.map((c) => (c.id === id ? { ...c, closedAt: now, outcome, outcomeNote: note, closedBy: by } : c)), audit: audit(s, by, `callback closed: ${outcome}`, id, now) });
  },

  logAccess: (entity, actor, now) => {
    const s = get();
    // Collapse repeated opens of the same record by the same person within 10 minutes.
    const recent = s.audit.find((a) => a.action === 'view_record' && a.entity === entity && a.actor === actor && now.getTime() - a.at.getTime() < 600_000);
    if (!recent) set({ audit: audit(s, actor, 'view_record', entity, now) });
  },

  logContact: (taskId, outcome, by, now) => {
    const s = get();
    set({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, contactAttempts: [...t.contactAttempts, { at: now, outcome, by }] } : t)),
      audit: audit(s, by, `contact: ${outcome}`, taskId, now),
    });
  },

  rescheduleTask: (taskId, dueBy, reason, by, now) => {
    const s = get();
    set({
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, dueFrom: addDays(dueBy, -2), dueBy, overrideReason: reason } : t)),
      audit: audit(s, by, `reschedule (${reason})`, taskId, now),
    });
  },

  cancelTask: (taskId, reason, by, now) => {
    const s = get();
    set({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, cancelledAt: now, overrideReason: reason } : t)), audit: audit(s, by, `cancel task (${reason})`, taskId, now) });
  },

  addSelfLog: (log) => {
    const id = uid('sl');
    set((s) => ({ selfLogs: [...s.selfLogs, { ...log, id }] }));
    useNetwork.getState().markPending(id);
    return id;
  },

  admit: (pregnancyId, by, now) => {
    const s = get();
    set({ pregnancies: s.pregnancies.map((p) => (p.id === pregnancyId ? { ...p, status: 'admitted' } : p)), audit: audit(s, by, 'admit', pregnancyId, now) });
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
    return babies.map((b) => b.id);
  },

  setDischargeItem: (subjectId, key, state, reason) =>
    set((s) => ({
      discharges: s.discharges.map((d) => (d.subjectId === subjectId ? { ...d, items: d.items.map((i) => (i.key === key ? { ...i, state, reason } : i)) } : d)),
    })),

  completeDischarge: (subjectId, by, now) => {
    const s = get();
    const d = s.discharges.find((x) => x.subjectId === subjectId)!;
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
    const tasks: Task[] = templates.map((f) => ({
      id: uid('tk'),
      kind: f.key.startsWith('tpl') ? 'template' : isBaby ? 'nb_visit' : 'pn_visit',
      subjectType: isBaby ? 'baby' : 'pregnancy',
      subjectId,
      title: f.label,
      dueFrom: addDays(origin, f.dayFrom),
      dueBy: addDays(origin, f.dayTo),
      generatedBy: f.key.startsWith('tpl') ? 'template' : 'protocol',
      contactAttempts: [],
    }));
    set({
      discharges: s.discharges.map((x) => (x.subjectId === subjectId ? { ...x, completedAt: now, completedBy: by } : x)),
      tasks: [...s.tasks, ...tasks],
      audit: audit(s, by, `complete_discharge (+${tasks.length} follow-ups)`, subjectId, now),
    });
  },

  recordVaccine: (immunizationId, givenOn, by) => {
    const s = get();
    set({ immunizations: s.immunizations.map((i) => (i.id === immunizationId ? { ...i, givenOn } : i)), audit: audit(s, by, 'record_vaccine', immunizationId, givenOn) });
  },

  addCaregiver: (c, now) => {
    const s = get();
    set({ caregivers: [...s.caregivers, { ...c, id: uid('cg'), addedAt: now }], audit: audit(s, 'mother', `caregiver_added (${c.relation})`, c.motherId, now) });
  },

  revokeCaregiver: (id, by, now) => {
    const s = get();
    set({ caregivers: s.caregivers.map((c) => (c.id === id ? { ...c, revokedAt: now } : c)), audit: audit(s, by, 'caregiver_revoked', id, now) });
  },

  setCardFields: (motherId, fields) => set((s) => ({ cardFields: { ...s.cardFields, [motherId]: fields } })),

  addNote: (subjectId, body, author, kind, now) => {
    const s = get();
    set({ notes: [...s.notes, { id: uid('nt'), subjectId, author, body, at: now, kind }], audit: audit(s, author, kind === 'ai_verified' ? 'ai_draft_verified' : 'note_added', subjectId, now) });
  },

  addNewbornObs: (obs) => {
    const s = get();
    const id = uid('nb');
    set({ newbornObs: [...s.newbornObs, { ...obs, id }], audit: audit(s, obs.by, 'newborn_observation', obs.babyId, obs.at) });
    useNetwork.getState().markPending(id);
  },

  logDose: (d) =>
    set((s) => ({
      medDoses: [...s.medDoses.filter((x) => !(x.motherId === d.motherId && x.med === d.med && x.date === d.date && x.slot === d.slot)), { ...d, id: uid('md') }],
    })),

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
    return visit.id;
  },

  importRegister: (rows, by, now) => {
    const ids = rows.map((r) => get().registerPregnancy(r, by, now));
    const s = get();
    set({ audit: audit(s, by, `import_register (${ids.length} rows)`, 'register.csv', now) });
    return ids;
  },
}));

export type { ChecklistState };
