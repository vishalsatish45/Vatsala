import type { MotherId } from '@/data/types';

import { autoMap, parseCsv, sampleRegisterCsv, validate, type KnownMother } from '../registerImport';

const now = new Date('2026-09-29T09:00:00+05:30');
const lakshmi: KnownMother = { id: 'm-lakshmi' as MotherId, name: 'Lakshmi K', phone: '9000000003', activePregnancy: true };

describe('register import', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '2', '3'],
    ]);
  });

  it('auto-maps sample headers and flags problem rows with the server rules', () => {
    const [head, ...rows] = parseCsv(sampleRegisterCsv(now));
    const m = autoMap(head!);
    expect(m).toMatchObject({ name: 0, age: 1, phone: 2, village: 3, lmp: 4, gravida: 5, para: 6, living: 7, abortions: 8, blood: 9, lang: 10 });
    const res = validate(rows, m, [lakshmi], now);
    expect(res.filter((r) => r.status === 'rejected').map((r) => r.cells[0])).toEqual(['Esha P', 'Farida B', 'Hema T']);
    expect(res.find((r) => r.cells[0] === 'Farida B')?.reasons).toContain('LMP is not a real date (DD-MM-YYYY)');
    expect(res.find((r) => r.cells[0] === 'Hema T')?.reasons).toEqual(['This mobile belongs to another patient']);
    expect(res.find((r) => r.cells[0] === 'Divya K')).toMatchObject({ status: 'warning', reasons: ['No language given — English until she changes it'] });
    expect(res.filter((r) => r.input).length).toBe(7);
  });

  it('sends only what the file says — no default medicines, living children or abortions', () => {
    const [head, ...rows] = parseCsv(sampleRegisterCsv(now));
    const bhavya = validate(rows, autoMap(head!), [], now).find((r) => r.cells[0] === 'Bhavya S')!.input!;
    expect(bhavya.history).toEqual({ conditions: [], allergies: [], medicines: [], bloodGroup: 'B+', heightCm: undefined });
    expect(bhavya.gpla).toEqual({ g: 2, p: 1, l: 1, a: 0 });
    expect(bhavya.mother).toMatchObject({ name: 'Bhavya S', age: 27, phone: '9822200002', village: 'Malur', lang: 'kn', emergencyContact: { name: '', relation: '', phone: '' } });
    expect(bhavya.dating.method).toBe('lmp');
  });

  it('refuses values the server refuses (age, G/P/L/A, blood group, impossible dates, repeated mobiles)', () => {
    const head = ['Name', 'Age', 'Mobile', 'LMP', 'G', 'P', 'L', 'A', 'Blood group'];
    const rows = [
      ['One', '61', '9822200101', '01-08-2026', '1', '0', '0', '0', 'O+'],
      ['Two', '25', '9822200102', '31-02-2026', '1', '0', '0', '0', ''],
      ['Three', '25', '9822200103', '01-08-2026', '1', '1', '0', '0', ''],
      ['Four', '25', '9822200104', '01-08-2026', '1', '0', '', '0', 'O positive'],
      ['Five', '25', '9822200105', '01-08-2026', '1', '0', '0', '0', ''],
      ['Six', '25', '9822200105', '01-08-2026', '1', '0', '0', '0', ''],
    ];
    const res = validate(rows, autoMap(head), [], now);
    expect(res.map((r) => r.reasons)).toEqual([
      ['Age: a whole number from 10 to 60'],
      ['LMP is not a real date (DD-MM-YYYY)'],
      ['P + A must be ≤ G − 1 for a current pregnancy'],
      ['P, L and A: whole numbers from 0 to 20', 'Choose a blood group'],
      ['No language given — English until she changes it'],
      ['Same mobile as row 6'],
    ]);
    expect(res.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'warning', 'rejected']);
  });

  it('a returning mother (same mobile and name, no ongoing pregnancy) reuses her record', () => {
    const head = ['Name', 'Age', 'Mobile', 'LMP', 'G', 'P', 'L', 'A', 'Language'];
    const meena: KnownMother = { id: 'm-meena' as MotherId, name: 'Meena T', phone: '9000000006', activePregnancy: false };
    const [r] = validate([['meena  t', '28', '9000000006', '01-08-2026', '2', '1', '1', '0', 'kn']], autoMap(head), [meena], now);
    expect(r).toMatchObject({ status: 'warning', reasons: ['Returning mother — her record is reused and updated from this row'] });
    expect(r!.input!.existingMotherId).toBe('m-meena');
    const [other] = validate([['Someone Else', '28', '9000000006', '01-08-2026', '2', '1', '1', '0', 'kn']], autoMap(head), [meena], now);
    expect(other!.reasons).toEqual(['This mobile belongs to another patient']);
  });

  it('needs the unit when the clinician has several', () => {
    const head = ['Name', 'Age', 'Mobile', 'LMP', 'G', 'P', 'L', 'A', 'Language'];
    const row = [['Asha', '22', '9822200201', '01-08-2026', '1', '0', '0', '0', 'en']];
    expect(validate(row, autoMap(head), [], now, { units: ['u1', 'u2'] })[0]!.reasons).toEqual(['Choose her obstetric unit']);
    expect(validate(row, autoMap(head), [], now, { units: ['u1', 'u2'], teamId: 'u2' })[0]!.input!.teamId).toBe('u2');
  });
});
