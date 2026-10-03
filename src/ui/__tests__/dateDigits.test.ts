import { editDate, plausibleDigits } from '../dateDigits';

describe('DateField editing (the dashes are not editable)', () => {
  it('adds dashes while typing at the end', () => {
    expect(editDate('0408', '04082', 4)).toEqual({ text: '04-08-2', caret: 7 });
  });

  it('deleting a dash deletes the digit before it', () => {
    // 04-08-2002, cursor after the second dash; backspace removes the dash → the 8 goes
    expect(editDate('04-08-2002', '04-082002', 6)).toEqual({ text: '04-02-002', caret: 4 });
  });

  it('a digit typed in the middle goes in at the cursor, the cursor stays after it', () => {
    // 04-0-2002 (8 deleted earlier), cursor after the 0 of the month; type 9
    expect(editDate('04-02-002', '04-092-002', 4)).toEqual({ text: '04-09-2002', caret: 6 });
  });

  it('replacing a digit in the middle is not refused as an impossible month', () => {
    // backspace the 0 of 05-09-2026 → 05-92-026 for a moment: kept (the box says it is not a real date)
    expect(editDate('05-09-2026', '05--92026', 4)?.text).toBe('05-92-026');
  });

  it('a digit at the end that makes an impossible day or month is not taken', () => {
    expect(editDate('05-1', '05-13', 4)).toBeUndefined();
  });
});

describe('DateField digits', () => {
  it('takes digits that can still become a real day and month', () => {
    for (const ok of ['', '0', '3', '31', '310', '3112', '01', '0109', '15082001']) expect(plausibleDigits(ok)).toBe(true);
  });

  it('refuses a day over 31 or a month over 12 as it is typed', () => {
    for (const bad of ['4', '32', '00', '012', '0113', '0100', '1599']) expect(plausibleDigits(bad)).toBe(false);
  });
});
