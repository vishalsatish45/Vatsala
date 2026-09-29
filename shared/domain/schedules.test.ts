import { eddFromLmp } from './gestation';
import {
  GRACE_DAYS,
  ancIntervalWeeks,
  ancVisitDates,
  completeness,
  expectedComponents,
  investigationWindows,
  taskStatus,
  vaccineSchedule,
} from './schedules';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe('ancIntervalWeeks', () => {
  it.each([
    ['routine', 20, 4],
    ['routine', 28, 2],
    ['routine', 36, 1],
    ['enhanced', 20, 3],
    ['enhanced', 30, 2],
    ['close', 12, 2],
    ['close', 35, 2],
    ['close', 36, 1],
  ] as const)('%s at %i wks → every %i wks', (intensity, ga, weeks) => {
    expect(ancIntervalWeeks(intensity, ga)).toBe(weeks);
  });
});

describe('ancVisitDates', () => {
  const lmp = d('2026-02-07');
  const edd = eddFromLmp(lmp); // 2026-11-14

  it('never schedules past the EDD and is strictly increasing', () => {
    for (const intensity of ['routine', 'enhanced', 'close'] as const) {
      const dates = ancVisitDates(edd, intensity, d('2026-05-01'));
      expect(dates.length).toBeGreaterThan(0);
      expect(dates.every((x) => x.getTime() <= edd.getTime())).toBe(true);
      dates.slice(1).forEach((x, i) => expect(x.getTime()).toBeGreaterThan(dates[i]!.getTime()));
    }
  });

  it('close follow-up schedules more visits than routine', () => {
    const from = d('2026-05-01');
    expect(ancVisitDates(edd, 'close', from).length).toBeGreaterThan(ancVisitDates(edd, 'routine', from).length);
  });

  it('routine from 20+0 steps 4 weeks', () => {
    const at20 = d('2026-06-27'); // LMP + 140
    expect(iso(ancVisitDates(edd, 'routine', at20)[0]!)).toBe('2026-07-25');
  });
});

describe('investigationWindows', () => {
  const lmp = d('2026-02-07');
  const edd = eddFromLmp(lmp);

  it('places OGTT at 24–28 weeks', () => {
    const w = investigationWindows(edd, lmp).find((x) => x.code === 'ogtt')!;
    expect(iso(w.dueFrom)).toBe('2026-07-25'); // +168
    expect(iso(w.dueBy)).toBe('2026-08-28'); // +202
    expect(w.late).toBe(false);
  });

  it('marks closed windows at late registration as due now, not missed', () => {
    const registered = d('2026-08-15'); // ~27 weeks
    const first = investigationWindows(edd, registered).find((x) => x.code === 'hb1')!;
    expect(first.late).toBe(true);
    expect(iso(first.dueFrom)).toBe('2026-08-15');
    expect(iso(first.dueBy)).toBe('2026-08-29');
  });

  it('only schedules Coombs when Rh-negative is documented', () => {
    expect(investigationWindows(edd, lmp).some((x) => x.code === 'ict')).toBe(false);
    expect(investigationWindows(edd, lmp, { rhNegative: true }).some((x) => x.code === 'ict')).toBe(true);
  });

  it('flags sensitive tests', () => {
    const sens = investigationWindows(edd, lmp).filter((x) => x.sensitive).map((x) => x.code);
    expect(sens.sort()).toEqual(['hbsag', 'hiv', 'vdrl']);
  });
});

describe('vaccineSchedule', () => {
  it('matches UIP ages', () => {
    const s = vaccineSchedule(d('2026-11-09'));
    const at = (code: string) => iso(s.find((v) => v.code === code)!.dueOn);
    expect(at('bcg')).toBe('2026-11-09');
    expect(at('penta1')).toBe('2026-12-21');
    expect(at('penta2')).toBe('2027-01-18');
    expect(at('penta3')).toBe('2027-02-15');
    expect(at('mr1')).toBe('2027-08-06');
  });
});

describe('completeness', () => {
  it('only expects GA-appropriate components', () => {
    expect(expectedComponents(12).map((c) => c.key)).not.toContain('fhr');
    expect(expectedComponents(33).map((c) => c.key)).toContain('presentation');
  });

  it('counts done and excludes N/A', () => {
    const r = completeness(33, { bp: 'done', weight: 'done', urine_albumin: 'not_done', presentation: 'na' });
    expect(r.expected).toBe(9);
    expect(r.done).toBe(2);
    expect(r.missing.map((m) => m.key)).not.toContain('urine_albumin');
  });
});

describe('taskStatus', () => {
  const task = { dueFrom: d('2026-10-01'), dueBy: d('2026-10-05'), completed: false };
  it.each([
    ['2026-09-30', 'upcoming'],
    ['2026-10-01', 'due'],
    ['2026-10-05', 'due'],
    ['2026-10-06', 'overdue'],
    ['2026-10-07', 'overdue'],
    ['2026-10-08', 'missed'],
  ])('close follow-up on %s → %s', (on, status) => {
    expect(taskStatus(task, d(on), GRACE_DAYS.close)).toBe(status);
  });
  it('done wins', () => {
    expect(taskStatus({ ...task, completed: true }, d('2027-01-01'), 0)).toBe('done');
  });
  it('infinite grace never becomes missed', () => {
    expect(taskStatus(task, d('2027-01-01'), Infinity)).toBe('overdue');
  });
});
