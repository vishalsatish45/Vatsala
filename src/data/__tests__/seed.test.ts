import { buildSeed } from '../seed';
import { stillDue, worklist } from '../selectors';

const now = new Date('2026-09-29T09:00:00+05:30');
const db = buildSeed(now);
const byName = (name: string) => db.pregnancies.find((p) => db.mothers.find((m) => m.id === p.motherId)?.name === name)!;

describe('demo seed', () => {
  it('builds unique MCH IDs', () => {
    const ids = db.pregnancies.map((p) => p.mchId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts items in every worklist group', () => {
    const w = worklist(db, now);
    expect(w.some((i) => i.group === 'now')).toBe(true);
    expect(w.some((i) => i.group === 'today')).toBe(true);
    expect(w.some((i) => i.group === 'week')).toBe(true);
  });

  it('surfaces the scenarios the demo relies on', () => {
    const w = worklist(db, now);
    expect(w.find((i) => i.name === 'Lakshmi K' && i.target.type === 'callback')?.familySign).toBe(true);
    expect(w.find((i) => i.name === 'Sunita R' && i.status === 'missed')?.group).toBe('now');
    expect(w.some((i) => i.name === 'Kavya M' && i.statusLabel === 'Scheduled today')).toBe(true);
    expect(w.some((i) => i.name === 'Anjali P' && i.what.startsWith('Result awaiting review'))).toBe(true);
    expect(w.some((i) => i.name === 'Fatima B' && i.what.includes('no update'))).toBe(true);
    expect(w.some((i) => i.name === 'Deepa S' && i.what.startsWith('Test window closing'))).toBe(true);
    expect(w.some((i) => i.name === 'Baby of Rekha V' && i.what.startsWith('Vaccines overdue'))).toBe(true);
    expect(w.some((i) => i.name === 'Meena T' && i.what.startsWith('Discharge checklist'))).toBe(true);
  });

  it("lists Lakshmi's still-due items", () => {
    const due = stillDue(db, byName('Lakshmi K'), now).map((d) => d.label);
    expect(due).toContain('OGTT 75 g');
    expect(due.some((l) => l.startsWith('Cardiology'))).toBe(true);
  });
});

import { continuityEvents, kpi } from '../selectors';

describe('KPI & continuity timeline', () => {
  it('computes an on-time visit rate from seeded history', () => {
    const r = kpi(db, now);
    expect(r.weeks).toHaveLength(8);
    expect(r.onTimeRate).not.toBeNull();
    expect(r.onTimeRate!).toBeGreaterThan(0.4);
    expect(r.onTimeRate!).toBeLessThan(1);
    expect(r.vaccineTimeliness).not.toBeNull();
  });

  it('splits the timeline at delivery with baby events on the baby lane', () => {
    const rekha = byName('Rekha V');
    const ev = continuityEvents(db, rekha.id, now, 'family');
    const delivery = ev.find((e) => e.kind === 'delivery')!;
    expect(delivery.lane).toBe('shared');
    const baby = ev.filter((e) => e.lane === 'baby');
    expect(baby.length).toBeGreaterThan(0);
    expect(baby.every((e) => e.at.getTime() >= delivery.at.getTime())).toBe(true);
    expect(baby.some((e) => e.state === 'missed')).toBe(true); // 6-week vaccines overdue
  });

  it('keeps clinician-only events out of the family timeline', () => {
    const ev = continuityEvents(db, byName('Lakshmi K').id, now, 'family');
    expect(ev.some((e) => e.kind === 'test' || e.kind === 'tag' || e.kind === 'referral')).toBe(false);
  });
});
