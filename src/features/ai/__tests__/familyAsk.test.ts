/**
 * The family-ask Edge Function's pure helpers (supabase/functions/_shared/family.ts): warning-sign detection,
 * facts from the family read functions, the final answer gate and request validation. Synthetic people only.
 */
import {
  EMPTY_ANSWER,
  FAMILY_SCHEMA,
  REFER_ANSWER,
  URGENT_ANSWER,
  checkAnswer,
  factsFromFamily,
  familyPrompt,
  finalizeAnswer,
  istDateTime,
  parseAsk,
  urgentReason,
  type FamilyPayload,
} from '../../../../supabase/functions/_shared/family';

const BABY = '00000000-0000-4000-800c-000000000001';

const payload: FamilyPayload = {
  today: '2026-10-02',
  context: {
    role: 'mother',
    mother: { name: 'Lakshmi K' },
    hospital: { name: 'Demo District Hospital', phone_opd: '+918012345678', phone_labour: '08023456789', address: '12 Main Road, Demo Town 560001' },
    pregnancy: { mch_id: 'MCH-2026-000101', registered_on: '2026-05-15', edd: '2026-11-20', status: 'active', ended_on: null },
    babies: [],
    card: { emergency_contact: { name: 'Gowramma', phone: '919000000099' } },
  },
  schedule: {
    visits: [
      { id: 'v1', kind: 'anc_visit', title: 'ANC visit · 34 weeks', baby_id: null, due_from: '2026-10-07', due_by: '2026-10-09', appointment_at: '2026-10-08T04:30:00Z', place: 'OPD room 4', done: false },
      { id: 'v2', kind: 'referral_appt', title: 'Cardiology appointment', baby_id: null, due_from: null, due_by: '2026-10-12', appointment_at: '2026-10-12T06:00:00Z', place: null, done: false },
      { id: 'v3', kind: 'anc_visit', title: 'Call Lakshmi on 9876543210', baby_id: null, due_from: null, due_by: '2026-09-20', appointment_at: null, place: null, done: true },
    ],
    vaccines: [{ id: 'z1', label: 'Td 2', baby_id: null, due_on: '2026-10-10', status: 'due', given_on: null }],
    tests_due: [],
  },
  tests: [
    { id: 't1', label: 'Haemoglobin', baby_id: null, due_from: '2026-09-01', due_by: '2026-09-30', status: 'done' },
    { id: 't2', label: 'Glucose challenge', baby_id: null, due_from: '2026-10-01', due_by: '2026-10-15', status: 'due' },
  ],
  medicines: [{ id: 'm1', name: 'Iron and folic acid', dose: '1 tablet', slots: ['morning', 'night'], instructions: 'After food, ask Dr. Priya on 9123456780', start_on: '2026-09-01', end_on: null }],
};

describe('urgentReason (checked before any model call)', () => {
  it.each([
    ['My baby is not moving since morning', 'baby_movement'],
    ['baby not moving', 'baby_movement'],
    ['The baby is moving less today', 'baby_movement'],
    ["I can't feel the baby kick", 'baby_movement'],
    ['I am bleeding a little', 'bleeding'],
    ['there is bleding down there', 'bleeding'],
    ['blood is coming', 'bleeding'],
    ['she had fits last night', 'fits'],
    ['Seizure?', 'fits'],
    ['my water broke', 'waters'],
    ['Water just broke!!', 'waters'],
    ['fluid leaking since an hour', 'waters'],
    ['very bad stomach pain', 'pain'],
    ['severe pain in my belly', 'pain'],
    ['bad headache and blurry vision', 'headache_vision'],
    ['my face and hands are swollen', 'swelling'],
    ['baby has fever', 'fever'],
    ['she is having trouble breathing', 'breathing'],
    ['baby is not feeding', 'baby_feeding'],
    ['baby is very sleepy and hard to wake', 'baby_sleepy'],
    ['jaundice spreading to legs', 'jaundice'],
    ['contractions every 5 minutes', 'labour'],
    ['I fell down the stairs', 'injury'],
  ])('%s → urgent', (q, reason) => {
    expect(urgentReason(q)).toBe(reason);
  });

  it.each([
    'When is my next visit?',
    'What should I bring to my scan?',
    'Is my blood test done?',
    'Blood test results from the lab — when?',
    'What time is my iron tablet?',
    'Which vaccine is due for my baby?',
    'Tell me about breathing exercises',
    'What foods have iron?',
    'Where is the hospital?',
  ])('%s → not urgent', (q) => {
    expect(urgentReason(q)).toBeNull();
  });
});

describe('factsFromFamily', () => {
  const { facts, refs, known } = factsFromFamily(payload);
  const all = facts.map((f) => f.text).join('\n');

  it('gives short ref ids mapped to record kinds', () => {
    expect(refs).toMatchObject({ H1: 'hospital', V1: 'visits', A1: 'appointments', T1: 'tests', T2: 'tests', M1: 'medicines', I1: 'vaccines' });
    expect(facts.find((f) => f.ref === 'V1')!.text).toContain('booked for 2026-10-08 10:00 (India time)');
    expect(facts.find((f) => f.ref === 'T2')!.text).toContain('pending, due by 2026-10-15');
    expect(facts.find((f) => f.ref === 'M1')!.text).toContain('times: morning, night');
  });

  it('strips names, phone numbers, MCH ids and addresses', () => {
    for (const s of ['Lakshmi', 'Gowramma', 'MCH-2026', '9876543210', '9123456780', '8012345678', '08023456789', 'Main Road', '560001', '919000000099']) {
      expect(all).not.toContain(s);
    }
    expect(all).toContain('[phone]');
    expect(all).toContain('Demo District Hospital');
    expect(known.names).toContain('Lakshmi K');
    expect(known.numbers).toContain('MCH-2026-000101');
  });

  it('never carries result values or clinician grading', () => {
    const withResult = { ...payload, tests: [{ ...payload.tests![0], result: { value_num: 9.1, unit: 'g/dL' } } as never] };
    expect(factsFromFamily(withResult).facts.map((f) => f.text).join(' ')).not.toMatch(/9\.1|g\/dL/);
    expect(all).not.toMatch(/intensity|closer|risk/i);
  });

  it("names the baby only as 'the baby'", () => {
    const withBaby: FamilyPayload = {
      ...payload,
      context: { ...payload.context, babies: [{ id: BABY, name: 'Chinnu', dob: '2026-09-30', live: true }] },
      schedule: { ...payload.schedule, vaccines: [{ id: 'z2', label: 'BCG for Chinnu', baby_id: BABY, due_on: '2026-09-30', status: 'given', given_on: '2026-09-30' }] },
    };
    const text = factsFromFamily(withBaby).facts.map((f) => f.text).join('\n');
    expect(text).toContain('for the baby: given on 2026-09-30');
    expect(text).toContain('The baby was born on 2026-09-30.');
    expect(text).not.toContain('Chinnu');
  });

  it('a caregiver without the tests / logs scopes gets only the schedule', () => {
    const { facts: f } = factsFromFamily({ ...payload, context: { ...payload.context, role: 'caregiver' }, tests: null, medicines: null });
    expect(f.some((x) => x.kind === 'tests' || x.kind === 'medicines')).toBe(false);
    expect(f.some((x) => x.kind === 'visits')).toBe(true);
  });

  it('builds the prompt with facts, topic ids and the question as data', () => {
    const p = familyPrompt('2026-10-02', 'mother', facts, [{ id: 'iron-foods', title: 'Iron-rich foods', text: 'Green leafy vegetables, jaggery and dates.' }], 'What foods have iron?');
    expect(p).toContain('[V1]');
    expect(p).toContain('[topic:iron-foods] Iron-rich foods');
    expect(p).toContain('"""What foods have iron?"""');
    expect(FAMILY_SCHEMA.required).toEqual(['answer', 'kind', 'sources']);
  });
});

describe('checkAnswer', () => {
  it('passes plain scheduling answers with a record source', () => {
    const r = checkAnswer('Your next visit is due between 2026-10-07 and 2026-10-09, booked for 2026-10-08 10:00 at "OPD room 4".', 'record', { sources: ['visits'] });
    expect(r.kind).toBe('record');
    expect(r.blocked).toBeNull();
  });

  it.each([
    'Your haemoglobin is normal.',
    'Your blood pressure was a bit high last time.',
    'There is no risk from this.',
    'You should take two tablets tonight.',
    'Stop the iron tablet for now.',
    'This is nothing to worry about.',
    'This is likely due to anaemia.',
    'It is safe to continue.',
  ])('blocks interpretive or advice text: %s', (text) => {
    const r = checkAnswer(text, 'record', { sources: ['visits'] });
    expect(r).toEqual({ answer: REFER_ANSWER, kind: 'refer', sources: [], blocked: expect.any(String) });
  });

  it('blocks phone numbers and ids, but allows dates and times', () => {
    expect(checkAnswer('Call the OPD on 98765 43210.', 'record', { sources: ['hospital'] }).kind).toBe('refer');
    expect(checkAnswer('Your card number is MCH-2026-000101.', 'record', { sources: ['hospital'] }).kind).toBe('refer');
    expect(checkAnswer('The OPD line is 080 2345 6789.', 'record', { sources: ['hospital'] }).kind).toBe('refer');
    expect(checkAnswer('Your Td 2 vaccine is due on 2026-10-10 at 09:30.', 'record', { sources: ['vaccines'] }).kind).toBe('record');
  });

  it('blocks her known names', () => {
    const { known } = factsFromFamily(payload);
    expect(checkAnswer('Lakshmi, your visit is on 2026-10-08.', 'record', { sources: ['visits'], known }).kind).toBe('refer');
  });

  it('refuses ungrounded claims', () => {
    expect(checkAnswer('Your next visit is on 2026-10-08.', 'record').blocked).toBe('ungrounded');
    expect(checkAnswer('Your next visit is on 2026-10-08.', 'record', { sources: ['iron-foods'] }).blocked).toBe('ungrounded');
    expect(checkAnswer('Eat dates.', 'education', { sources: ['visits'] }).blocked).toBe('ungrounded');
    expect(checkAnswer('x'.repeat(701), 'record', { sources: ['visits'] }).blocked).toBe('length');
  });

  it('urgent and refer always carry the fixed text', () => {
    expect(checkAnswer('Probably fine, rest at home.', 'urgent')).toEqual({ answer: URGENT_ANSWER, kind: 'urgent', sources: [], blocked: null });
    expect(checkAnswer('Drink more water and rest.', 'refer').answer).toBe(REFER_ANSWER);
    expect(EMPTY_ANSWER).toMatch(/Ask the hospital to call me/);
  });

  it('allows advice words only inside a quote copied verbatim from a card', () => {
    const grounded = ['You should eat green leafy vegetables every day.'];
    expect(checkAnswer('The Iron-rich foods card says "you should eat green leafy vegetables every day".', 'education', { sources: ['iron-foods'], grounded }).kind).toBe('education');
    expect(checkAnswer('The card says "you should take more iron tablets".', 'education', { sources: ['iron-foods'], grounded }).kind).toBe('refer');
  });
});

describe('finalizeAnswer', () => {
  const { facts, refs, known } = factsFromFamily(payload);
  const topics = [{ id: 'iron-foods', title: 'Iron-rich foods', text: 'Green leafy vegetables, jaggery and dates.' }];
  const ctx = { refs, facts, topics, known };

  it('maps fact refs to record kinds and topic ids to themselves, and removes inline markers', () => {
    const r = finalizeAnswer({ answer: 'Your next visit is booked for 2026-10-08 10:00 [V1].', kind: 'record', sources: ['V1', 'A1', 'topic:iron-foods'] }, ctx);
    expect(r).toEqual({ answer: 'Your next visit is booked for 2026-10-08 10:00.', kind: 'record', sources: ['visits', 'appointments', 'iron-foods'], blocked: null });
  });

  it('an unknown citation or a malformed reply becomes the refer text', () => {
    expect(finalizeAnswer({ answer: 'Visit on 2026-10-08.', kind: 'record', sources: ['V9'] }, ctx).blocked).toBe('ungrounded');
    expect(finalizeAnswer({ answer: 'Visit on 2026-10-08.', kind: 'diagnosis', sources: [] }, ctx).blocked).toBe('shape');
    expect(finalizeAnswer(null, ctx).kind).toBe('refer');
  });
});

describe('parseAsk', () => {
  it('trims and validates', () => {
    expect(parseAsk({ question: '  When is my visit?  ' })).toEqual({ question: 'When is my visit?', topics: [] });
    expect(parseAsk({ question: '   ' })).toHaveProperty('error');
    expect(parseAsk({ question: 'x'.repeat(501) })).toHaveProperty('error');
    expect(parseAsk({ question: 'q', topics: [{ id: 'a', title: 't', text: 'x', extra: 1 }] })).toHaveProperty('error');
    expect(parseAsk({ question: 'q', topics: Array.from({ length: 41 }, (_, i) => ({ id: `t${i}`, title: 't', text: 'x' })) })).toHaveProperty('error');
    expect(parseAsk({ question: 'q', topics: [{ id: 'x'.repeat(61), title: 't', text: 'x' }] })).toHaveProperty('error');
  });

  it('formats appointment times in India time', () => {
    expect(istDateTime('2026-10-08T04:30:00Z')).toBe('2026-10-08 10:00');
    expect(istDateTime(null)).toBe('');
  });
});
