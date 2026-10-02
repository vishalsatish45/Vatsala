/* Supabase mode: the store as the optimistic layer — what it queues, and what it refuses to queue. Offline throughout. */
import { clearOutbox, restoreOutbox, useOutbox } from '../outbox';
import { buildSeed } from '../seed';
import { captureVisit, isUnsavedDose, useDb, type BabyInput } from '../store';
import type { CaptureField } from '../types';
import { useNetwork } from '@/lib/network';

// Hoisted above the imports by babel-jest.
jest.mock('@/lib/supabase', () => ({
  isRemote: true,
  supabase: () => {
    throw new Error('no network in tests');
  },
}));
jest.mock('@/lib/secureStorage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));

const now = new Date('2026-09-29T09:00:00+05:30');
const by = 'Dr. Test';
const db = () => useDb.getState();
const queue = () => useOutbox.getState().queue;
const field = (key: string, value: string, confirmed = true): CaptureField => ({ key, label: key, value, confidence: 0.9, confirmed });

beforeEach(async () => {
  clearOutbox();
  await restoreOutbox('user-1');
  useNetwork.setState({ online: false });
  db().hydrate(buildSeed(now));
});

afterAll(() => clearOutbox());

describe('paper capture → visit values', () => {
  it('records weight, BP, FHR, fundal height and the urine scale; keeps Hb and dates on the document only', () => {
    const m = captureVisit([
      field('visit_date', '12/09/2026'),
      field('weight', '61 kg'),
      field('bp', '128/82'),
      field('albumin', 'Nil'),
      field('urine_sugar', 'Trace'),
      field('fhr', '144 /min'),
      field('fundal_height', '28 cm'),
      field('hb', '10.8'),
      field('next_visit', '10/10/2026'),
      field('oedema', 'None', false),
    ]);
    expect(m.vitals).toEqual({ weightKg: 61, bpSys: 128, bpDia: 82, urineAlbumin: 'Nil', urineSugar: 'Trace', fhr: 144, fundalHeightCm: 28 });
    expect(m.components).toEqual(['bp', 'weight', 'urine_albumin', 'fundal_height', 'fhr']);
    expect(m.recorded).toEqual(['weight', 'bp', 'albumin', 'urine_sugar', 'fhr', 'fundal_height']);
    expect(m.documentOnly).toEqual(['visit_date', 'hb', 'next_visit']);
  });

  it('never sends free text or an impossible entry as a visit value: it stays on the document', () => {
    const m = captureVisit([field('albumin', 'absent'), field('urine_sugar', 'nil'), field('weight', '6l kg'), field('fhr', '1440'), field('bp', '128')]);
    expect(m.vitals).toEqual({});
    expect(m.components).toEqual([]);
    expect(m.documentOnly).toEqual(['albumin', 'urine_sugar', 'weight', 'fhr', 'bp']);
  });

  it('queues the confirmed values as coded observations and checklist items', () => {
    const p = db().pregnancies.find((x) => x.status === 'active')!;
    db().saveCapture({ subjectId: p.id, fields: [field('weight', '61 kg'), field('urine_sugar', 'Nil'), field('fundal_height', '28'), field('hb', '10.8')], at: now, by }, now);
    const confirm = queue().find((i) => i.rpc === 'confirm_capture')!;
    expect(confirm.payload.observations).toEqual([
      { code: 'weight', value_num: 61 },
      { code: 'fundal_height', value_num: 28 },
      { code: 'urine_sugar', value_text: 'Nil' },
    ]);
    expect(confirm.payload.checklist).toEqual([
      { component: 'weight', state: 'done' },
      { component: 'fundal_height', state: 'done' },
    ]);
    expect((confirm.payload.fields as { key: string }[]).map((f) => f.key)).toContain('hb');
  });
});

describe('writes that depend on a record still being saved', () => {
  const baby: BabyInput = { sex: 'F', birthWeightG: 2800, outcome: 'live', birthDoses: false };

  it('refuses to record or correct a dose until its delivery is back from the server', () => {
    const p = db().pregnancies.find((x) => x.status === 'active')!;
    const [b] = db().recordDelivery(p.id, { at: now, mode: 'Normal vaginal', complications: [], medicines: [], place: 'this_facility', babies: [baby] }, by);
    const dose = db().immunizations.find((i) => i.babyId === b)!;
    expect(isUnsavedDose(dose.id)).toBe(true);
    const queued = queue().length;

    db().recordVaccine(dose.id, { action: 'given', givenOn: now, here: true }, by, now);
    expect(queue()).toHaveLength(queued);
    expect(db().immunizations.find((i) => i.id === dose.id)?.givenOn).toBeUndefined();
    expect(useOutbox.getState().failure?.message).toMatch(/delivery is still being saved/);

    db().markEnteredInError('immunization', dose.id, 'Wrong baby', by, now);
    expect(queue()).toHaveLength(queued);

    // The reload brings the server's own doses: the phone's plan is gone, and with it the guard.
    db().hydrate(buildSeed(now));
    expect(isUnsavedDose(dose.id)).toBe(false);
  });

  it("withdrawing a result also forgets the test's cached version (the server bumps it)", () => {
    const inv = db().investigations.find((i) => i.resultId)!;
    db().markEnteredInError('investigation_result', inv.resultId!, 'Wrong patient', by, now);
    expect(queue().at(-1)).toMatchObject({ rpc: 'mark_entered_in_error', entityId: inv.resultId, alsoInvalidate: [inv.id] });
  });
});
