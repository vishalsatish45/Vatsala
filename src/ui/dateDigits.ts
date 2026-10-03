/** Date typing helpers for DateField (no UI imports, so they unit-test plainly). */

/** Whether these DDMMYYYY digits can still become a real date: day 01–31, month 01–12, checked as they arrive. */
export function plausibleDigits(digits: string) {
  const [d1, d2, m1, m2] = [...digits].map(Number);
  if (d1 !== undefined && d1 > 3) return false;
  if (d2 !== undefined && (d1! * 10 + d2 > 31 || d1! * 10 + d2 === 0)) return false;
  if (m1 !== undefined && m1 > 1) return false;
  if (m2 !== undefined && (m1! * 10 + m2 > 12 || m1! * 10 + m2 === 0)) return false;
  return true;
}

/** DD-MM-YYYY as a local date; an impossible day (31-02-2026) is refused, never rolled over. */
export function parse(text: string): Date | undefined {
  const m = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : undefined;
}
