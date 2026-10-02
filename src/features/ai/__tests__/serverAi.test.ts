/**
 * The Edge Functions' pure helpers (supabase/functions/_shared/ai.ts): de-identification, citation ids and the
 * citation filter. Synthetic people only.
 */
import {
  ADVICE,
  BANNED,
  assignRefs,
  briefPrompt,
  cleanCaptureFields,
  composeFacts,
  deidentify,
  filterCited,
  looksIdentifying,
  prepareRecord,
  type Identifiers,
  type RawRecord,
} from '../../../../supabase/functions/_shared/ai';

const P = '00000000-0000-4000-8004-000000000001';
const V1 = '00000000-0000-4000-8010-000000000001';
const V2 = '00000000-0000-4000-8010-000000000002';
const T1 = '00000000-0000-4000-8011-000000000001';
const T2 = '00000000-0000-4000-8011-000000000002';
const R1 = '00000000-0000-4000-800e-000000000001';
const N1 = '00000000-0000-4000-8012-000000000001';

const ids: Identifiers = {
  mother: ['Lakshmi K'],
  // husband, emergency contact (Gowramma, her mother), caregiver, baby
  family: ['Ravi Kumar', 'Gowramma', 'Ravi K', 'Baby Lakshmi'],
  staff: ['Dr. Priya', 'Dr. Meera Shah'],
  // village, district, state, pincode
  places: ['Hosahalli', 'Tumakuru', 'Karnataka', '572101'],
  // MCH id, IP number, her phone, alternate phone, emergency contact's phone, RCH id, ABHA address
  numbers: ['MCH-2026-000101', 'IP-2026-000001', '919000000003', '919000000013', '919000000023', '123456789012', 'lakshmi.k@abdm'],
};

const raw: RawRecord = {
  kind: 'brief',
  today: '2026-09-29',
  pregnancy: {
    id: P, registered_on: '2026-05-12T04:30:00Z', edd: '2026-11-17', gravida: 2, para: 1, living: 1, abortions: 0,
    status: 'active', intensity: 'close', age: 24, dating_method: 'lmp',
  },
  conditions: ['Anaemia (documented)'],
  allergies: [],
  previous: [{ year: 2023, outcome: 'live birth', mode: 'lscs' }],
  tags: [{ id: '00000000-0000-4000-8013-000000000001', label: 'Previous caesarean', set_at: '2026-05-12T05:00:00Z', set_by_role: 'obstetrician', note: 'Set by Dr. Priya after reviewing the old card' }],
  visits: [
    {
      id: V1, at: '2026-09-14T05:00:00Z', kind: 'anc', by_role: 'obstetrician', complaints: ['headache'],
      note: 'Lakshmi came with her husband Ravi Kumar; call him on 98450 12345 or 919000000003. MCH-2026-000101.',
      observations: [{ label: 'BP systolic', value: '128', unit: 'mm[Hg]' }, { label: 'Weight', value: '61', unit: 'kg' }],
    },
    { id: V2, at: '2026-08-14T05:00:00Z', kind: 'anc', by_role: 'obstetrician', complaints: [], note: null, observations: [] },
  ],
  tests: [
    { id: T1, label: 'OGTT 75 g', status: 'due', due_by: '2026-09-30', sensitive: false, follow_up: null, result: null },
    { id: T2, label: 'HIV', status: 'resulted', due_by: '2026-07-01', sensitive: true, follow_up: null, result: { value: 'Reactive', unit: null, reported_at: '2026-06-20T00:00:00Z' } },
  ],
  referrals: [{ id: R1, department: 'Cardiology', status: 'seen', urgency: 'routine', reason: 'Documented murmur', created_at: '2026-09-01T00:00:00Z', scheduled_at: null, recommendations: 'Dr. Meera Shah: fit for labour' }],
  tasks: [],
  callbacks: [],
  selfLogs: [],
  notes: [
    { id: N1, at: '2026-09-20T00:00:00Z', by_role: 'obstetrician', body: 'Spoke to Ravi K in Hosahalli (572101), email ravi@example.com' },
    {
      id: '00000000-0000-4000-8012-000000000002', at: '2026-09-21T00:00:00Z', by_role: 'obstetrician',
      body: 'Emergency contact Gowramma (9000000023) informed; alternate 90000 00013; moving within Karnataka; ABHA lakshmi.k@abdm',
    },
  ],
  medications: [],
  vaccines: [],
  discharges: [],
};

describe('de-identification', () => {
  const { items } = prepareRecord(raw, ids);
  const all = items.map((i) => i.text).join('\n');

  it.each([
    'Lakshmi', 'Ravi', 'Priya', 'Meera', 'Shah', 'Hosahalli', 'Tumakuru', '572101', 'MCH-2026', 'IP-2026', '98450', '9000000003', 'example.com',
    'Gowramma', '9000000023', '00013', 'Karnataka', 'abdm',
  ])(
    'never sends %s to the model',
    (needle) => {
      expect(all.toLowerCase()).not.toContain(needle.toLowerCase());
    },
  );

  it('replaces people with role words and keeps the documented facts', () => {
    expect(all).toContain('the mother came with her husband a family member;');
    expect(all).toContain('a clinician: fit for labour');
    expect(all).toContain('BP systolic 128 mm[Hg]');
    expect(all).toContain('[phone]');
  });

  it('keeps longer names whole before their parts', () => {
    expect(deidentify('Lakshmi K visited; Dr. Meera Shah saw her', ids)).toBe('the mother visited; a clinician saw her');
  });

  it('withholds sensitive test values', () => {
    expect(all).toContain('HIV');
    expect(all).not.toContain('Reactive');
  });

  it('scrubs identifiers the record did not list', () => {
    expect(deidentify('Call +91 98765 43210, ABHA 12345678901234, id 7d0e3b1c-1111-4222-8333-944455556666', ids)).toBe('Call [phone], [id], id [id]');
    expect(looksIdentifying('BP 128/82 on 2026-09-14')).toBe(false);
    expect(looksIdentifying('see MCH-2026-000777')).toBe(true);
  });

  it('computes gestational age from the EDD only as date arithmetic', () => {
    // EDD 17 Nov, today 29 Sep → 49 days to go → 231 days → 33+0 weeks.
    expect(composeFacts(raw)[0]!.text).toContain('33+0 weeks');
  });
});

describe('citation ids', () => {
  const { items, map } = assignRefs(composeFacts(raw));

  it('gives each source a short id by kind and maps it back to the row', () => {
    expect(items.map((i) => i.ref)).toEqual(['P1', 'G1', 'V1', 'V2', 'T1', 'T2', 'R1', 'N1', 'N2']);
    expect(map.V2).toEqual({ kind: 'visit', id: V2 });
    expect(map.T1).toEqual({ kind: 'test', id: T1 });
  });

  it('lists every item in the prompt with its id', () => {
    const prompt = briefPrompt('brief', '2026-09-29', items);
    for (const i of items) expect(prompt).toContain(`[${i.ref}] `);
  });
});

describe('citation filter', () => {
  const { map } = assignRefs(composeFacts(raw));
  const run = (sentences: unknown[]) => filterCited({ sentences }, map);

  it('keeps cited sentences and maps citations to real ids', () => {
    const { kept, dropped } = run([
      { text: 'Last visit 2026-09-14: BP systolic 128 mm[Hg], weight 61 kg.', sources: ['V1'] },
      { text: 'OGTT 75 g window ends 2026-09-30.', sources: ['[T1]', 'v1'] },
    ]);
    expect(dropped).toBe(0);
    expect(kept).toEqual([
      { text: 'Last visit 2026-09-14: BP systolic 128 mm[Hg], weight 61 kg.', sources: [{ kind: 'visit', id: V1 }] },
      { text: 'OGTT 75 g window ends 2026-09-30.', sources: [{ kind: 'test', id: T1 }, { kind: 'visit', id: V1 }] },
    ]);
  });

  it('accepts inline citations and strips them from the text', () => {
    const { kept } = run([{ text: 'Cardiology referral status seen [R1].', sources: [] }]);
    expect(kept).toEqual([{ text: 'Cardiology referral status seen.', sources: [{ kind: 'referral', id: R1 }] }]);
  });

  it('drops sentences without a citation or with an unknown one', () => {
    const { kept, dropped } = run([
      { text: 'She is doing well overall.', sources: [] },
      { text: 'Next visit is booked.', sources: ['K9'] },
      { text: 'BP 128 recorded.', sources: ['V1', 'Z1'] },
      { text: 'Weight 61 kg [X4].', sources: ['V1'] },
      { text: 'Weight 61 kg.', sources: 'V1' },
      { sources: ['V1'] },
      'not an object',
    ]);
    expect(kept).toEqual([]);
    expect(dropped).toBe(7);
  });

  it('drops interpretive, advice or risk wording outside quotes, but allows it quoted', () => {
    const { kept, dropped } = run([
      { text: 'BP systolic 128 mm[Hg] is high.', sources: ['V1'] },
      { text: 'Consider repeating the OGTT.', sources: ['T1'] },
      { text: 'She should attend cardiology.', sources: ['R1'] },
      { text: 'Weight is stable.', sources: ['V1', 'V2'] },
      { text: 'Tag "Previous caesarean" set 2026-05-12.', sources: ['G1'] },
      { text: 'Note documented: "low appetite reported".', sources: ['N1'] },
    ]);
    expect(kept.map((s) => s.text)).toEqual(['Tag "Previous caesarean" set 2026-05-12.', 'Note documented: "low appetite reported".']);
    expect(dropped).toBe(4);
  });

  it('drops sentences that still carry an identifier', () => {
    expect(run([{ text: 'Card MCH-2026-000101 reviewed.', sources: ['P1'] }]).kept).toEqual([]);
    expect(run([{ text: 'Husband reachable on 9845012345.', sources: ['V1'] }]).kept).toEqual([]);
  });

  it("drops sentences naming this record's own people and places, which no generic pattern catches", () => {
    const named = [
      { text: 'Gowramma was informed.', sources: ['N1'] },
      { text: 'Note documented by the obstetrician about Lakshmi.', sources: ['N1'] },
      { text: 'Seen by Dr. Meera Shah.', sources: ['R1'] },
      { text: 'Family lives in Hosahalli, Karnataka.', sources: ['N1'] },
    ];
    // without the record's identifiers only generic shapes are caught …
    expect(filterCited({ sentences: named }, map).kept).toHaveLength(4);
    // … with them every one is dropped
    const { kept, dropped } = filterCited({ sentences: [...named, { text: 'Note documented on 2026-09-20.', sources: ['N1'] }] }, map, ids);
    expect(kept.map((s) => s.text)).toEqual(['Note documented on 2026-09-20.']);
    expect(dropped).toBe(4);
    expect(looksIdentifying('the mother and a family member', ids)).toBe(false);
  });

  it('tolerates a malformed reply', () => {
    expect(filterCited(null, map)).toEqual({ kept: [], dropped: 0 });
    expect(filterCited({ sentences: 'x' }, map)).toEqual({ kept: [], dropped: 0 });
  });

  it('uses the same interpretive word list as the on-device brief', () => {
    expect(BANNED.test('normal')).toBe(true);
    expect(ADVICE.test('recommendations documented')).toBe(false);
  });
});

describe('capture fields', () => {
  it('keeps known keys once, values as written, confidence in 0..1', () => {
    expect(
      cleanCaptureFields({
        fields: [
          { key: 'bp', value: ' 128/82 ', confidence: 0.884 },
          { key: 'bp', value: '130/80', confidence: 0.9 },
          { key: 'weight', value: '61 kg', confidence: 1.4 },
          { key: 'name', value: 'Lakshmi K', confidence: 0.99 },
          { key: 'albumin', value: 'Nil', confidence: 'high' },
          { key: 'fhr', value: '', confidence: 0.5 },
          { key: 'hb', value: 'call 9845012345', confidence: 0.5 },
        ],
      }),
    ).toEqual([
      { key: 'bp', value: '128/82', confidence: 0.88 },
      { key: 'weight', value: '61 kg', confidence: 1 },
      { key: 'albumin', value: 'Nil', confidence: 0 },
    ]);
  });

  it('tolerates a malformed reply', () => {
    expect(cleanCaptureFields(undefined)).toEqual([]);
    expect(cleanCaptureFields({ fields: [null, 3] })).toEqual([]);
  });
});
