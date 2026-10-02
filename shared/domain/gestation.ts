/**
 * Gestational-age and date arithmetic.
 *
 * Pure, dependency-free, deterministic: "now" is always passed in.
 * Contains no clinical judgement — only calendar arithmetic (PRD §2.2, §12.2).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const PREGNANCY_DAYS = 280;

export type GestationalAge = {
  /** Completed weeks. */
  weeks: number;
  /** Days beyond completed weeks (0–6). */
  days: number;
  /** Total days since LMP. */
  totalDays: number;
};

/** Strip the time component so arithmetic is in whole calendar days (UTC). */
export function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The calendar day a moment falls on where the phone is (its local date), as the UTC-midnight date the arithmetic
 * here uses. Use it for "today" and for the day of a timestamp (a birth, a discharge): `toDateOnly` would take the
 * UTC day, which in India is the previous day between 00:00 and 05:30.
 */
export function localDay(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(toDateOnly(d).getTime() + days * DAY_MS);
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / DAY_MS);
}

/** Naegele's rule: EDD = LMP + 280 days. */
export function eddFromLmp(lmp: Date): Date {
  return addDays(lmp, PREGNANCY_DAYS);
}

/** The LMP-equivalent date implied by an EDD. */
export function lmpFromEdd(edd: Date): Date {
  return addDays(edd, -PREGNANCY_DAYS);
}

/** Gestational age on `on`, derived from the EDD (whichever source the clinician chose). */
export function gestationalAge(edd: Date, on: Date): GestationalAge {
  const totalDays = daysBetween(lmpFromEdd(edd), on);
  return { weeks: Math.floor(totalDays / 7), days: ((totalDays % 7) + 7) % 7, totalDays };
}

/** "32+2" style label. */
export function formatGA(ga: GestationalAge): string {
  return `${ga.weeks}+${ga.days}`;
}

export type Trimester = 1 | 2 | 3;

/** Calendar trimester by completed weeks: 1 (<14), 2 (14–27), 3 (≥28). */
export function trimester(ga: GestationalAge): Trimester {
  if (ga.weeks < 14) return 1;
  if (ga.weeks < 28) return 2;
  return 3;
}

/** Share of a 40-week pregnancy elapsed, clamped to 0–1 (for progress bars). */
export function pregnancyProgress(ga: GestationalAge): number {
  return Math.min(1, Math.max(0, ga.totalDays / PREGNANCY_DAYS));
}

/** Baby age in whole days on `on`. */
export function ageInDays(dob: Date, on: Date): number {
  return daysBetween(dob, on);
}

export type BabyAge = { unit: 'days' | 'weeks' | 'months'; value: number };

/** Friendly age for display: days under 2 weeks, weeks under 3 months, then months. */
export function babyAge(dob: Date, on: Date): BabyAge {
  const d = ageInDays(dob, on);
  if (d < 14) return { unit: 'days', value: Math.max(0, d) };
  if (d < 91) return { unit: 'weeks', value: Math.floor(d / 7) };
  return { unit: 'months', value: Math.floor(d / 30.4375) };
}
