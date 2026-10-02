import type { SupabaseClient } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';

import { loadFamilySnapshot } from '@/data/remote';
import { buildSeed } from '@/data/seed';

import { familyStage } from '../stage';
import { familyTimeline } from '../timeline';
import type { FamilyContext } from '../useFamily';

const t = ((k: string) => k) as unknown as TFunction;

describe('family timeline after a birth', () => {
  const now = new Date('2026-09-29T09:00:00+05:30');

  function ctxFor(name: string, mutate?: (db: ReturnType<typeof buildSeed>) => void) {
    const db = buildSeed(now);
    mutate?.(db);
    const mother = db.mothers.find((m) => m.name === name)!;
    const pregnancy = db.pregnancies.find((p) => p.motherId === mother.id)!;
    const babies = db.babies.filter((b) => b.motherId === mother.id && b.outcome === 'live' && !b.deceasedAt);
    const scopes = { schedule: true, baby: true, logs: true, tests: true };
    const ctx: FamilyContext = { mother, pregnancy, babies, isCaregiver: false, revoked: false, stage: familyStage(pregnancy, babies.length, true), scopes, accountName: '', accountId: '' };
    return { db, ctx };
  }

  it('says "Your baby was born" with a living baby', () => {
    const { db, ctx } = ctxFor('Meena T');
    const delivery = familyTimeline(db, ctx, now, t).find((e) => e.title.startsWith('family.journey.delivery'));
    expect(delivery?.title).toBe('family.journey.delivery');
  });

  it('words the delivery neutrally and drops baby items when no baby is living', () => {
    const { db, ctx } = ctxFor('Meena T', (d) => {
      const m = d.mothers.find((x) => x.name === 'Meena T')!;
      d.babies = d.babies.map((b) => (b.motherId === m.id ? { ...b, deceasedAt: now } : b));
    });
    expect(ctx.stage).toBe('loss');
    const events = familyTimeline(db, ctx, now, t);
    expect(events.some((e) => e.title === 'family.journey.delivery')).toBe(false);
    expect(events.some((e) => e.title === 'family.journey.deliveryNeutral')).toBe(true);
    expect(events.some((e) => e.lane === 'baby')).toBe(false);
  });
});

describe('family snapshot for a caregiver (Supabase contract)', () => {
  const M = '11111111-1111-4111-8111-111111111111';
  const P = '22222222-2222-4222-8222-222222222222';
  const DONE = '33333333-3333-4333-8333-333333333333';
  const NOT_DONE = '44444444-4444-4444-8444-444444444444';

  const results: Record<string, unknown> = {
    family_context: {
      role: 'caregiver',
      scopes: { schedule: true, baby: false, logs: false, tests: true },
      mother: { id: M, name: 'Test Mother', lang: 'en', age: 25, card_fields: null },
      hospital: null,
      pregnancy: { id: P, mch_id: null, registered_on: '2026-05-01', edd: '2026-12-01', status: 'active', ended_on: null, end_reason: null, closer_follow_up: false },
      babies: null,
      card: null,
    },
    family_schedule: { visits: [], vaccines: [], tests_due: [] },
    family_tests: [
      { id: DONE, code: 'hb1', kind: 'lab', label: 'Hb', baby_id: null, due_from: '2026-06-01', due_by: '2026-06-10', status: 'done', result: null },
      { id: NOT_DONE, code: 'urine', kind: 'lab', label: 'Urine', baby_id: null, due_from: '2026-06-01', due_by: '2026-06-10', status: 'not_done', result: null },
    ],
    family_callbacks: [],
  };
  // The one table a family reads: her notification rows (empty here).
  const query = { select: () => query, order: () => query, limit: async () => ({ data: [], error: null }) };
  const db = { rpc: async (fn: string) => ({ data: results[fn], error: null }), from: () => query } as unknown as SupabaseClient;

  it('a finished test without a value is simply done for a caregiver (never "result ready")', async () => {
    const { state } = await loadFamilySnapshot(db, { motherId: M, phone: '9000000099', name: 'Caregiver', role: 'caregiver' });
    expect(state.investigations.find((i) => i.id === DONE)?.status).toBe('reviewed');
    expect(state.investigations.find((i) => i.id === NOT_DONE)?.status).toBe('not_done');
    // The emergency card is not sent to a caregiver: nothing to show, nothing invented.
    expect(state.pregnancies[0]?.history.allergies).toEqual([]);
    expect(state.pregnancies[0]?.mchId).toBe('');
  });
});
