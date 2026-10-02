import { eddFromLmp } from '@domain/gestation';

import {
  assignDoctorSchema,
  captureSchema,
  closeCallbackSchema,
  dischargeItemResolved,
  eddOptions,
  makeDeliverySchema,
  makeRegisterSchema,
  makeTagsSchema,
  makeVisitSchema,
  noteSchema,
  observeSchema,
  referSchema,
  resultSchema,
  reviewSchema,
  taskOutcomeSchema,
  type RegisterForm,
  type VisitForm,
} from '../forms';

const NOW = new Date('2026-10-02T09:00:00Z');
const messages = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('register schema', () => {
  const schema = makeRegisterSchema(NOW);
  const valid: RegisterForm = {
    name: ' Asha R ',
    age: '24',
    phone: '9000000099',
    village: '',
    lang: 'Kannada',
    ecName: '',
    ecPhone: '',
    lmpText: '07-02-2026',
    scanWeeks: '',
    eddSource: 'lmp',
    g: '2',
    p: '1',
    l: '1',
    a: '0',
    previous: ['LSCS'],
    conditions: ['Asthma'],
    allergies: 'Penicillin, , Sulfa',
    blood: 'Unknown',
    tags: ['prev_lscs'],
    intensity: 'enhanced',
  };

  it('accepts a complete registration and shapes the store input', () => {
    const r = schema.safeParse(valid);
    expect(messages(r)).toEqual([]);
    const out = r.data!;
    expect(out.mother).toEqual({ name: 'Asha R', age: 24, phone: '9000000099', village: '—', lang: 'kn', emergencyContact: { name: '—', relation: 'Family', phone: '—' } });
    expect(out.edd).toEqual(eddFromLmp(new Date(Date.UTC(2026, 1, 7))));
    expect(out.eddSource).toBe('lmp');
    expect(out.gpla).toEqual({ g: 2, p: 1, l: 1, a: 0 });
    expect(out.history).toEqual({ conditions: ['Asthma'], allergies: ['Penicillin', 'Sulfa'], medicines: [], bloodGroup: undefined });
    expect(out.previous).toEqual([{ year: 2024, outcome: 'Live birth', mode: 'LSCS' }]);
    expect(out.tagCodes).toEqual(['prev_lscs']);
    expect(out.intensity).toBe('enhanced');
  });

  it('rejects a short name, a missing age and a non-Indian mobile', () => {
    expect(messages(schema.safeParse({ ...valid, name: 'A', age: '', phone: '5123456789' }))).toEqual([
      'name: Enter her full name',
      'age: Enter her age',
      'phone: Enter a 10-digit mobile number',
    ]);
  });

  it('needs an EDD from the LMP or a dating scan', () => {
    expect(messages(schema.safeParse({ ...valid, lmpText: '7 Feb' }))).toEqual(['lmpText: Enter the LMP or the GA by dating scan']);
    const byScan = schema.safeParse({ ...valid, lmpText: '', scanWeeks: '12', eddSource: 'scan' });
    expect(byScan.data?.eddSource).toBe('scan');
    expect(eddOptions({ lmpText: '', scanWeeks: '45', eddSource: 'scan' }, NOW).edd).toBeUndefined();
  });

  it('checks the obstetric summary is consistent for a current pregnancy', () => {
    expect(messages(schema.safeParse({ ...valid, g: '1', p: '1' }))).toEqual(['g: P + A must be ≤ G − 1 for a current pregnancy']);
  });
});

describe('visit schema', () => {
  const blank: VisitForm = {
    weight: '',
    sys: '',
    dia: '',
    pulse: '',
    fundal: '',
    fhr: '',
    ifa: false,
    counselling: [],
    complaints: [],
    otherComplaint: '',
    nextOn: new Date('2026-10-30T00:00:00Z'),
    gaps: {},
  };

  it('keeps values exactly as entered (no thresholds beyond "physically possible")', () => {
    const r = makeVisitSchema(30).safeParse({ ...blank, weight: '62,5', sys: '150', dia: '100', fhr: '144', albumin: '2+', complaints: ['Headache', 'Other'], otherComplaint: ' dizzy ' });
    expect(messages(r)).toEqual([]);
    expect(r.data!.vitals).toMatchObject({ weightKg: 62.5, bpSys: 150, bpDia: 100, fhr: 144, urineAlbumin: '2+' });
    expect(r.data!.complaints).toEqual(['Headache', 'Other: dizzy']);
    expect(r.data!.checklist.bp).toEqual({ state: 'done' });
    expect(r.data!.checklist.ifa).toEqual({ state: 'not_done', reason: 'Not recorded' });
  });

  it('flags impossible numbers with "Check value"', () => {
    expect(messages(makeVisitSchema(30).safeParse({ ...blank, weight: '700', sys: '20', dia: 'abc', fhr: '300' }))).toEqual([
      'weight: Check value',
      'sys: Check value',
      'dia: Check value',
      'fhr: Check value',
    ]);
  });

  it('records the clinician’s N/A and not-done marks for components left empty', () => {
    const r = makeVisitSchema(30).safeParse({ ...blank, gaps: { ifa: { state: 'na' }, weight: { state: 'not_done', reason: 'Kit unavailable' } } });
    expect(r.data!.checklist.ifa).toEqual({ state: 'na' });
    expect(r.data!.checklist.weight).toEqual({ state: 'not_done', reason: 'Kit unavailable' });
  });
});

describe('tags schema', () => {
  it('needs a note only when a tag is removed', () => {
    const schema = makeTagsSchema(['gdm', 'prev_lscs']);
    expect(schema.safeParse({ codes: ['gdm', 'prev_lscs', 'anaemia'], intensity: 'close', note: '' }).data).toEqual({ codes: ['gdm', 'prev_lscs', 'anaemia'], intensity: 'close', note: undefined });
    expect(messages(schema.safeParse({ codes: ['gdm'], intensity: 'routine', note: '  ' }))).toEqual(['note: Please add a note explaining why a tag was removed.']);
    expect(schema.safeParse({ codes: ['gdm'], intensity: 'routine', note: 'Resolved' }).success).toBe(true);
  });
});

describe('referral schemas', () => {
  it('needs a department and a reason', () => {
    expect(messages(referSchema.safeParse({ dept: undefined, urgency: 'Routine', reason: 'x', question: '' }))).toEqual(['dept: Choose a department and add the reason.']);
    expect(referSchema.parse({ dept: 'Cardiology', urgency: 'Within 24 h', reason: ' Palpitations ', question: ' Fit? ' })).toEqual({ department: 'Cardiology', urgency: '24h', reason: 'Palpitations', question: 'Fit?' });
  });
});

describe('delivery schema', () => {
  const schema = makeDeliverySchema(NOW);
  const baby = { sex: 'F' as const, weight: '2900', apgar1: '8', apgar5: '9', outcome: 'live' as const, birthDoses: true };
  const base = { when: '3 h ago' as const, mode: 'LSCS (emergency)', indication: ' Fetal distress ', loss: '600', complications: [], medicines: ['Oxytocin'], count: '1' as const, babies: [baby, { ...baby, sex: undefined, weight: '' }] };

  it('builds the delivery input for the chosen number of babies', () => {
    const out = schema.parse(base);
    expect(out.at).toEqual(new Date('2026-10-02T06:00:00Z'));
    expect(out).toMatchObject({ mode: 'LSCS (emergency)', indication: 'Fetal distress', bloodLossMl: 600 });
    expect(out.babies).toEqual([{ sex: 'F', birthWeightG: 2900, apgar1: 8, apgar5: 9, outcome: 'live', birthDoses: true }]);
  });

  it('needs a mode, and sex and a birth weight for each baby', () => {
    expect(messages(schema.safeParse({ ...base, mode: undefined, count: '2' }))).toEqual([
      'mode: Please choose the mode of delivery.',
      'babies.1.weight: Each baby needs sex and a birth weight between 300 and 6000 g.',
    ]);
    expect(schema.safeParse({ ...base, babies: [{ ...baby, weight: '250' }] }).success).toBe(false);
  });
});

describe('small care forms', () => {
  it('investigation result, not-done and review', () => {
    expect(resultSchema.safeParse({ value: '  ', note: '' }).success).toBe(false);
    expect(resultSchema.parse({ value: ' 11.2 g/dL ', note: ' ' })).toEqual({ value: '11.2 g/dL', note: undefined });
    expect(reviewSchema.safeParse({ followUp: undefined }).success).toBe(false);
    expect(reviewSchema.parse({ followUp: 'Refer' })).toEqual({ followUp: 'Refer' });
  });

  it('task and call-back outcomes are required', () => {
    expect(taskOutcomeSchema.safeParse({ outcome: undefined, inDays: undefined }).success).toBe(false);
    expect(closeCallbackSchema.parse({ outcome: 'Information given', note: ' ok ' })).toEqual({ outcome: 'Information given', note: 'ok' });
  });

  it('newborn observation: impossible numbers flagged, at least one value, stored as entered', () => {
    expect(messages(observeSchema.safeParse({ weight: '50', temp: '', rr: '', feeding: undefined, jaundice: undefined }))).toEqual(['weight: Check value']);
    expect(messages(observeSchema.safeParse({ weight: '', temp: '', rr: '', feeding: undefined, jaundice: undefined }))).toEqual(['feeding: Record at least one observation']);
    expect(observeSchema.parse({ weight: '3100', temp: '36,8', rr: '', feeding: 'Breastfeeding', jaundice: undefined })).toEqual({ weightG: 3100, tempC: 36.8, respRate: undefined, feeding: 'Breastfeeding', jaundice: undefined });
  });

  it('discharge items resolve only when done, or N/A / deferred with a reason', () => {
    expect(dischargeItemResolved.safeParse({ key: 'bf', label: 'x', state: 'done' }).success).toBe(true);
    expect(dischargeItemResolved.safeParse({ key: 'bf', label: 'x', state: 'na' }).success).toBe(false);
    expect(dischargeItemResolved.safeParse({ key: 'bf', label: 'x', state: 'deferred', reason: 'Other' }).success).toBe(true);
    expect(dischargeItemResolved.safeParse({ key: 'bf', label: 'x' }).success).toBe(false);
  });

  it('paper capture saves only with a confirmed field', () => {
    const f = { key: 'bp', label: 'BP', value: '128/82', confidence: 0.9, confirmed: false };
    expect(captureSchema.safeParse({ fields: [f] }).success).toBe(false);
    expect(captureSchema.safeParse({ fields: [{ ...f, confirmed: true }] }).success).toBe(true);
  });

  it('assign doctor needs a doctor and a reason; notes are trimmed', () => {
    expect(assignDoctorSchema.safeParse({ doctor: 'Dr. Meera S', reason: ' ' }).success).toBe(false);
    expect(assignDoctorSchema.parse({ doctor: 'Dr. Meera S', reason: ' Covering ' })).toEqual({ doctor: 'Dr. Meera S', reason: 'Covering' });
    expect(noteSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(noteSchema.parse({ body: ' Echo reviewed ' })).toEqual({ body: 'Echo reviewed' });
  });
});
