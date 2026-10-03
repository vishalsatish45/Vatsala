import { registerDatingPayload } from '@/data/payloads';

import { blankRegisterForm, gaDaysOn, makeRegisterSchema, pickerDay, presentDating, type RegisterForm } from '../forms';

// Registration step 2 "Present pregnancy": LMP / EDD / POG, optional; calendar arithmetic only.
const NOW = new Date('2026-10-02T09:00:00Z');
const REG = new Date('2026-10-02T00:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const local = (iso: string) => pickerDay(day(iso));
const blank = { pogWeeks: '', pogDays: '' };

describe('present pregnancy dating', () => {
  it('is empty until something is entered (she is dated later)', () => {
    expect(presentDating(blank, REG)).toBeUndefined();
  });

  it('an LMP alone dates by LMP: EDD = LMP + 280, POG from the LMP', () => {
    const d = presentDating({ ...blank, presentLmp: local('2026-07-10') }, REG)!;
    expect(d).toEqual({ method: 'lmp', lmp: day('2026-07-10') });
    expect(gaDaysOn(d, REG)).toBe(84); // 12 weeks 0 days
  });

  it('an LMP with its own EDD is still an LMP dating', () => {
    expect(presentDating({ ...blank, presentLmp: local('2026-07-10'), presentEdd: local('2027-04-16') }, REG)).toEqual({ method: 'lmp', lmp: day('2026-07-10') });
  });

  it("an LMP with a different EDD keeps the doctor's EDD and records the LMP", () => {
    const d = presentDating({ ...blank, presentLmp: local('2026-07-10'), presentEdd: local('2027-04-20') }, REG);
    expect(d).toEqual({ method: 'clinician', edd: day('2027-04-20'), lmp: day('2026-07-10') });
    expect(registerDatingPayload(d!)).toMatchObject({ method: 'clinician', edd: '2027-04-20', lmp: '2026-07-10' });
  });

  it("an EDD alone is the doctor's EDD", () => {
    expect(presentDating({ ...blank, presentEdd: local('2027-03-01') }, REG)).toEqual({ method: 'clinician', edd: day('2027-03-01') });
  });

  it('a POG alone gives EDD = registration day + (280 − POG)', () => {
    const d = presentDating({ pogWeeks: '12', pogDays: '3' }, REG)!;
    expect(d).toMatchObject({ method: 'clinician', edd: day('2027-04-13') });
    expect(gaDaysOn(d, REG)).toBe(87);
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
  };
  const messages = (r: ReturnType<typeof schema.safeParse>) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

  it('left empty, the registration has no dating', () => {
    expect(schema.parse(valid).dating).toBeUndefined();
  });

  it('filled, the registration carries the dating', () => {
    expect(schema.parse({ ...valid, presentLmp: local('2026-07-10') }).dating).toEqual({ method: 'lmp', lmp: day('2026-07-10') });
  });

  it('refuses an LMP in the future, an unreadable POG and a POG outside 0–42 weeks', () => {
    expect(messages(schema.safeParse({ ...valid, presentLmp: local('2026-10-10') }))).toEqual(['presentLmp: The LMP cannot be in the future']);
    expect(messages(schema.safeParse({ ...valid, pogWeeks: '50' }))).toEqual(['pogWeeks: POG: 0–42 weeks and 0–6 days']);
    expect(messages(schema.safeParse({ ...valid, pogWeeks: '12', pogDays: '9' }))).toEqual(['pogWeeks: POG: 0–42 weeks and 0–6 days']);
    expect(messages(schema.safeParse({ ...valid, presentLmp: local('2025-10-01') }))).toEqual(['presentLmp: This gives a POG outside 0–42 weeks on the registration date']);
    expect(messages(schema.safeParse({ ...valid, presentEdd: local('2027-09-01') }))).toEqual(['presentEdd: This gives a POG outside 0–42 weeks on the registration date']);
  });
});
