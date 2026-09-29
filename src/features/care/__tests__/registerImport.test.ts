import { autoMap, parseCsv, sampleRegisterCsv, validate } from '../registerImport';

const now = new Date('2026-09-29T09:00:00+05:30');

describe('register import', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '2', '3'],
    ]);
  });

  it('auto-maps sample headers and flags problem rows', () => {
    const [head, ...rows] = parseCsv(sampleRegisterCsv(now));
    const m = autoMap(head!);
    expect(m).toMatchObject({ name: 0, age: 1, phone: 2, village: 3, lmp: 4, gravida: 5, para: 6, blood: 7 });
    const res = validate(rows, m, new Set(['9000000003']), now);
    expect(res.filter((r) => r.status === 'rejected').map((r) => r.cells[0])).toEqual(['Esha P', 'Farida B', 'Hema T']);
    expect(res.find((r) => r.cells[0] === 'Divya K')?.status).toBe('warning');
    expect(res.filter((r) => r.input).length).toBe(7);
  });
});
