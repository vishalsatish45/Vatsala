/* The demo store is the backend in mock mode: the new record-keeping actions update it the way the server would. */
import { addDays } from '@domain/gestation';

import { asStaffId, asTeamId } from '../ids';
import { useDb } from '../store';

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
    db().admit(p.id, by, now);
    expect(db().pregnancies.find((x) => x.id === p.id)).toMatchObject({ status: 'admitted' });
    db().endAdmission(p.id, by, now);
    expect(db().pregnancies.find((x) => x.id === p.id)).toMatchObject({ status: 'active', admissionId: undefined });
  });

  it("records a baby's death: no open visits or vaccine reminders remain", () => {
    const b = db().babies.find((x) => x.outcome === 'live')!;
    db().recordBabyDeath(b.id, now, undefined, by);
    expect(db().babies.find((x) => x.id === b.id)?.deceasedAt).toEqual(now);
    expect(db().tasks.some((t) => t.subjectId === b.id && !t.completedAt && !t.cancelledAt)).toBe(false);
    expect(db().immunizations.some((i) => i.babyId === b.id && !i.givenOn)).toBe(false);
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
