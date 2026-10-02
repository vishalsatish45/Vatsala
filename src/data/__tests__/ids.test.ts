import { asBabyId, asPregnancyId, asStaffId, asSubjectId, mint, paramValue } from '../ids';
import type { BabyId, PregnancyId, SubjectId } from '../types';

describe('typed ids', () => {
  it('reads a route param: value, first of a repeated value, or empty', () => {
    expect(paramValue('abc')).toBe('abc');
    expect(paramValue(['first', 'second'])).toBe('first');
    expect(paramValue([])).toBe('');
    expect(paramValue(undefined)).toBe('');
  });

  it('brands without changing the value', () => {
    const uuid = '5b1f3a52-8c1e-4c8e-9a51-2d1f0c3e7b10';
    expect(asPregnancyId(uuid)).toBe(uuid);
    expect(asBabyId(['bb_seed1'])).toBe('bb_seed1');
    expect(asStaffId('staff_priya')).toBe('staff_priya');
    expect(mint('tk', 'tk_seed0')).toBe('tk_seed0');
  });

  it('keeps entity ids apart at compile time', () => {
    const p: PregnancyId = asPregnancyId('p1');
    const b: BabyId = asBabyId('b1');
    // A pregnancy or a baby is a subject; a plain string is not.
    const subjects: SubjectId[] = [p, b, asSubjectId('s1')];
    // @ts-expect-error a bare string is not a PregnancyId
    const bare: PregnancyId = 'p2';
    // @ts-expect-error a BabyId is not a PregnancyId
    const crossed: PregnancyId = b;
    // Branded ids are still strings for display, comparison and routing.
    const asText: string = p;
    expect([...subjects, bare, crossed, asText]).toEqual(['p1', 'b1', 's1', 'p2', 'b1', 'p1']);
  });
});
