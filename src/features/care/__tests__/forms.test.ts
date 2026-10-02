import {
  blankPrevious,
  blankRegisterForm,
  captureSchema,
  closeCallbackSchema,
  dischargeItemResolved,
  dischargeReasonSchema,
  makeAdmitSchema,
  makeDeathSchema,
  makeDeliverySchema,
  makeDischargeTimeSchema,
  makeEndAdmissionSchema,
  makeObserveSchema,
  makeScheduleReferralSchema,
  pickerDay,
  referralReasonSchema,
  referralRecsSchema,
  makeAssignCareSchema,
  makeMotherSchema,
  makeRegisterSchema,
  motherFormValues,
  parseDayMonthYear,
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
  // The phone's local day for a picker (the schema turns it back into the UTC calendar day).
  const local = (iso: string) => pickerDay(new Date(`${iso}T00:00:00Z`));
  const valid: RegisterForm = {
    ...blankRegisterForm(NOW),
    name: ' Asha R ',
    age: '24',
    phone: '9000000099',
    lang: 'Kannada',
    lmp: local('2026-07-10'),
    lmpCertain: 'Certain',
    g: '2',
    p: '1',
    l: '1',
    a: '0',
    previous: [{ year: '2024', outcome: 'Live birth', mode: 'LSCS', weeks: '38', complications: 'PPH, ', note: ' District hospital ' }],
    conditions: ['Asthma', 'Other'],
    otherCondition: ' Thalassaemia trait ',
    allergies: 'Penicillin, , Sulfa',
    medicines: 'Thyroxine',
    blood: 'Unknown',
    height: '152',
    tags: ['prev_cs'],
    tagNote: ' On the referral letter ',
    intensity: 'enhanced',
  };

  it('accepts a complete registration and sends only what was entered', () => {
    const r = schema.safeParse(valid);
    expect(messages(r)).toEqual([]);
    const out = r.data!;
    expect(out.mother).toMatchObject({ name: 'Asha R', age: 24, phone: '9000000099', village: '', lang: 'kn', emergencyContact: { name: '', relation: '', phone: '' } });
    expect(out.mother.altPhone).toBeUndefined();
    expect(out.dating).toEqual({ method: 'lmp', lmp: new Date('2026-07-10T00:00:00Z'), lmpCertain: true, note: undefined });
    expect(out.registeredOn).toBe(NOW);
    expect(out.gpla).toEqual({ g: 2, p: 1, l: 1, a: 0 });
    expect(out.history).toEqual({ conditions: ['Asthma', 'Thalassaemia trait'], allergies: ['Penicillin', 'Sulfa'], medicines: ['Thyroxine'], bloodGroup: undefined, heightCm: 152 });
    // As documented: no invented year, outcome or mode.
    expect(out.previous).toEqual([{ year: 2024, outcome: 'Live birth', mode: 'LSCS', gestationWeeks: 38, complications: ['PPH'], note: 'District hospital' }]);
    expect(out.tagCodes).toEqual(['prev_cs']);
    expect(out.tagNote).toBe('On the referral letter');
    expect(out.fetuses).toBe(1);
  });

  it('mirrors the server bounds for her details', () => {
    expect(messages(schema.safeParse({ ...valid, name: ' ', age: '61', phone: '5123456789' }))).toEqual([
      'name: Enter her full name',
      'age: Age: a whole number from 10 to 60',
      'phone: Enter a 10-digit mobile number starting with 6, 7, 8 or 9',
    ]);
    expect(messages(schema.safeParse({ ...valid, age: '24.5' }))).toEqual(['age: Age: a whole number from 10 to 60']);
    expect(messages(schema.safeParse({ ...valid, age: '9' }))).toEqual(['age: Age: a whole number from 10 to 60']);
    expect(messages(schema.safeParse({ ...valid, name: 'x'.repeat(121) }))).toEqual(['name: Name: up to 120 characters']);
    expect(messages(schema.safeParse({ ...valid, altPhone: '9000000099' }))).toEqual(['altPhone: The alternate number must differ from her mobile']);
    expect(messages(schema.safeParse({ ...valid, pincode: '012345', rchId: '123', abhaAddress: 'Asha@ABDM' }))).toEqual([
      'pincode: PIN code: 6 digits, not starting with 0',
      'rchId: An RCH id has 12 digits',
      'abhaAddress: An ABHA address looks like name@abdm',
    ]);
    expect(messages(schema.safeParse({ ...valid, dobText: '31-02-1999' }))).toEqual(['dobText: Date of birth as DD-MM-YYYY']);
  });

  it('validates the emergency contact instead of dropping it, with its relation', () => {
    expect(messages(schema.safeParse({ ...valid, ecName: 'Ravi', ecPhone: '12345' }))).toEqual(['ecPhone: Emergency contact: 10 digits starting with 6, 7, 8 or 9']);
    expect(messages(schema.safeParse({ ...valid, ecRelation: 'Husband' }))).toEqual([
      "ecName: Add the emergency contact's name",
      'ecPhone: Emergency contact: 10 digits starting with 6, 7, 8 or 9',
    ]);
    const ok = schema.parse({ ...valid, ecName: ' Ravi K ', ecRelation: 'Husband', ecPhone: '9000000098', altPhone: '9000000097', husbandName: 'Ravi K', rchId: '100000000001' });
    expect(ok.mother).toMatchObject({ emergencyContact: { name: 'Ravi K', relation: 'Husband', phone: '9000000098' }, altPhone: '9000000097', husbandName: 'Ravi K', rchId: '100000000001' });
  });

  it('dates by LMP, scan or a clinician-decided EDD, refusing what the server refuses', () => {
    expect(messages(schema.safeParse({ ...valid, lmp: undefined }))).toEqual(['lmp: Pick the first day of her last period']);
    expect(messages(schema.safeParse({ ...valid, lmp: local('2026-10-05') }))).toEqual(['lmp: The LMP cannot be in the future']);
    expect(messages(schema.safeParse({ ...valid, lmp: local('2025-08-01') }))).toEqual(['lmp: This dating gives a gestational age outside 0–45 weeks on the registration date']);
    // A scan-only dating is a scan dating (never "LMP").
    const scan = schema.parse({ ...valid, lmp: undefined, method: 'Scan', scanOn: local('2026-09-30'), scanWeeks: '12', scanDays: '3', datingNote: ' Scan report ' });
    expect(scan.dating).toEqual({ method: 'scan', scanOn: new Date('2026-09-30T00:00:00Z'), gaAtScanDays: 87, note: 'Scan report' });
    expect(messages(schema.safeParse({ ...valid, method: 'Scan', scanWeeks: '3' }))).toEqual(['scanWeeks: GA at the scan: 4–42 weeks and 0–6 days']);
    expect(messages(schema.safeParse({ ...valid, method: 'Scan', scanWeeks: '12', scanDays: '7' }))).toEqual(['scanWeeks: GA at the scan: 4–42 weeks and 0–6 days']);
    const decided = schema.parse({ ...valid, method: 'Clinician EDD', eddDecided: local('2027-03-01') });
    expect(decided.dating).toEqual({ method: 'clinician', edd: new Date('2027-03-01T00:00:00Z'), note: undefined });
    expect(messages(schema.safeParse({ ...valid, method: 'Clinician EDD', eddDecided: local('2027-08-01') }))).toEqual([
      'eddDecided: This dating gives a gestational age outside 0–45 weeks on the registration date',
    ]);
  });

  it('back-dates a registration to noon of the chosen day, never into the future', () => {
    const r = schema.parse({ ...valid, registeredOn: local('2026-09-25') });
    expect(r.registeredOn.getDate()).toBe(25);
    expect(r.registeredOn.getHours()).toBe(12);
    expect(messages(schema.safeParse({ ...valid, registeredOn: local('2026-10-04') }))).toEqual(['registeredOn: The registration date cannot be in the future']);
  });

  it('checks the obstetric summary as whole numbers within the server ranges', () => {
    expect(messages(schema.safeParse({ ...valid, g: '1', p: '1' }))).toEqual(['g: P + A must be ≤ G − 1 for a current pregnancy']);
    expect(messages(schema.safeParse({ ...valid, g: '' }))).toEqual(['g: G: a whole number from 1 to 20']);
    expect(messages(schema.safeParse({ ...valid, g: '21' }))).toEqual(['g: G: a whole number from 1 to 20']);
    expect(messages(schema.safeParse({ ...valid, l: '1.5' }))).toEqual(['g: P, L and A: whole numbers from 0 to 20']);
  });

  it('checks previous pregnancies, history codes and height', () => {
    expect(messages(schema.safeParse({ ...valid, previous: [{ ...blankPrevious(), year: '1950', weeks: '50' }] }))).toEqual([
      'previous.0.year: Previous pregnancy 1: year 1960–2026',
      'previous.0.outcome: Previous pregnancy 1: choose the outcome',
      'previous.0.weeks: Previous pregnancy 1: gestation 4–45 weeks',
    ]);
    expect(messages(schema.safeParse({ ...valid, otherCondition: ' ' }))).toEqual(['otherCondition: Name the other condition as documented']);
    expect(messages(schema.safeParse({ ...valid, blood: 'B positive', height: '90' }))).toEqual(['blood: Choose a blood group', 'height: Height: 100–220 cm']);
  });

  it('needs her unit when the clinician has several', () => {
    const two = makeRegisterSchema(NOW, { units: ['u1', 'u2'] });
    expect(messages(two.safeParse(valid))).toEqual(['teamId: Choose her obstetric unit']);
    expect(two.parse({ ...valid, teamId: 'u2' }).teamId).toBe('u2');
  });

  it('a confirmed returning mother keeps her record id', () => {
    expect(schema.parse({ ...valid, returningId: 'mother-1' }).existingMotherId).toBe('mother-1');
  });

  it('refuses an impossible day instead of rolling it over', () => {
    expect(parseDayMonthYear('31-02-2026')).toBeUndefined();
    expect(parseDayMonthYear('29-02-2025')).toBeUndefined();
    expect(parseDayMonthYear('29-02-2028')).toEqual(new Date('2028-02-29T00:00:00Z'));
    expect(parseDayMonthYear('07/02/2026')).toEqual(new Date('2026-02-07T00:00:00Z'));
  });
});

describe('mother details schema', () => {
  it('turns the form back into her details, blank optional fields absent', () => {
    const values = motherFormValues({
      name: 'Lakshmi K', age: 24, phone: '9000000003', lang: 'kn', village: 'Hoskote', dob: new Date('2002-05-01T00:00:00Z'), dobEstimated: true,
      emergencyContact: { name: 'Ravi K', relation: 'Husband', phone: '9000000004' },
    });
    expect(values).toMatchObject({ age: '24', lang: 'Kannada', dobText: '01-05-2002', ecRelation: 'Husband', district: '' });
    const out = makeMotherSchema(NOW).parse({ ...values, district: ' Demo District ' });
    expect(out).toMatchObject({ name: 'Lakshmi K', age: 24, lang: 'kn', district: 'Demo District', dob: new Date('2002-05-01T00:00:00Z'), dobEstimated: true, altPhone: undefined });
    expect(messages(makeMotherSchema(NOW).safeParse({ ...values, phone: '' }))).toEqual(['phone: Enter a 10-digit mobile number starting with 6, 7, 8 or 9']);
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
    expect(schema.safeParse({ codes: ['gdm', 'prev_lscs', 'anaemia'], intensity: 'close', note: '' }).data).toEqual({ add: ['anaemia'], remove: [], intensity: 'close', note: undefined });
    expect(messages(schema.safeParse({ codes: ['gdm'], intensity: 'routine', note: '  ' }))).toEqual(['note: Please add a note explaining why a tag was removed.']);
    expect(schema.safeParse({ codes: ['gdm'], intensity: 'routine', note: 'Resolved' }).success).toBe(true);
  });

  it('sends only what changed, so a tag set by someone else meanwhile is kept', () => {
    const schema = makeTagsSchema(['gdm', 'prev_lscs']);
    expect(schema.parse({ codes: ['prev_lscs', 'heart'], intensity: 'routine', note: ' Resolved ' })).toEqual({ add: ['heart'], remove: ['gdm'], intensity: 'routine', note: 'Resolved' });
    expect(schema.parse({ codes: ['gdm', 'prev_lscs'], intensity: 'enhanced', note: '' })).toMatchObject({ add: [], remove: [] });
  });
});

describe('visit schema: counselling and fetal movements are kept', () => {
  it('passes counselling topics and fetal movements (as reported) to the visit', () => {
    const r = makeVisitSchema(30).parse({
      weight: '', sys: '', dia: '', pulse: '', fundal: '', fhr: '', ifa: false, complaints: [], otherComplaint: '', gaps: {},
      nextOn: new Date('2026-10-30T00:00:00Z'), counselling: ['Nutrition', 'Warning signs'], movements: 'Reduced',
    });
    expect(r.counselling).toEqual(['Nutrition', 'Warning signs']);
    expect(r.vitals.fetalMovements).toBe('Reduced');
    expect(r.checklist.counselling).toEqual({ state: 'done' });
  });
});

describe('referral schemas', () => {
  it('needs a department and a reason', () => {
    expect(messages(referSchema.safeParse({ dept: undefined, urgency: 'Routine', reason: 'x', question: '' }))).toEqual(['dept: Choose a department and add the reason.']);
    expect(referSchema.parse({ dept: 'Cardiology', urgency: 'Within 24 h', reason: ' Palpitations ', question: ' Fit? ' })).toEqual({ department: 'Cardiology', urgency: '24h', reason: 'Palpitations', question: 'Fit?' });
  });

  it('an appointment needs its exact date, time and place, not in the past (nothing is invented)', () => {
    const now = new Date(2026, 9, 2, 9, 0);
    const schema = makeScheduleReferralSchema(now);
    expect(messages(schema.safeParse({ date: '05-10-2026', time: '11:30', place: '  ' }))).toEqual(['place: Write where she should come (e.g. the OPD and room).']);
    expect(messages(schema.safeParse({ date: '01-10-2026', time: '11:30', place: 'Cardiology OPD' }))).toEqual(['time: The appointment cannot be in the past.']);
    expect(messages(schema.safeParse({ date: '5/10', time: '25:00', place: 'Cardiology OPD' }))).toEqual(['time: Enter the date as DD-MM-YYYY and the time as HH:MM (24-hour).']);
    expect(schema.parse({ date: '05-10-2026', time: '11:30', place: ' Cardiology OPD, room 4 ' })).toEqual({ scheduledAt: new Date(2026, 9, 5, 11, 30), place: 'Cardiology OPD, room 4' });
  });

  it('recommendations and a decline / cancel reason are required, never filled in', () => {
    expect(messages(referralRecsSchema.safeParse({ recs: ' ' }))).toEqual(['recs: Write the recommendations as documented']);
    expect(referralRecsSchema.parse({ recs: ' Echo documented. ' })).toEqual({ recommendations: 'Echo documented.' });
    expect(messages(referralReasonSchema.safeParse({ reason: '' }))).toEqual(['reason: Write the reason']);
    expect(referralReasonSchema.parse({ reason: ' No cardiology slot this month ' })).toEqual({ note: 'No cardiology slot this month' });
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

  it('reassigning a team needs a team, a change and a reason; notes are trimmed', () => {
    const schema = makeAssignCareSchema({ teamId: 'unit-a', staffId: 'priya' });
    expect(messages(schema.safeParse({ team: 'unit-a', doctor: 'priya', reason: 'x' }))).toEqual(['team: This is already the current team and doctor']);
    expect(messages(schema.safeParse({ team: '', doctor: '', reason: ' ' }))).toEqual(['team: Choose a team', 'reason: Add the reason']);
    expect(schema.parse({ team: 'unit-a', doctor: '', reason: ' Team follow-up ' })).toEqual({ teamId: 'unit-a', staffId: undefined, reason: 'Team follow-up' });
    expect(schema.parse({ team: 'unit-b', doctor: 'neha', reason: 'Moved' })).toEqual({ teamId: 'unit-b', staffId: 'neha', reason: 'Moved' });
    expect(noteSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(noteSchema.parse({ body: ' Echo reviewed ' })).toEqual({ body: 'Echo reviewed' });
  });
});
