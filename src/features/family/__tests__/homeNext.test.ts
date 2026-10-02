import { addDays, localDay } from '@domain/gestation';

import { asInvestigationId, asMotherId, asPregnancyId, asReferralId, asTaskId } from '@/data/ids';
import { emptyState } from '@/data/remote';
import type { DbState } from '@/data/store';
import type { CaregiverScopes, Investigation, Mother, Pregnancy, Task } from '@/data/types';

import { familyItems, homeNextItems, type FamilyContext } from '../useFamily';

/** Family Home before the birth: the next step, plus her next test and her next ANC visit (synthetic data). */
describe('Family Home: next test and next visit', () => {
  const now = new Date('2026-10-02T09:00:00+05:30');
  const today = localDay(now);
  const M = asMotherId('m-home');
  const P = asPregnancyId('p-home');
  const mother: Mother = { id: M, name: 'Test Mother', age: 25, phone: '9000000099', lang: 'en', village: '', emergencyContact: { name: '', relation: '', phone: '' } };
  const pregnancy: Pregnancy = {
    id: P, mchId: 'MCH-TEST', motherId: M, registeredOn: addDays(today, -100), edd: addDays(today, 120), eddSource: 'lmp',
    gpla: { g: 1, p: 0, l: 0, a: 0 }, status: 'active', intensity: 'routine', history: { conditions: [], allergies: [], medicines: [] }, previous: [],
  };
  const ALL: CaregiverScopes = { schedule: true, baby: true, logs: true, tests: true };

  const visit = (id: string, dueBy: number, dueFrom?: number): Task => ({
    id: asTaskId(id), kind: 'anc_visit', subjectType: 'pregnancy', subjectId: P, title: 'ANC visit', dueBy: addDays(today, dueBy),
    dueFrom: dueFrom === undefined ? undefined : addDays(today, dueFrom), generatedBy: 'protocol', contactAttempts: [],
  });
  const test = (id: string, dueFrom: number, dueBy: number, sensitive = false): Investigation => ({
    id: asInvestigationId(id), subjectId: P, code: 'hb2', label: 'Hb', kind: 'lab', sensitive, dueFrom: addDays(today, dueFrom),
    dueBy: addDays(today, dueBy), late: false, status: 'due',
  });

  function home(tasks: Task[], investigations: Investigation[], opts: { caregiver?: boolean; scopes?: CaregiverScopes } = {}) {
    const db: DbState = { ...emptyState(), mothers: [mother], pregnancies: [pregnancy], tasks, investigations };
    const ctx: FamilyContext = {
      mother, pregnancy, babies: [], isCaregiver: !!opts.caregiver, revoked: false, stage: 'pregnant', scopes: opts.scopes ?? ALL, accountName: '', accountId: '',
    };
    return homeNextItems(familyItems(db, ctx, now)).map((i) => `${i.id}:${i.kind}:${i.status}`);
  }

  it('the next step is a test: the next visit still gets its own card below it', () => {
    expect(home([visit('v1', 10, 3), visit('v2', 40, 33)], [test('t1', -2, 5)])).toEqual(['t1:test:due', 'v1:visit:upcoming']);
  });

  it('the next step is a visit: the next test still gets its own card below it', () => {
    expect(home([visit('v1', 2, -3)], [test('t1', 7, 14), test('t2', 12, 20)])).toEqual(['v1:visit:due', 't1:test:upcoming']);
  });

  it('a missed visit stays first and keeps its "missed" status', () => {
    expect(home([visit('v0', -20, -27), visit('v1', 15, 8)], [test('t1', -1, 6)])).toEqual(['v0:visit:missed', 't1:test:due']);
  });

  it('only visits or only tests: one card for the earliest', () => {
    expect(home([visit('v1', 4, -3), visit('v2', 30, 23)], [])).toEqual(['v1:visit:due']);
    expect(home([], [test('t1', 0, 7), test('t2', 3, 10)])).toEqual(['t1:test:due']);
    expect(home([], [])).toEqual([]);
  });

  it('a referral appointment as the next step keeps its card; the test and the visit follow, earliest first', () => {
    const appt: Task = {
      id: asTaskId('r1'), kind: 'referral_appt', subjectType: 'pregnancy', subjectId: P, title: 'Cardiology appointment', refId: asReferralId('ref1'),
      dueBy: addDays(today, 1), generatedBy: 'clinician', contactAttempts: [],
    };
    expect(home([appt, visit('v1', 12, 5)], [test('t1', 6, 13)])).toEqual(['r1:referral:due', 't1:test:upcoming', 'v1:visit:upcoming']);
  });

  it('sensitive tests never make a card', () => {
    expect(home([visit('v1', 10, 3)], [test('hiv', -2, 5, true)])).toEqual(['v1:visit:upcoming']);
  });

  it('caregivers follow their scopes: without the Schedule scope, neither card', () => {
    const noSchedule = { schedule: false, baby: true, logs: false, tests: true };
    expect(home([visit('v1', 10, 3)], [test('t1', -2, 5)], { caregiver: true, scopes: noSchedule })).toEqual([]);
    const schedule = { schedule: true, baby: false, logs: false, tests: false };
    expect(home([visit('v1', 10, 3)], [test('t1', -2, 5)], { caregiver: true, scopes: schedule })).toEqual(['t1:test:due', 'v1:visit:upcoming']);
  });
});
