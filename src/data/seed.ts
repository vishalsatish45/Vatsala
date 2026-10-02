/**
 * Synthetic demo dataset — every stage of the journey, dated relative to "now" so the
 * demo always looks current. None of these people exist (hackathon rule).
 */
import { addDays, gestationalAge, lmpFromEdd, toDateOnly } from '@domain/gestation';
import { GRACE_DAYS, POSTNATAL_STANDARD, TAG_TEMPLATES, ancVisitDates, investigationWindows, vaccineSchedule, type Intensity } from '@domain/schedules';

import { DEPARTMENTS, DISCHARGE_BABY, DISCHARGE_MOTHER } from './catalogue';
import { previousLabel } from './codes';
import { asStaffId, asTeamId, mint, type IdKind } from './ids';
import type { DbState } from './store';
import type { Baby, Investigation, Pregnancy, Task, Visit } from './types';

const OB = 'Dr. Priya Rao';
const PAED = 'Dr. Arjun Menon';

const RESULTS: Record<string, string> = {
  hb1: '11.4 g/dL',
  bg: 'B+',
  urine: 'Albumin nil · sugar nil',
  hiv: 'Non-reactive',
  vdrl: 'Non-reactive',
  hbsag: 'Non-reactive',
  rbs: '94 mg/dL',
  tsh: '2.1 mIU/L',
  dating: 'Consistent with LMP',
  anomaly: 'Report documented',
  ogtt: '2-h 118 mg/dL',
  hb2: '11.0 g/dL',
  hb3: '11.2 g/dL',
};

let n = 0;
/** A readable demo id, typed by its kind (src/data/ids.ts). */
const id = <K extends IdKind>(p: K) => mint(p, `${p}_seed${(n++).toString(36)}`);
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000);

type Spec = {
  name: string;
  age: number;
  phone: string;
  village: string;
  lang: 'en' | 'kn' | 'hi';
  ga: [number, number];
  gpla: [number, number, number, number];
  intensity: Intensity;
  tags?: string[];
  conditions?: string[];
  allergies?: string[];
  bloodGroup?: string;
  regWeek: number;
  visitWeeks: number[];
  /** Days from today to the next open ANC visit (negative = overdue/missed). */
  nextVisitIn: number;
  previous?: Pregnancy['previous'];
};

export function buildSeed(nowIn: Date): DbState {
  n = 0;
  const now = nowIn;
  const today = toDateOnly(now);
  const s: DbState = {
    mothers: [],
    pregnancies: [],
    tags: [],
    visits: [],
    tasks: [],
    investigations: [],
    referrals: [],
    callbacks: [],
    selfLogs: [],
    deliveries: [],
    babies: [],
    immunizations: [],
    discharges: [],
    audit: [],
    caregivers: [],
    cardFields: {},
    notes: [],
    newbornObs: [],
    medDoses: [],
    captures: [],
    staff: [
      { id: asStaffId('staff_priya'), name: OB, role: 'obstetrician' },
      { id: asStaffId('staff_meera'), name: 'Dr. Meera S', role: 'obstetrician' },
      { id: asStaffId('staff_arjun'), name: PAED, role: 'paediatrician' },
      { id: asStaffId('staff_kiran'), name: 'Dr. Kiran Shah', role: 'specialist' },
    ],
    teams: DEPARTMENTS.map((name) => ({ id: asTeamId(`team_${name.toLowerCase().replace(/\W+/g, '_')}`), name, kind: 'department' as const, specialty: name === 'Paediatrics' ? 'paediatrics' : 'other' })),
    prescriptions: [],
    facts: [],
    overrides: [],
    notifications: [],
    sharedResults: [],
    mchSeq: 1244,
  };

  function ancTask(p: Pregnancy, on: Date): Task {
    return { id: id('tk'), kind: 'anc_visit', subjectType: 'pregnancy', subjectId: p.id, title: `ANC visit · ${gestationalAge(p.edd, on).weeks} weeks`, dueFrom: addDays(on, -2), dueBy: on, generatedBy: 'protocol', contactAttempts: [] };
  }

  function add(spec: Spec, opts: { eddOverride?: Date; status?: Pregnancy['status'] } = {}): Pregnancy {
    const edd = opts.eddOverride ?? addDays(today, 280 - (spec.ga[0] * 7 + spec.ga[1]));
    const lmp = lmpFromEdd(edd);
    const registeredOn = addDays(lmp, spec.regWeek * 7);
    const motherId = id('mo');
    s.mchSeq += 1;
    const p: Pregnancy = {
      id: id('pg'),
      mchId: `MCH-${registeredOn.getUTCFullYear()}-${String(s.mchSeq).padStart(6, '0')}`,
      motherId,
      registeredOn,
      lmp,
      edd,
      eddSource: 'lmp',
      gpla: { g: spec.gpla[0], p: spec.gpla[1], l: spec.gpla[2], a: spec.gpla[3] },
      status: opts.status ?? 'active',
      intensity: spec.intensity,
      assignedDoctor: { name: OB, phone: '080-2222-0001' },
      history: { conditions: spec.conditions ?? [], allergies: spec.allergies ?? [], medicines: ['IFA', 'Calcium'], bloodGroup: spec.bloodGroup ?? 'B+', heightCm: 154 },
      previous: spec.previous ?? [],
    };
    s.mothers.push({
      id: motherId,
      name: spec.name,
      age: spec.age,
      phone: spec.phone,
      lang: spec.lang,
      village: spec.village,
      ipNo: `IP-${registeredOn.getUTCFullYear()}-${String(s.mchSeq).padStart(6, '0')}`,
      emergencyContact: { name: 'Family member', relation: 'Husband', phone: '9800000000' },
    });
    s.pregnancies.push(p);
    for (const code of spec.tags ?? []) s.tags.push({ id: id('tg'), subjectId: p.id, code, setBy: OB, setAt: addDays(registeredOn, 7) });

    spec.visitWeeks.forEach((w, i) => {
      const at = new Date(addDays(lmp, w * 7 + (i % 3)).getTime() + 10.5 * 3_600_000);
      const v: Visit = {
        id: id('vs'),
        pregnancyId: p.id,
        at,
        by: OB,
        vitals: {
          weightKg: Math.round((51 + w * 0.34) * 10) / 10,
          bpSys: 108 + (i % 4) * 4,
          bpDia: 70 + (i % 3) * 3,
          pulse: 84,
          fundalHeightCm: w >= 20 ? w - (i % 2) : undefined,
          fhr: w >= 20 ? 138 + (i % 3) * 4 : undefined,
          presentation: w >= 32 ? 'Cephalic' : undefined,
          urineAlbumin: 'Nil',
          urineSugar: 'Nil',
        },
        checklist: Object.fromEntries(
          ['bp', 'weight', 'urine_albumin', 'fundal_height', 'fhr', 'fetal_movements', 'presentation', 'ifa', 'counselling', 'next_visit'].map((k) => [k, { state: 'done' as const }]),
        ),
        complaints: [],
      };
      s.visits.push(v);
      // Historical ANC task this visit closed — feeds the on-time KPI. Every 5th visit was late.
      const late = i % 5 === 4;
      const dueBy = addDays(toDateOnly(at), late ? -(GRACE_DAYS[spec.intensity] + 3) : -(i % 2));
      s.tasks.push({ id: id('tk'), kind: 'anc_visit', subjectType: 'pregnancy', subjectId: p.id, title: `ANC visit · ${w} weeks`, dueFrom: addDays(dueBy, -2), dueBy, completedAt: at, refId: v.id, generatedBy: 'protocol', contactAttempts: late ? [{ at: addDays(dueBy, GRACE_DAYS[spec.intensity] + 1), outcome: 'Will come', by: 'Care coordinator' }] : [] });
    });

    const inv: Investigation[] = investigationWindows(edd, registeredOn, { rhNegative: (spec.bloodGroup ?? '').includes('-') }).map((w) => {
      const past = w.dueBy.getTime() < today.getTime();
      return {
        id: id('iv'),
        subjectId: p.id,
        ...w,
        status: past ? 'reviewed' : 'due',
        result: past ? { value: RESULTS[w.code] ?? 'Documented', at: addDays(w.dueFrom, 3) } : undefined,
        review: past ? { by: OB, at: addDays(w.dueFrom, 5), followUp: 'None' } : undefined,
      };
    });
    s.investigations.push(...inv);

    if (p.status === 'active') {
      const first = addDays(today, spec.nextVisitIn);
      s.tasks.push(ancTask(p, first), ...ancVisitDates(edd, spec.intensity, first).map((d) => ancTask(p, d)));
    }
    return p;
  }

  const inv = (p: Pregnancy, code: string) => s.investigations.find((i) => i.subjectId === p.id && i.code === code)!;

  // ── 1. Lakshmi — close follow-up, OGTT window closed, call-back open (Family demo account) ──
  const lakshmi = add({
    name: 'Lakshmi K', age: 24, phone: '9000000003', village: 'Hosakote', lang: 'kn', ga: [33, 2], gpla: [2, 1, 1, 0],
    intensity: 'close', tags: ['prev_cs', 'hypertensive'], conditions: [], allergies: ['Penicillin'], bloodGroup: 'B+',
    regWeek: 10, visitWeeks: [10, 14, 18, 22, 26, 28, 30, 32], nextVisitIn: 4,
    previous: [{ year: 2023, outcome: 'Live birth', mode: 'LSCS', note: 'Indication: fetal distress' }],
  });
  Object.assign(inv(lakshmi, 'ogtt'), { status: 'due', result: undefined, review: undefined });
  Object.assign(inv(lakshmi, 'hb3'), { status: 'ordered', orderedAt: addDays(today, -9) });
  const lv = s.visits.filter((v) => v.pregnancyId === lakshmi.id).at(-1)!;
  lv.vitals = { ...lv.vitals, bpSys: 146, bpDia: 94 };
  lv.checklist.urine_albumin = { state: 'not_done', reason: 'Kit unavailable' };
  lv.complaints = ['Headache'];
  s.referrals.push(
    {
      id: id('rf'), pregnancyId: lakshmi.id, department: 'Cardiology', urgency: 'routine', reason: 'Palpitations reported', question: 'Any restriction for delivery planning?',
      status: 'recommendations', scheduledAt: addDays(today, -9), place: 'Block C · Cardiology OPD',
      recommendations: 'Echo documented. No cardiology restriction for delivery planning. Review if symptoms recur.',
      createdBy: OB,
      events: [
        { status: 'requested', at: addDays(now, -20), by: OB },
        { status: 'accepted', at: addDays(now, -19), by: 'Cardiology' },
        { status: 'scheduled', at: addDays(now, -19), by: 'Cardiology' },
        { status: 'seen', at: addDays(now, -9), by: 'Cardiology' },
        { status: 'recommendations', at: addDays(now, -9), by: 'Cardiology' },
      ],
    },
    { id: id('rf'), pregnancyId: lakshmi.id, department: 'Anaesthesia', urgency: 'routine', reason: 'Previous caesarean — pre-delivery review', question: 'Anaesthesia review before 36 weeks', status: 'requested', createdBy: OB, events: [{ status: 'requested', at: hoursAgo(now, 5), by: OB }] },
  );
  s.caregivers.push({ id: id('cg'), motherId: lakshmi.motherId, name: 'Ravi K', relation: 'Husband', phone: '9000000004', scopes: { schedule: true, baby: true, logs: false, tests: false }, addedAt: addDays(lakshmi.registeredOn, 1) });
  s.callbacks.push({ id: id('cb'), motherId: lakshmi.motherId, requestedBy: 'Lakshmi K (mother)', channel: 'app', signs: ['Baby moving less'], note: 'Voice note (0:18)', at: hoursAgo(now, 0.2) });
  s.notes.push(
    { id: id('nt'), subjectId: lakshmi.id, author: OB, body: 'Palpitations reported at 28 weeks. Cardiology opinion requested.', at: addDays(now, -20), kind: 'note' },
    { id: id('nt'), subjectId: lakshmi.id, author: 'Cardiology', body: 'Reviewed. Echo documented. Recommendations recorded on the referral.', at: addDays(now, -9), kind: 'note' },
    { id: id('nt'), subjectId: lakshmi.id, author: OB, body: 'Anaesthesia review requested before 36 weeks (previous LSCS).', at: hoursAgo(now, 5), kind: 'note' },
  );
  for (let d = 1; d <= 7; d++) {
    const date = addDays(today, -d).toISOString().slice(0, 10);
    s.medDoses.push({ id: id('md'), motherId: lakshmi.motherId, med: 'IFA', date, slot: 'afternoon', status: d === 3 || d === 6 ? 'skipped' : 'taken', at: addDays(now, -d) });
    s.medDoses.push({ id: id('md'), motherId: lakshmi.motherId, med: 'Calcium', date, slot: 'morning', status: d === 6 ? 'skipped' : 'taken', at: addDays(now, -d) });
  }
  s.selfLogs.push(
    { id: id('sl'), motherId: lakshmi.motherId, subject: 'mother', kind: 'bp', value: '138/88', at: hoursAgo(now, 50), by: 'Lakshmi K' },
    { id: id('sl'), motherId: lakshmi.motherId, subject: 'mother', kind: 'bp', value: '142/90', at: hoursAgo(now, 26), by: 'Lakshmi K' },
  );

  // ── 2. Sunita — close follow-up, missed visit ──
  const sunita = add({ name: 'Sunita R', age: 28, phone: '9811100002', village: 'Devanahalli', lang: 'kn', ga: [34, 1], gpla: [3, 2, 2, 0], intensity: 'close', tags: ['gdm'], regWeek: 12, visitWeeks: [12, 16, 20, 24, 28, 30], nextVisitIn: -4 });
  const sunitaMissed = s.tasks.find((t) => t.subjectId === sunita.id && t.kind === 'anc_visit')!;
  sunitaMissed.contactAttempts.push({ at: addDays(now, -1), outcome: 'Unreachable', by: 'Care coordinator' });

  // ── 3. Kavya — adolescent, visit today ──
  add({ name: 'Kavya M', age: 25, phone: '9811100003', village: 'Anekal', lang: 'kn', ga: [24, 5], gpla: [1, 0, 0, 0], intensity: 'enhanced', regWeek: 14, visitWeeks: [14, 18, 21], nextVisitIn: 0 });

  // ── 4. Anjali — OGTT resulted, awaiting review ──
  const anjali = add({ name: 'Anjali P', age: 26, phone: '9811100004', village: 'Hoskote', lang: 'hi', ga: [28, 3], gpla: [1, 0, 0, 0], intensity: 'routine', regWeek: 9, visitWeeks: [9, 13, 17, 21, 25], nextVisitIn: 4 });
  Object.assign(inv(anjali, 'ogtt'), { status: 'resulted', result: { value: '2-h 128 mg/dL', at: hoursAgo(now, 3) }, review: undefined });
  Object.assign(inv(anjali, 'hb2'), { status: 'ordered', orderedAt: addDays(today, -2), result: undefined, review: undefined });

  // ── 5. Fatima — referral stale ──
  const fatima = add({ name: 'Fatima B', age: 31, phone: '9811100005', village: 'Yelahanka', lang: 'hi', ga: [36, 0], gpla: [2, 1, 1, 0], intensity: 'enhanced', tags: ['heart'], conditions: ['Heart disease'], regWeek: 11, visitWeeks: [11, 15, 19, 23, 26, 29, 32, 34], nextVisitIn: 3 });
  s.referrals.push({
    id: id('rf'), pregnancyId: fatima.id, department: 'Cardiology', urgency: '24h', reason: 'Known heart disease — delivery planning', question: 'Fitness for vaginal delivery?', status: 'scheduled',
    scheduledAt: addDays(today, -1), place: 'Block C · Cardiology OPD', createdBy: OB,
    events: [
      { status: 'requested', at: addDays(now, -4), by: OB },
      { status: 'accepted', at: hoursAgo(now, 80), by: 'Cardiology' },
      { status: 'scheduled', at: hoursAgo(now, 78), by: 'Cardiology' },
    ],
  });

  // ── 6. Deepa — anomaly-scan window closing ──
  add({ name: 'Deepa S', age: 23, phone: '9811100006', village: 'Nelamangala', lang: 'kn', ga: [22, 1], gpla: [1, 0, 0, 0], intensity: 'routine', regWeek: 8, visitWeeks: [8, 12, 16, 20], nextVisitIn: 12 });

  // ── 7–9. Call-backs & the dual-role doctor ──
  const priyanka = add({ name: 'Priyanka D', age: 29, phone: '9811100007', village: 'Hebbal', lang: 'kn', ga: [30, 2], gpla: [2, 1, 1, 0], intensity: 'routine', regWeek: 10, visitWeeks: [10, 14, 18, 22, 26, 28], nextVisitIn: 1 });
  s.callbacks.push({ id: id('cb'), motherId: priyanka.motherId, requestedBy: 'Caregiver (husband)', channel: 'whatsapp', signs: [], note: 'Replied "2" — wants to reschedule visit', at: hoursAgo(now, 0.7) });
  const roopa = add({ name: 'Roopa N', age: 21, phone: '9811100008', village: 'Doddaballapur', lang: 'kn', ga: [20, 0], gpla: [1, 0, 0, 0], intensity: 'routine', regWeek: 12, visitWeeks: [12, 16], nextVisitIn: 8 });
  s.callbacks.push({ id: id('cb'), motherId: roopa.motherId, requestedBy: 'Roopa N (mother)', channel: 'app', signs: [], note: 'Question about medicines', at: hoursAgo(now, 1.3) });
  add({ name: 'Dr. Meera S', age: 32, phone: '9000000005', village: 'Bengaluru', lang: 'en', ga: [18, 2], gpla: [1, 0, 0, 0], intensity: 'routine', regWeek: 9, visitWeeks: [9, 13, 17], nextVisitIn: 10 });

  // ── Deliveries ──
  function deliver(p: Pregnancy, at: Date, mode: string, baby: Omit<Baby, 'id' | 'childId' | 'motherId' | 'pregnancyId' | 'dob' | 'gaAtBirthDays' | 'intensity'>, by = OB) {
    const b: Baby = { ...baby, id: id('bb'), childId: `${p.mchId}-B1`, motherId: p.motherId, pregnancyId: p.id, dob: at, gaAtBirthDays: gestationalAge(p.edd, at).totalDays, intensity: 'routine' };
    s.babies.push(b);
    s.deliveries.push({ id: id('dl'), pregnancyId: p.id, at, mode, bloodLossMl: 300, complications: [], medicines: ['Oxytocin'], babyIds: [b.id] });
    s.immunizations.push(...vaccineSchedule(at).map((v) => ({ id: id('im'), babyId: b.id, ...v, givenOn: v.group === 'Birth' ? at : undefined })));
    s.audit.push({ id: id('au'), at, actor: by, action: 'record_delivery', entity: p.mchId });
    return b;
  }

  // 10. Meena — delivered 2 days ago, discharge in progress
  const meenaAt = hoursAgo(now, 44);
  const meena = add({ name: 'Meena T', age: 27, phone: '9000000006', village: 'Hoskote', lang: 'kn', ga: [0, 0], gpla: [2, 2, 2, 0], intensity: 'routine', regWeek: 10, visitWeeks: [10, 14, 18, 22, 26, 30, 34, 36, 38], nextVisitIn: 0 }, { eddOverride: addDays(toDateOnly(meenaAt), 6), status: 'delivered' });
  const meenaBaby = deliver(meena, meenaAt, 'Normal vaginal', { sex: 'F', birthWeightG: 2900, apgar1: 8, apgar5: 9, outcome: 'live' });
  s.discharges.push(
    { subjectId: meena.id, subject: 'mother', items: DISCHARGE_MOTHER.map((d) => ({ ...d, state: ['vitals', 'meds', 'bf'].includes(d.key) ? ('done' as const) : undefined })) },
    { subjectId: meenaBaby.id, subject: 'baby', items: DISCHARGE_BABY.map((d) => ({ ...d, state: ['feeding', 'weight', 'birth_doses'].includes(d.key) ? ('done' as const) : undefined })) },
  );

  // 11. Rekha — delivered ~7.5 weeks ago, LBW baby, 6-week vaccines 10 days overdue
  const rekhaAt = new Date(addDays(today, -52).getTime() + 5 * 3_600_000);
  const rekha = add({ name: 'Rekha V', age: 25, phone: '9811100011', village: 'Malur', lang: 'kn', ga: [0, 0], gpla: [1, 1, 1, 0], intensity: 'routine', regWeek: 11, visitWeeks: [11, 15, 19, 23, 27, 31, 34, 36], nextVisitIn: 0 }, { eddOverride: addDays(toDateOnly(rekhaAt), 18), status: 'delivered' });
  const rekhaBaby = deliver(rekha, rekhaAt, 'LSCS (emergency)', { sex: 'M', birthWeightG: 2350, apgar1: 7, apgar5: 9, outcome: 'live' });
  s.tags.push({ id: id('tg'), subjectId: rekhaBaby.id, code: 'lbw', setBy: PAED, setAt: rekhaAt });
  rekhaBaby.intensity = 'enhanced';
  s.discharges.push(
    { subjectId: rekha.id, subject: 'mother', items: DISCHARGE_MOTHER.map((d) => ({ ...d, state: 'done' as const })), completedAt: addDays(rekhaAt, 3), completedBy: OB },
    { subjectId: rekhaBaby.id, subject: 'baby', items: DISCHARGE_BABY.map((d) => ({ ...d, state: 'done' as const })), completedAt: addDays(rekhaAt, 3), completedBy: PAED },
  );
  const follow = [
    ...POSTNATAL_STANDARD.map((f) => ({ f, subjectId: f.subject === 'baby' ? rekhaBaby.id : rekha.id, baby: f.subject === 'baby' })),
    ...(TAG_TEMPLATES.lbw ?? []).map((f) => ({ f, subjectId: rekhaBaby.id, baby: true })),
  ];
  for (const { f, subjectId, baby } of follow) {
    const dueBy = addDays(rekhaAt, f.dayTo);
    const done = f.key !== 'tpl_wt4' && dueBy.getTime() < today.getTime();
    s.tasks.push({
      id: id('tk'), kind: f.key.startsWith('tpl') ? 'template' : baby ? 'nb_visit' : 'pn_visit', subjectType: baby ? 'baby' : 'pregnancy', subjectId, title: f.label,
      dueFrom: addDays(rekhaAt, f.dayFrom), dueBy, completedAt: done ? dueBy : undefined, generatedBy: f.key.startsWith('tpl') ? 'template' : 'protocol', contactAttempts: [],
    });
  }

  // Row ids the server would hold: each shown result, and each documented history fact (entered-in-error needs them).
  for (const i of s.investigations) if (i.result) i.resultId = id('rs');
  for (const p of s.pregnancies) {
    p.previous = p.previous.map((x) => ({ ...x, id: id('pp') }));
    s.facts.push(
      ...p.history.conditions.map((label) => ({ id: id('dc'), motherId: p.motherId, kind: 'condition' as const, label })),
      ...p.history.allergies.map((label) => ({ id: id('al'), motherId: p.motherId, kind: 'allergy' as const, label })),
      ...p.previous.map((x) => ({ id: x.id!, motherId: p.motherId, kind: 'previous_pregnancy' as const, label: previousLabel(x) })),
    );
  }

  s.audit.sort((a, b) => b.at.getTime() - a.at.getTime());
  return s;
}
