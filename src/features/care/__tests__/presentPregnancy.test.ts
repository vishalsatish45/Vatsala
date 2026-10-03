import { registerDatingPayload } from '@/data/payloads';

import { blankRegisterForm, gaDaysOn, makeRegisterSchema, pickerDay, presentDating, type RegisterForm } from '../forms';

// Registration step 2 "Present pregnancy": LMP and EDD required; the POG is worked out. Calendar arithmetic only.
const NOW = new Date('2026-10-02T09:00:00Z');
const REG = new Date('2026-10-02T00:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const local = (iso: string) => pickerDay(day(iso));

describe('present pregnancy dating', () => {
  it('needs both the LMP and the EDD', () => {
    expect(presentDating({})).toBeUndefined();
    expect(presentDating({ presentLmp: local('2026-07-10') })).toBeUndefined();
    expect(presentDating({ presentEdd: local('2027-04-16') })).toBeUndefined();
  });

  it('an EDD of LMP + 280 days dates by LMP; the POG comes from it', () => {
    const d = presentDating({ presentLmp: local('2026-07-10'), presentEdd: local('2027-04-16') })!;
    expect(d).toEqual({ method: 'lmp', lmp: day('2026-07-10') });
    expect(gaDaysOn(d, REG)).toBe(84); // 12 weeks 0 days
  });

  it("a different EDD (e.g. scan-corrected) is kept as the doctor's EDD, with the LMP recorded", () => {
    const d = presentDating({ presentLmp: local('2026-07-10'), presentEdd: local('2027-04-20') })!;
    expect(d).toEqual({ method: 'clinician', edd: day('2027-04-20'), lmp: day('2026-07-10') });
    expect(gaDaysOn(d, REG)).toBe(80);
    expect(registerDatingPayload(d)).toMatchObject({ method: 'clinician', edd: '2027-04-20', lmp: '2026-07-10' });
  });
});

describe('present pregnancy in the register schema', () => {
  const schema = makeRegisterSchema(NOW);
  const valid: RegisterForm = {
    ...blankRegisterForm(NOW),
    name: 'Asha R',
    dob: local('2002-05-01'),
    phone: '9000000099',
    aadhaarLast4: '5678',
    g: '1',
    p: '0',
    l: '0',
    a: '0',
    presentLmp: local('2026-07-10'),
    presentEdd: local('2027-04-16'),
  };
  const messages = (r: ReturnType<typeof schema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

  it('the registration carries the dating', () => {
    expect(schema.parse(valid).dating).toEqual({ method: 'lmp', lmp: day('2026-07-10') });
  });

  it('requires the LMP and the EDD', () => {
    expect(messages(schema.safeParse({ ...valid, presentLmp: undefined }))).toEqual(['presentLmp: Enter the LMP']);
    expect(messages(schema.safeParse({ ...valid, presentEdd: undefined }))).toEqual(['presentEdd: Enter the EDD']);
  });

  it('refuses an LMP in the future, a POG (by LMP) over 42 weeks and an EDD outside the 40 weeks ahead', () => {
    expect(messages(schema.safeParse({ ...valid, presentLmp: local('2026-10-10') }))).toEqual(['presentLmp: The LMP cannot be in the future']);
    expect(messages(schema.safeParse({ ...valid, presentLmp: local('2025-10-01') }))).toEqual(['presentLmp: This LMP gives a POG over 42 weeks on the registration date']);
    expect(messages(schema.safeParse({ ...valid, presentEdd: local('2027-09-01') }))).toEqual(['presentEdd: The EDD should be within 40 weeks after the registration date']);
    expect(messages(schema.safeParse({ ...valid, presentEdd: local('2026-09-01') }))).toEqual(['presentEdd: The EDD should be within 40 weeks after the registration date']);
  });
});
