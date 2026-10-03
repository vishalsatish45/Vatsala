/** DD-MM-YYYY typing helpers for DateField (no UI imports, so they unit-test plainly). */

const pad = (n: number) => String(n).padStart(2, '0');
export const toText = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

/** Digits typed as DDMMYYYY, shown with dashes as they arrive ("0305" → "03-05"). */
export function withDashes(digits: string) {
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('-');
}

/** Whether these DDMMYYYY digits can still become a real date: day 01–31, month 01–12, checked as they arrive. */
export function plausibleDigits(digits: string) {
  const [d1, d2, m1, m2] = [...digits].map(Number);
  if (d1 !== undefined && d1 > 3) return false;
  if (d2 !== undefined && (d1! * 10 + d2 > 31 || d1! * 10 + d2 === 0)) return false;
  if (m1 !== undefined && m1 > 1) return false;
  if (m2 !== undefined && (m1! * 10 + m2 > 12 || m1! * 10 + m2 === 0)) return false;
  return true;
}

const digitsOf = (s: string) => s.replace(/\D/g, '');
/** The cursor position in DD-MM-YYYY just after the first `n` digits. */
const caretAfter = (n: number) => n + (n > 2 ? 1 : 0) + (n > 4 ? 1 : 0);

/**
 * One keystroke in a DD-MM-YYYY box, by digits: the dashes are not editable. `prev` is the box before the keystroke,
 * `raw` what the keyboard made of it, `caret` where the cursor was. Deleting a dash deletes the digit before it;
 * a digit typed in the middle goes in at the cursor. Returns the box and the cursor, or undefined when a digit typed
 * at the end would make an impossible day or month (that keystroke is not taken).
 */
export function editDate(prev: string, raw: string, caret: number): { text: string; caret: number } | undefined {
  const delta = raw.length - prev.length;
  const at = Math.min(Math.max(caret + delta, 0), raw.length);
  let digits = digitsOf(raw);
  let before = digitsOf(raw.slice(0, at)).length;
  // Only a dash went: take the digit before it instead
  if (delta < 0 && digits === digitsOf(prev) && before > 0) {
    digits = digits.slice(0, before - 1) + digits.slice(before);
    before -= 1;
  }
  digits = digits.slice(0, 8);
  before = Math.min(before, digits.length);
  if (delta > 0 && before === digits.length && !plausibleDigits(digits)) return undefined;
  const text = withDashes(digits);
  // A cursor that lands just before a dash goes past it, ready for the next digit
  const at2 = caretAfter(before);
  return { text, caret: text[at2] === '-' ? at2 + 1 : at2 };
}

/** DD-MM-YYYY as a local date; an impossible day (31-02-2026) is refused, never rolled over. */
export function parse(text: string): Date | undefined {
  const m = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return undefined;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : undefined;
}
