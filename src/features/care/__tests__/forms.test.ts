import { eddFromLmp } from '@domain/gestation';

import {
  assignDoctorSchema,
  captureSchema,
  closeCallbackSchema,
  dischargeItemResolved,
  dischargeReasonSchema,
  eddOptions,
  makeAdmitSchema,
  makeDeathSchema,
  makeDeliverySchema,
  makeDischargeTimeSchema,
  makeEndAdmissionSchema,
  makeObserveSchema,
  makeRegisterSchema,
  makeTagsSchema,
  makeVaccineDoseSchema,
  makeVisitSchema,
  noteSchema,
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
  const EDD = new Date('2026-10-20T00:00:00Z');
  const schema = makeDeliverySchema(NOW, EDD);
  const baby = {
    sex: 'F' as const, weight: '2900', length: '49.5', head: '', apgar1: '8', apgar5: '9', outcome: 'live' as const,
    resuscitation: false, defects: '', breastfed: true, vitaminK: true, birthDoses: true,
  };
  const base = {
    date: '01-10-2026', time: '22:15', place: 'This facility' as const, onset: 'Induced', mode: 'LSCS (emergency)', indication: ' Fetal distress ',
    loss: '600', perineum: 'Not applicable (LSCS)', perineumOther: '', complications: [], complicationsNote: '', medicines: ['Oxytocin'], medicinesNote: '',
    maternalCondition: ' Stable ', attendedBy: 'Dr. Priya', count: '1' as const, babies: [baby, { ...baby, sex: undefined, weight: '' }],
  };

  it('takes the exact time of birth and every documented field', () => {
    const out = schema.parse(base);
    expect(out.at).toEqual(new Date(2026, 9, 1, 22, 15));
    expect(out).toMatchObject({
      place: 'this_facility', labourOnset: 'induced', mode: 'LSCS (emergency)', indication: 'Fetal distress', bloodLossMl: 600,
      perineum: 'Not applicable (LSCS)', maternalCondition: 'Stable', attendedBy: 'Dr. Priya',
    });
    expect(out.babies).toEqual([
      { sex: 'F', birthWeightG: 2900, lengthCm: 49.5, headCircCm: undefined, apgar1: 8, apgar5: 9, outcome: 'live', stillbirthType: undefined,
        resuscitation: false, birthDefects: undefined, breastfedWithin1h: true, vitaminK: true, birthDoses: true },
    ]);
  });

  it('refuses an unreadable, impossible or future time', () => {
    expect(messages(schema.safeParse({ ...base, time: '25:00' }))).toEqual(['time: Enter the date as DD-MM-YYYY and the time as HH:MM (24-hour).']);
    expect(schema.safeParse({ ...base, date: '31-02-2026' }).success).toBe(false);
    expect(messages(schema.safeParse({ ...base, date: '03-10-2026' }))).toEqual(['time: The time of birth cannot be in the future.']);
    expect(messages(schema.safeParse({ ...base, date: '01-01-2026' }))).toEqual(['date: Check the date: it gives a gestation outside 20–46 weeks for this EDD.']);
  });

  it('needs a mode, sex and a birth weight for each baby, and notes for "Other"', () => {
    expect(messages(schema.safeParse({ ...base, mode: undefined, count: '2' }))).toEqual([
      'mode: Please choose the mode of delivery.',
      'babies.1.sex: Baby 2: choose the sex (or Undetermined).',
      'babies.1.weight: Baby 2: birth weight 200–7000 g.',
    ]);
    expect(schema.safeParse({ ...base, babies: [{ ...baby, weight: '150' }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, complications: ['Other'] }).success).toBe(false);
    expect(schema.parse({ ...base, complications: ['Other'], complicationsNote: ' Shoulder dystocia ' }).complicationsNote).toBe('Shoulder dystocia');
  });

  it('keeps stillbirth details and drops newborn-care fields for a stillborn baby', () => {
    const out = schema.parse({ ...base, babies: [{ ...baby, sex: 'U' as const, outcome: 'stillbirth' as const, stillbirthType: 'macerated' as const }] });
    expect(out.babies[0]).toMatchObject({ sex: 'U', outcome: 'stillbirth', stillbirthType: 'macerated', breastfedWithin1h: undefined, vitaminK: undefined, birthDoses: false });
  });

  it('a stillborn baby may have no birth weight; a liveborn baby must', () => {
    const still = { ...baby, outcome: 'stillbirth' as const, weight: '' };
    expect(schema.parse({ ...base, babies: [still] }).babies[0]!.birthWeightG).toBeUndefined();
    expect(schema.safeParse({ ...base, babies: [{ ...still, weight: '90' }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, babies: [{ ...baby, weight: '' }] }).success).toBe(false);
  });

  it('perineum "Other" is stored as the text written', () => {
    expect(messages(schema.safeParse({ ...base, perineum: 'Other' }))).toEqual(['perineumOther: Describe the perineum as documented.']);
    expect(schema.parse({ ...base, perineum: 'Other', perineumOther: ' Labial tear ' }).perineum).toBe('Labial tear');
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

  it('newborn observation: at its time, impossible numbers flagged (server limits), at least one value, stored as entered', () => {
    const dob = new Date(2026, 9, 1, 22, 15);
    const observe = makeObserveSchema(new Date(2026, 9, 2, 14, 0), dob);
    const empty = { date: '02-10-2026', time: '09:30', weight: '', length: '', head: '', temp: '', rr: '', feeding: undefined, jaundice: undefined, note: '' };
    expect(messages(observe.safeParse({ ...empty, weight: '150' }))).toEqual(['weight: Check value']);
    expect(observe.safeParse({ ...empty, weight: '15000' }).success).toBe(true); // a toddler's weight is possible (server: 200–20000 g)
    expect(messages(observe.safeParse(empty))).toEqual(['feeding: Record at least one observation']);
    expect(messages(observe.safeParse({ ...empty, weight: '3100', date: '01-10-2026', time: '21:00' }))).toEqual(['time: An observation cannot be before the time of birth.']);
    expect(observe.parse({ ...empty, weight: '3100', length: '50,5', head: '34', temp: '36,8', feeding: 'Breastfeeding', note: ' calm ' })).toEqual({
      at: new Date(2026, 9, 2, 9, 30), weightG: 3100, lengthCm: 50.5, headCircCm: 34, tempC: 36.8, respRate: undefined, feeding: 'Breastfeeding', jaundice: undefined, note: 'calm',
    });
  });

  it('admission and its end: exact time, not in the future, not ending before it began', () => {
    const now = new Date(2026, 9, 2, 14, 0);
    expect(makeAdmitSchema(now).parse({ date: '02-10-2026', time: '06:40', reason: ' In labour ' })).toEqual({ at: new Date(2026, 9, 2, 6, 40), reason: 'In labour' });
    expect(messages(makeAdmitSchema(now).safeParse({ date: '02-10-2026', time: '16:00', reason: '' }))).toEqual(['time: The time cannot be in the future.']);
    const end = makeEndAdmissionSchema(now, new Date(2026, 9, 2, 6, 40));
    expect(messages(end.safeParse({ date: '02-10-2026', time: '05:00' }))).toEqual(['time: The admission cannot end before it began.']);
    expect(end.parse({ date: '02-10-2026', time: '12:00' })).toEqual({ at: new Date(2026, 9, 2, 12, 0) });
  });

  it("a baby's death on the day of birth: never before the time of birth", () => {
    const dob = new Date(2026, 9, 2, 3, 10);
    const death = makeDeathSchema(new Date(2026, 9, 2, 14, 0), dob);
    expect(messages(death.safeParse({ date: '02-10-2026', time: '02:00', note: '' }))).toEqual(['time: The time of death cannot be before the time of birth.']);
    expect(death.parse({ date: '02-10-2026', time: '03:40', note: ' ' })).toEqual({ at: new Date(2026, 9, 2, 3, 40), note: undefined });
  });

  it('discharge: completion time after the birth; N/A / Defer need a discharge reason, "Other" its text', () => {
    const t = makeDischargeTimeSchema(new Date(2026, 9, 4, 10, 0), new Date(2026, 9, 2, 3, 10));
    expect(t.safeParse({ date: '01-10-2026', time: '10:00' }).success).toBe(false);
    expect(t.parse({ date: '04-10-2026', time: '09:15' })).toEqual({ at: new Date(2026, 9, 4, 9, 15) });
    expect(messages(dischargeReasonSchema.safeParse({ reason: undefined, other: '' }))).toEqual(['reason: Choose a reason.']);
    expect(messages(dischargeReasonSchema.safeParse({ reason: 'Other', other: ' ' }))).toEqual(['other: Write the reason.']);
    expect(dischargeReasonSchema.parse({ reason: 'Other', other: ' Family travelling ' })).toEqual({ reason: 'Other: Family travelling' });
    expect(dischargeReasonSchema.parse({ reason: 'Baby in NICU', other: '' })).toEqual({ reason: 'Baby in NICU' });
  });

  it('vaccine dose: given between birth and today (early allowed), here or elsewhere, or not given with a reason', () => {
    const dose = makeVaccineDoseSchema(new Date(2026, 9, 20, 10, 0), new Date(2026, 9, 2, 3, 10));
    const given = { outcome: 'given' as const, givenOn: '20-10-2026', where: 'here' as const, location: '', batch: ' B-1 ', expiry: '', manufacturer: '', site: 'Left thigh', route: undefined, reason: undefined, reasonOther: '' };
    expect(dose.parse(given)).toEqual({
      action: 'given', givenOn: new Date(Date.UTC(2026, 9, 20)), here: true, location: undefined, batch: 'B-1', expiryOn: undefined, manufacturer: undefined, site: 'Left thigh', route: undefined,
    });
    expect(messages(dose.safeParse({ ...given, givenOn: '21-10-2026' }))).toEqual(['givenOn: The date given cannot be in the future.']);
    expect(messages(dose.safeParse({ ...given, givenOn: '01-10-2026' }))).toEqual(['givenOn: The date given cannot be before the birth.']);
    expect(messages(dose.safeParse({ ...given, expiry: '01-10-2026' }))).toEqual(['expiry: The expiry date is before the date given — check it.']);
    expect(messages(dose.safeParse({ ...given, where: 'elsewhere' }))).toEqual(['location: Say where it was given (e.g. sub-centre, from the MCP card).']);
    expect(dose.parse({ ...given, where: 'elsewhere', location: 'Sub-centre' })).toMatchObject({ here: false, location: 'Sub-centre' });
    expect(messages(dose.safeParse({ ...given, outcome: 'not_given' }))).toEqual(['reason: Choose why the dose was not given.']);
    expect(dose.parse({ ...given, outcome: 'not_given', reason: 'Other', reasonOther: ' Fever documented ' })).toEqual({ action: 'not_given', reason: 'Fever documented' });
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
