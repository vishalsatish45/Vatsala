/* The demo store is the backend in mock mode: the new record-keeping actions update it the way the server would. */
import { addDays } from '@domain/gestation';

import { dischargePlan } from '../discharge';
import { asStaffId, asTeamId } from '../ids';
import { isoDay } from '../remote';
import { useDb, type BabyInput } from '../store';

// Hoisted above the imports by babel-jest.
jest.mock('@/lib/supabase', () => ({
  isRemote: false,
  supabase: () => {
    throw new Error('no network in tests');
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));

const now = new Date('2026-09-29T09:00:00+05:30');
const by = 'Dr. Test';
const db = () => useDb.getState();
const pregnancyOf = (name: string) => {
  const m = db().mothers.find((x) => x.name === name)!;
  return db().pregnancies.find((p) => p.motherId === m.id)!;
};

beforeEach(() => db().reset(now));

describe('mock-mode record keeping', () => {
  it('prescribes and stops a medicine for a pregnancy', () => {
    const p = pregnancyOf('Lakshmi K');
    const id = db().prescribe({ pregnancyId: p.id }, { name: 'Tab Example', slots: ['night', 'morning'] }, by, now);
    expect(db().prescriptions.find((x) => x.id === id)).toMatchObject({ pregnancyId: p.id, motherId: p.motherId, slots: ['morning', 'night'] });
    db().stopMedication(id, 'Course completed', by, now);
    expect(db().prescriptions.some((x) => x.id === id)).toBe(false);
  });

  it('re-dates a pregnancy and re-plans its future visits from the new EDD', () => {
    const p = pregnancyOf('Lakshmi K');
    const before = db().tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy > now);
    const edd = addDays(p.edd, 14);
    db().redatePregnancy(p.id, { method: 'clinician', edd }, by, now);
    const after = db().pregnancies.find((x) => x.id === p.id)!;
    expect(after.edd).toEqual(edd);
    expect(after.eddSource).toBe('clinician');
    const open = db().tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy > now);
    expect(open.length).toBeGreaterThan(0);
    expect(open.some((t) => before.some((b) => b.id === t.id))).toBe(false);
    expect(open.every((t) => t.dueBy.getTime() <= edd.getTime())).toBe(true);
  });

  it('ends a pregnancy: closed with its outcome, open visits and tests stopped', () => {
    const p = pregnancyOf('Lakshmi K');
    db().endPregnancy(p.id, 'miscarriage', undefined, now, by, now);
    const after = db().pregnancies.find((x) => x.id === p.id)!;
    expect(after).toMatchObject({ status: 'closed', endReason: 'miscarriage' });
    expect(db().tasks.some((t) => t.subjectId === p.id && !t.completedAt && !t.cancelledAt)).toBe(false);
    expect(db().investigations.some((i) => i.subjectId === p.id && (i.status === 'due' || i.status === 'ordered'))).toBe(false);
  });

  it('admits and ends the admission without a delivery', () => {
    const p = pregnancyOf('Lakshmi K');
    db().admit(p.id, { at: now, reason: 'In labour' }, by);
    expect(db().pregnancies.find((x) => x.id === p.id)).toMatchObject({ status: 'admitted', admittedAt: now, admissionReason: 'In labour' });
    db().endAdmission(p.id, by, now);
    expect(db().pregnancies.find((x) => x.id === p.id)).toMatchObject({ status: 'active', admissionId: undefined });
  });

  it("records a baby's death: no open visits or vaccine reminders remain", () => {
    const b = db().babies.find((x) => x.outcome === 'live')!;
    db().recordBabyDeath(b.id, now, undefined, by);
    expect(db().babies.find((x) => x.id === b.id)?.deceasedAt).toEqual(now);
    expect(db().tasks.some((t) => t.subjectId === b.id && !t.completedAt && !t.cancelledAt)).toBe(false);
    expect(db().immunizations.some((i) => i.babyId === b.id && !i.givenOn && i.notGivenReason === undefined)).toBe(false);
  });

  it('marks facts entered in error so they leave every view', () => {
    const v = db().visits[0]!;
    db().markEnteredInError('encounter', v.id, 'Wrong patient', by, now);
    expect(db().visits.some((x) => x.id === v.id)).toBe(false);

    const inv = db().investigations.find((i) => i.result && i.resultId)!;
    db().markEnteredInError('investigation_result', inv.resultId!, 'Typing error', by, now);
    expect(db().investigations.find((i) => i.id === inv.id)).toMatchObject({ result: undefined, review: undefined });

    const fact = db().facts.find((f) => f.kind === 'condition')!;
    db().markEnteredInError('condition', fact.id, 'Wrong patient', by, now);
    expect(db().facts.some((f) => f.id === fact.id)).toBe(false);
    expect(db().pregnancies.filter((p) => p.motherId === fact.motherId).every((p) => !p.history.conditions.includes(fact.label))).toBe(true);
  });

  it('shares a result with a referral once', () => {
    const r = db().referrals[0]!;
    const inv = db().investigations.find((i) => i.subjectId === r.pregnancyId && i.result)!;
    db().shareResult(r.id, inv.id, by, now);
    db().shareResult(r.id, inv.id, by, now);
    expect(db().sharedResults.filter((x) => x.referralId === r.id)).toEqual([{ referralId: r.id, investigationId: inv.id }]);
  });

  it('changes what a caregiver can see', () => {
    const c = db().caregivers[0]!;
    db().updateCaregiver(c.id, { ...c.scopes, tests: true, logs: true }, 'Lakshmi K', now);
    expect(db().caregivers.find((x) => x.id === c.id)?.scopes).toMatchObject({ tests: true, logs: true });
  });

  it('simulates emergency access by MCH id, and ends it', () => {
    const p = pregnancyOf('Sunita R');
    expect(db().grantOverrideLocal('MCH-1999-000000', 'Emergency', now)).toBeUndefined();
    expect(db().grantOverrideLocal(p.mchId, 'Emergency in labour room', now)).toEqual({ motherId: p.motherId, pregnancyId: p.id });
    const o = db().overrides[0]!;
    expect(o.expiresAt.getTime() - now.getTime()).toBe(24 * 3_600_000);
    db().endOverride(o.id, by, now);
    expect(db().overrides).toHaveLength(0);
  });
});

describe('delivery → discharge → newborn (mock mode)', () => {
  const at = new Date(2026, 8, 29, 1, 30); // 01:30 where the phone is
  const baby = (over: Partial<BabyInput>): BabyInput => ({ sex: 'F', birthWeightG: 2800, outcome: 'live', birthDoses: false, ...over });
  const deliver = (babies: BabyInput[]) => {
    const p = pregnancyOf('Lakshmi K');
    const ids = db().recordDelivery(p.id, { at, mode: 'Normal vaginal', complications: [], medicines: [], place: 'this_facility', babies }, by);
    return { p, ids };
  };

  it('birth doses follow each baby, even when an earlier twin is stillborn; doses count from the day of birth', () => {
    const { ids } = deliver([baby({ outcome: 'stillbirth', birthWeightG: undefined, birthDoses: false }), baby({ sex: 'M', birthDoses: true })]);
    expect(db().immunizations.some((i) => i.babyId === ids[0])).toBe(false);
    const birthDoses = db().immunizations.filter((i) => i.babyId === ids[1] && i.group === 'Birth');
    expect(birthDoses).toHaveLength(3);
    expect(birthDoses.every((i) => i.givenOn?.getTime() === Date.UTC(2026, 8, 29))).toBe(true);
    expect(db().babies.find((b) => b.id === ids[0])?.birthWeightG).toBeUndefined();
  });

  it("discharge: N/A needs its reason, the GDM template is planned, closed windows are said, and it completes at the documented time", () => {
    const { p } = deliver([baby({})]);
    db().setTags(p.id, { add: ['gdm'], remove: [] }, undefined, by, now);
    db().setDischargeItem(p.id, 'fp', 'na', undefined);
    expect(db().discharges.find((d) => d.subjectId === p.id)?.items.find((i) => i.key === 'fp')?.state).toBeUndefined();
    db().setDischargeItem(p.id, 'fp', 'na', ' Other: discussed at day 7 ');
    expect(db().discharges.find((d) => d.subjectId === p.id)?.items.find((i) => i.key === 'fp')).toMatchObject({ state: 'na', reason: 'Other: discussed at day 7' });

    // a late discharge (day 6): the day-3 check's window has closed and is said so; the rest are planned
    const late = new Date(2026, 9, 5, 0, 20);
    const plan = dischargePlan(db(), p.id, late);
    expect(plan.find((f) => f.key === 'pn_d3')).toMatchObject({ closed: true });
    expect(plan.find((f) => f.key === 'tpl_glucose')).toMatchObject({ closed: false, dueFrom: new Date(Date.UTC(2026, 8, 29 + 42)), dueBy: new Date(Date.UTC(2026, 8, 29 + 84)) });

    db().completeDischarge(p.id, by, late);
    const d = db().discharges.find((x) => x.subjectId === p.id)!;
    expect(d.completedAt).toEqual(late);
    const fu = db().tasks.filter((t) => t.subjectId === p.id && (t.kind === 'pn_visit' || t.kind === 'template'));
    expect(fu.map((t) => t.title)).toEqual(expect.arrayContaining(['Glucose test · weeks 6–12', 'Postnatal check · day 7']));
    expect(fu.some((t) => t.title === 'Postnatal check · day 3')).toBe(false);
  });

  it('vaccine doses: given elsewhere, not given with a reason, and entered in error back to due', () => {
    const { ids } = deliver([baby({})]);
    const dose = (code: string) => db().immunizations.find((i) => i.babyId === ids[0] && i.code === code)!;
    db().recordVaccine(dose('bcg').id, { action: 'given', givenOn: at, here: false, location: 'Sub-centre (MCP card)', batch: ' B-7 ' }, by, now);
    expect(dose('bcg')).toMatchObject({ givenOn: new Date(Date.UTC(2026, 8, 29)), given: { here: false, location: 'Sub-centre (MCP card)', batch: 'B-7' } });
    db().recordVaccine(dose('opv0').id, { action: 'not_given', reason: 'Vaccine out of stock' }, by, now);
    expect(dose('opv0').notGivenReason).toBe('Vaccine out of stock');

    const old = dose('bcg').id;
    db().markEnteredInError('immunization', old, 'Recorded on the wrong baby', by, now);
    expect(dose('bcg').id).not.toBe(old);
    expect(dose('bcg')).toMatchObject({ givenOn: undefined, given: undefined, notGivenReason: undefined });
  });

  it('a newborn observation keeps its time, length, head circumference and note', () => {
    const { ids } = deliver([baby({})]);
    db().addNewbornObs({ babyId: ids[0]!, at: now, by, weightG: 2750, lengthCm: 49, headCircCm: 34, note: 'Calm' });
    expect(db().newbornObs.find((o) => o.babyId === ids[0])).toMatchObject({ at: now, lengthCm: 49, headCircCm: 34, note: 'Calm' });
  });
});

describe('isoDay', () => {
  it('a domain date is its own day; any other moment is the local calendar day (never the UTC day)', () => {
    expect(isoDay(new Date(Date.UTC(2026, 9, 3)))).toBe('2026-10-03');
    expect(isoDay(new Date(2026, 9, 3, 0, 30))).toBe('2026-10-03');
    expect(isoDay(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });
});

describe('mock-mode registration, details and care teams', () => {
  const details = (name: string) => ({ ...db().mothers.find((x) => x.name === name)! });
  const base = {
    registeredOn: now,
    dating: { method: 'lmp' as const, lmp: new Date('2026-07-01T00:00:00Z') },
    gpla: { g: 2, p: 1, l: 1, a: 0 },
    history: { conditions: [], allergies: [], medicines: [] },
    previous: [],
    tagCodes: [],
    intensity: 'routine' as const,
  };

  it('registers with the chosen unit and the paediatric unit, the registering doctor named', () => {
    const id = db().registerPregnancy({ ...base, mother: { name: 'New Mother', age: 25, phone: '9822200301', lang: 'en', village: '', emergencyContact: { name: '', relation: '', phone: '' } }, teamId: asTeamId('team_ob_unit_b') }, by, now);
    const a = db().assignments.filter((x) => x.subjectId === id);
    expect(a.map((x) => [x.specialty, x.teamId])).toEqual([['obstetrics', 'team_ob_unit_b'], ['paediatrics', 'team_paediatrics_unit']]);
    expect(db().pregnancies.find((p) => p.id === id)!.eddSource).toBe('lmp');
  });

  it('a confirmed returning mother keeps one record, corrected only where the form entered something', () => {
    const rekha = details('Rekha V');
    const before = db().mothers.length;
    const id = db().registerPregnancy({ ...base, existingMotherId: rekha.id, mother: { ...rekha, village: '', district: 'New District', emergencyContact: { name: '', relation: '', phone: '' } } }, by, now);
    expect(db().mothers).toHaveLength(before);
    const after = db().mothers.find((m) => m.id === rekha.id)!;
    expect(after).toMatchObject({ village: rekha.village, district: 'New District', emergencyContact: rekha.emergencyContact });
    expect(db().pregnancies.find((p) => p.id === id)!.motherId).toBe(rekha.id);
  });

  it('corrects a mother\'s details (only when something changed)', () => {
    const m = details('Lakshmi K');
    const audit = db().audit.length;
    db().updateMother(m.id, { ...m }, by, now);
    expect(db().audit).toHaveLength(audit);
    db().updateMother(m.id, { ...m, phone: '9822200302', pincode: '560001', emergencyContact: { name: 'Ravi K', relation: 'Husband', phone: '9000000004' } }, by, now);
    expect(db().mothers.find((x) => x.id === m.id)).toMatchObject({ phone: '9822200302', pincode: '560001', ipNo: m.ipNo });
    expect(db().audit[0]!.action).toMatch(/^update_mother \(phone, pincode, emergency_contact\)$/);
  });

  it('reassigns a pregnancy to a team without a named doctor, and a baby to its paediatric team', () => {
    const p = pregnancyOf('Lakshmi K');
    db().assignCare(p.id, 'obstetrics', asTeamId('team_ob_unit_b'), undefined, 'Moved near Unit B', by, now);
    expect(db().assignments.filter((a) => a.subjectId === p.id && a.specialty === 'obstetrics')).toEqual([{ subjectId: p.id, specialty: 'obstetrics', teamId: 'team_ob_unit_b', staffId: undefined }]);
    expect(db().pregnancies.find((x) => x.id === p.id)!.assignedDoctor).toBeUndefined();
    const b = db().babies[0]!;
    db().assignCare(b.id, 'paediatrics', asTeamId('team_paediatrics_unit'), asStaffId('staff_arjun'), 'Follow-up', by, now);
    expect(db().assignments.filter((a) => a.subjectId === b.id)).toEqual([{ subjectId: b.id, specialty: 'paediatrics', teamId: 'team_paediatrics_unit', staffId: 'staff_arjun' }]);
  });
});
