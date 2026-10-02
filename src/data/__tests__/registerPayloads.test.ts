import { asMotherId, asPregnancyId, asTeamId } from '../ids';
import { enteredOnly, motherPayload, motherUpdatePayload, redatePayload, registerDatingPayload, registerPayload, type MotherDetails, type RegisterInput } from '../payloads';

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

  it('the registration form sends no dating, no gestational age and no plan (the doctor dates her later)', () => {
    const { dating: _none, ...undated } = input;
    const p = registerPayload({ ...undated, fetuses: undefined, history: { ...input.history, heightCm: 152, weightKg: 54.5 } }, plan);
    expect(p.dating).toBeUndefined();
    expect(p.ga_days).toBeUndefined();
    expect(p.pregnancy.fetuses).toBeUndefined();
    expect(p).toMatchObject({ investigations: [], tasks: [] });
    expect(p.history).toMatchObject({ height_cm: 152, weight_kg: 54.5 });
    // JSON drops the absent keys: the server sees no dating at all.
    expect(Object.keys(JSON.parse(JSON.stringify(p)))).not.toContain('dating');
  });

  it("the first dating carries the planned visits and test windows; a re-dating carries visits only", () => {
    const first = redatePayload(
      asPregnancyId('p1'),
      { method: 'lmp', lmp: day('2026-07-01'), lmpCertain: true },
      { cancelled: [], tasks: [{ id: 't1', kind: 'anc_visit', title: 'ANC visit · 16 weeks', dueFrom: day('2026-10-19'), dueBy: day('2026-10-21') }], investigations: [{ id: 'i1', code: 'hb1', dueFrom: day('2026-10-02'), dueBy: day('2026-10-16'), late: false }] },
      now,
    );
    expect(first).toEqual({
      pregnancy_id: 'p1',
      dating: { method: 'lmp', lmp: '2026-07-01', edd: '2027-04-07', note: undefined, lmp_certain: true },
      cancel_task_ids: [],
      new_tasks: [{ id: 't1', kind: 'anc_visit', title: 'ANC visit · 16 weeks', due_from: '2026-10-19', due_by: '2026-10-21' }],
      investigations: [{ id: 'i1', code: 'hb1', due_from: '2026-10-02', due_by: '2026-10-16', late: false }],
      at: now.toISOString(),
    });
    const redate = redatePayload(asPregnancyId('p1'), { method: 'clinician', edd: day('2027-04-14') }, { cancelled: ['t1'], tasks: [] }, now);
    expect(redate).toMatchObject({ dating: { method: 'clinician', edd: '2027-04-14' }, cancel_task_ids: ['t1'], new_tasks: [], investigations: undefined });
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
        mother: { ...mother, altPhone: '9000000097', email: 'asha@example.com', maritalStatus: 'married', husbandName: 'Ravi', husbandPhone: '9000000096', dob: day('2002-05-01'), dobEstimated: true, addressLine: '#12 Temple Road', district: 'D', state: 'S', pincode: '560001', rchId: '100000000001', aadhaarLast4: '1234', emergencyContact: { name: 'Ravi', relation: 'Husband', phone: '9000000098' } },
        registeredOn: new Date('2026-09-25T06:30:00Z'),
        fetuses: 2,
        tagCodes: ['multiple'],
        tagNote: 'Two sacs',
      },
      plan,
    );
    expect(p.mother).toMatchObject({
      alt_phone: '919000000097', email: 'asha@example.com', marital_status: 'married', husband_name: 'Ravi', husband_phone: '919000000096', dob: '2002-05-01', dob_estimated: true,
      address_line: '#12 Temple Road', district: 'D', state: 'S', pincode: '560001', rch_id: '100000000001', aadhaar_last4: '1234',
      emergency_contact: { name: 'Ravi', relation: 'Husband', phone: '919000000098' },
    });
    // The age is derived from the date of birth, so only the date is sent.
    expect(p.mother.age).toBeUndefined();
    expect(p.pregnancy).toMatchObject({ registered_on: '2026-09-25T06:30:00.000Z', fetuses: 2 });
    expect(p).toMatchObject({ team_id: 'unit-a', tags: ['multiple'], tag_note: 'Two sacs' });
  });
});

describe('mother details payloads', () => {
  it('maps every field, empty ones as "clear"', () => {
    expect(motherPayload(mother)).toEqual({
      name: 'Asha R', dob: null, dob_estimated: false, age: 24, phone: '919000000099', alt_phone: '', email: '', marital_status: '', husband_name: '', husband_phone: '',
      address_line: '', village: '', district: '', state: '', pincode: '', rch_id: '', aadhaar_last4: '', abha_number: '', abha_address: '', lang: 'kn', emergency_contact: null,
    });
    expect(enteredOnly(motherPayload(mother))).toEqual({ name: 'Asha R', age: 24, phone: '919000000099', lang: 'kn' });
  });

  it('update_mother carries the changed fields only, including a cleared one and a new phone', () => {
    const before: MotherDetails = { ...mother, village: 'Hoskote', emergencyContact: { name: 'Ravi', relation: '', phone: '9000000098' } };
    const after: MotherDetails = { ...before, village: '', phone: '9000000077', emergencyContact: { name: 'Ravi', relation: 'Husband', phone: '9000000098' } };
    expect(motherUpdatePayload(before, after)).toEqual({ phone: '919000000077', village: '', emergency_contact: { name: 'Ravi', relation: 'Husband', phone: '919000000098' } });
    expect(motherUpdatePayload(before, before)).toEqual({});
  });

  it("a husband's details go only with a married status; leaving married clears them on the server", () => {
    const married: MotherDetails = { ...mother, maritalStatus: 'married', husbandName: 'Ravi', husbandPhone: '9000000096' };
    expect(motherPayload({ ...married, maritalStatus: 'unmarried' })).toMatchObject({ marital_status: 'unmarried', husband_name: '', husband_phone: '' });
    expect(motherUpdatePayload(married, { ...married, maritalStatus: 'widowed', husbandName: undefined, husbandPhone: undefined })).toEqual({
      marital_status: 'widowed', husband_name: '', husband_phone: '',
    });
    // A date of birth replacing a typed age: the date is sent, the age no longer.
    expect(motherUpdatePayload(mother, { ...mother, dob: day('2002-05-01') })).toEqual({ dob: '2002-05-01', age: undefined });
  });
});

describe('dating arithmetic uses the calendar day that is sent', () => {
  it('a scan "now" just after midnight IST gives an EDD consistent with the scan date sent', () => {
    const scanOn = new Date('2026-10-02T19:00:00Z'); // 00:30 IST on 3 Oct
    const p = registerDatingPayload({ method: 'scan', scanOn, gaAtScanDays: 91 }) as { scan_on: string; edd: string };
    const sent = new Date(`${p.scan_on}T00:00:00Z`);
    expect(p.edd).toBe(new Date(sent.getTime() + (280 - 91) * 86_400_000).toISOString().slice(0, 10));
  });
});
