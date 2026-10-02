import { LEARN } from '../learn';
import { WELLBEING, findArticle, wellbeingFor } from '../wellbeing';

describe('diet & exercise cards', () => {
  it('follow her stage: pregnancy cards while pregnant, recovery cards after a birth', () => {
    const pregnant = wellbeingFor('diet', { birthHappened: false, withBaby: false });
    expect(pregnant.length).toBeGreaterThan(0);
    expect(pregnant.every((c) => c.stage === 'pregnancy' && c.kind === 'diet')).toBe(true);
    const after = wellbeingFor('exercise', { birthHappened: true, withBaby: true });
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((c) => c.stage === 'afterBirth' && c.kind === 'exercise')).toBe(true);
  });

  it('never show baby care (breastfeeding) without a living baby shared with this account', () => {
    expect(wellbeingFor('diet', { birthHappened: true, withBaby: false }).some((c) => c.aboutBaby)).toBe(false);
    expect(wellbeingFor('diet', { birthHappened: true, withBaby: true }).some((c) => c.slug === 'diet-breastfeeding')).toBe(true);
  });

  it('open from the same article screen as Learn, with unique slugs', () => {
    const slugs = [...LEARN, ...WELLBEING].map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(findArticle('exercise-walking')?.title).toBe('Gentle walking');
    expect(findArticle(LEARN[0]!.slug)).toBe(LEARN[0]);
    expect(findArticle('nope')).toBeUndefined();
  });

  it('stay general: no numbers, doses or interpretation of her values', () => {
    for (const c of WELLBEING) {
      const text = [c.title, c.summary, ...c.body].join(' ');
      expect(text).not.toMatch(/\b\d+\s?(mg|g|kcal|ml|minutes?|mins?)\b/i);
      expect(text).not.toMatch(/\b(normal|abnormal|high|low|risk)\b/i);
    }
  });
});
