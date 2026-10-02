import { asMotherId, asPregnancyId, asTeamId } from '../ids';
import { enteredOnly, motherPayload, motherUpdatePayload, registerDatingPayload, registerPayload, type MotherDetails, type RegisterInput } from '../payloads';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const now = new Date('2026-10-02T09:00:00Z');

const mother: MotherDetails = {
  name: 'Asha R',
  age: 24,
  phone: '9000000099',
  lang: 'kn',
  village: '',
  emergencyContact: { name: '', relation: '', phone: '' },
};

const input: RegisterInput = {
  mother,
  registeredOn: now,
  dating: { method: 'scan', scanOn: day('2026-09-30'), gaAtScanDays: 87 },
  gpla: { g: 2, p: 1, l: 1, a: 0 },
  fetuses: 1,
  history: { conditions: [], allergies: [], medicines: [] },
  previous: [{ year: 2024, outcome: 'Ectopic' }, { year: 2022, outcome: 'Live birth', mode: 'LSCS', gestationWeeks: 38, complications: ['PPH'] }],
  tagCodes: [],
  intensity: 'routine',
  teamId: asTeamId('unit-a'),
};
const plan = { motherId: asMotherId('m1'), pregnancyId: asPregnancyId('p1'), investigations: [], tasks: [] };

describe('registration payload', () => {
  it('sends only what was entered for her (no "—", no invented contact)', () => {
    const p = registerPayload(input, plan);
    expect(p.mother).toEqual({ id: 'm1', name: 'Asha R', age: 24, phone: '919000000099', lang: 'kn' });
  });

  it('a scan-only dating is sent as a scan dating with its date and GA', () => {
    const p = registerPayload(input, plan);
    expect(p.dating).toEqual({ method: 'scan', scan_on: '2026-09-30', ga_at_scan_days: 87, edd: '2027-04-11', note: undefined, lmp_certain: undefined });
    expect(p.ga_days).toBe(89);
    expect(registerDatingPayload({ method: 'lmp', lmp: day('2026-07-10'), lmpCertain: false })).toMatchObject({ method: 'lmp', lmp: '2026-07-10', lmp_certain: false });
  });

  it('previous pregnancies keep their documented year, outcome code, mode, weeks and complications', () => {
    expect(registerPayload(input, plan).history.previous).toEqual([
      { year: 2024, outcome: 'ectopic', mode: undefined, gestation_weeks: undefined, complications: undefined, note: undefined },
      { year: 2022, outcome: 'live_birth', mode: 'lscs', gestation_weeks: 38, complications: ['PPH'], note: undefined },
    ]);
  });

  it('sends the extra details, the emergency contact with its relation, the unit, fetuses and the tag note', () => {
    const p = registerPayload(
      {
        ...input,
        mother: { ...mother, altPhone: '9000000097', husbandName: 'Ravi', dob: day('2002-05-01'), dobEstimated: true, district: 'D', state: 'S', pincode: '560001', rchId: '100000000001', emergencyContact: { name: 'Ravi', relation: 'Husband', phone: '9000000098' } },
        registeredOn: new Date('2026-09-25T06:30:00Z'),
        fetuses: 2,
        tagCodes: ['multiple'],
        tagNote: 'Two sacs',
      },
      plan,
    );
    expect(p.mother).toMatchObject({
      alt_phone: '919000000097', husband_name: 'Ravi', dob: '2002-05-01', dob_estimated: true, district: 'D', state: 'S', pincode: '560001', rch_id: '100000000001',
      emergency_contact: { name: 'Ravi', relation: 'Husband', phone: '919000000098' },
    });
    expect(p.pregnancy).toMatchObject({ registered_on: '2026-09-25T06:30:00.000Z', fetuses: 2 });
    expect(p).toMatchObject({ team_id: 'unit-a', tags: ['multiple'], tag_note: 'Two sacs' });
  });
});

describe('mother details payloads', () => {
  it('maps every field, empty ones as "clear"', () => {
    expect(motherPayload(mother)).toEqual({
      name: 'Asha R', age: 24, dob: null, dob_estimated: false, phone: '919000000099', alt_phone: '', lang: 'kn', husband_name: '', village: '', district: '', state: '',
      pincode: '', emergency_contact: null, rch_id: '', abha_number: '', abha_address: '',
    });
    expect(enteredOnly(motherPayload(mother))).toEqual({ name: 'Asha R', age: 24, phone: '919000000099', lang: 'kn' });
  });

  it('update_mother carries the changed fields only, including a cleared one and a new phone', () => {
    const before: MotherDetails = { ...mother, village: 'Hoskote', emergencyContact: { name: 'Ravi', relation: '', phone: '9000000098' } };
    const after: MotherDetails = { ...before, village: '', phone: '9000000077', emergencyContact: { name: 'Ravi', relation: 'Husband', phone: '9000000098' } };
    expect(motherUpdatePayload(before, after)).toEqual({ phone: '919000000077', village: '', emergency_contact: { name: 'Ravi', relation: 'Husband', phone: '919000000098' } });
    expect(motherUpdatePayload(before, before)).toEqual({});
  });
});
