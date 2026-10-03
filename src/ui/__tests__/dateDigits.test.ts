import { parse, plausibleDigits } from '../dateDigits';

describe('DateField digits', () => {
  it('takes digits that can still become a real day and month', () => {
    for (const ok of ['', '0', '3', '31', '310', '3112', '01', '0109', '15082001']) expect(plausibleDigits(ok)).toBe(true);
  });

  it('refuses a day over 31 or a month over 12 as it is typed', () => {
    for (const bad of ['4', '32', '00', '012', '0113', '0100', '1599']) expect(plausibleDigits(bad)).toBe(false);
  });

  it('reads DD-MM-YYYY and refuses an impossible day', () => {
    expect(parse('15-08-2001')?.getDate()).toBe(15);
    expect(parse('31-02-2026')).toBeUndefined();
    expect(parse('29-02-2025')).toBeUndefined();
  });
});
