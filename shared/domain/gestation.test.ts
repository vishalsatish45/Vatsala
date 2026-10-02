import {
  addDays,
  babyAge,
  daysBetween,
  eddFromLmp,
  formatGA,
  gestationalAge,
  lmpFromEdd,
  localDay,
  pregnancyProgress,
  trimester,
} from './gestation';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('eddFromLmp / lmpFromEdd', () => {
  it('adds 280 days (Naegele)', () => {
    expect(eddFromLmp(d('2026-02-07')).toISOString().slice(0, 10)).toBe('2026-11-14');
  });
  it('round-trips', () => {
    const lmp = d('2026-02-07');
    expect(lmpFromEdd(eddFromLmp(lmp)).getTime()).toBe(lmp.getTime());
  });
  it('handles leap years', () => {
    expect(eddFromLmp(d('2027-06-01')).toISOString().slice(0, 10)).toBe('2028-03-07');
  });
});

describe('gestationalAge', () => {
  const edd = d('2026-11-14'); // LMP 2026-02-07

  it('is 0+0 on the LMP date', () => {
    expect(gestationalAge(edd, d('2026-02-07'))).toEqual({ weeks: 0, days: 0, totalDays: 0 });
  });
  it('computes weeks+days', () => {
    // 2026-09-28 is 233 days after 2026-02-07 → 33+2
    expect(formatGA(gestationalAge(edd, d('2026-09-28')))).toBe('33+2');
  });
  it('is 40+0 on the EDD', () => {
    expect(formatGA(gestationalAge(edd, edd))).toBe('40+0');
  });
  it('ignores time of day', () => {
    const a = gestationalAge(edd, new Date('2026-09-28T00:00:01Z'));
    const b = gestationalAge(edd, new Date('2026-09-28T23:59:59Z'));
    expect(a).toEqual(b);
  });
  it('never returns negative days component before LMP', () => {
    const ga = gestationalAge(edd, d('2026-02-05'));
    expect(ga.totalDays).toBe(-2);
    expect(ga.days).toBeGreaterThanOrEqual(0);
  });
});

describe('trimester boundaries', () => {
  const ga = (weeks: number) => ({ weeks, days: 0, totalDays: weeks * 7 });
  it.each([
    [13, 1],
    [14, 2],
    [27, 2],
    [28, 3],
    [41, 3],
  ])('%i weeks → trimester %i', (w, t) => {
    expect(trimester(ga(w))).toBe(t);
  });
});

describe('pregnancyProgress', () => {
  it('clamps to 0..1', () => {
    expect(pregnancyProgress({ weeks: -1, days: 0, totalDays: -7 })).toBe(0);
    expect(pregnancyProgress({ weeks: 20, days: 0, totalDays: 140 })).toBe(0.5);
    expect(pregnancyProgress({ weeks: 42, days: 0, totalDays: 294 })).toBe(1);
  });
});

describe('babyAge', () => {
  const dob = d('2026-11-09');
  it.each([
    ['2026-11-09', 'days', 0],
    ['2026-11-22', 'days', 13],
    ['2026-11-23', 'weeks', 2],
    ['2027-02-07', 'weeks', 12],
    ['2027-02-08', 'months', 2],
  ])('on %s → %s %i', (on, unit, value) => {
    expect(babyAge(dob, d(on))).toEqual({ unit, value });
  });
});

describe('date helpers', () => {
  it('daysBetween is signed', () => {
    expect(daysBetween(d('2026-01-10'), d('2026-01-01'))).toBe(-9);
  });
  it('addDays crosses months', () => {
    expect(addDays(d('2026-01-30'), 3).toISOString().slice(0, 10)).toBe('2026-02-02');
  });
  it('localDay is the calendar day of a moment where the phone is, as a UTC-midnight date', () => {
    // 00:30 on 3 Oct where the phone is — the UTC day may still be 2 Oct (India, 00:00–05:30)
    expect(localDay(new Date(2026, 9, 3, 0, 30))).toEqual(d('2026-10-03'));
    expect(localDay(new Date(2026, 9, 3, 23, 59))).toEqual(d('2026-10-03'));
  });
});
