import { buildSeed } from '@/data/seed';

import { BANNED, buildBrief } from '../brief';

const now = new Date('2026-09-29T09:00:00+05:30');
const db = buildSeed(now);

describe('consultation brief contract', () => {
  const lakshmi = db.pregnancies.find((p) => db.mothers.find((m) => m.id === p.motherId)?.name === 'Lakshmi K')!;
  const brief = buildBrief(db, lakshmi.id, now);

  it('cites at least one source for every sentence', () => {
    expect(brief.sentences.length).toBeGreaterThan(3);
    expect(brief.sentences.every((s) => s.sources.length > 0)).toBe(true);
  });

  it('never uses interpretive words outside quoted documentation', () => {
    for (const s of brief.sentences) expect(BANNED.test(s.text.replace(/"[^"]*"/g, ''))).toBe(false);
  });

  it('includes still-due items and the next visit', () => {
    const text = brief.sentences.map((s) => s.text).join(' ');
    expect(text).toContain('Still due');
    expect(text).toContain('OGTT');
    expect(text).toContain('Next scheduled');
  });
});
