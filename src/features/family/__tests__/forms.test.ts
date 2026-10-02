import { blankSelfLog, callbackRequestSchema, caregiverSchema, selfLogSchema, selfLogValue } from '../forms';

describe('self-log schema', () => {
  it('stores readings as typed, never graded', () => {
    expect(selfLogValue({ ...blankSelfLog, sys: '150', dia: '' })).toBe('');
    expect(selfLogSchema.parse({ ...blankSelfLog, sys: '150', dia: '100' })).toEqual({ kind: 'bp', value: '150/100', isChoice: false, subject: 'mother' });
    expect(selfLogSchema.parse({ ...blankSelfLog, kind: 'weight', kg: '62.4' }).value).toBe('62.4 kg');
    expect(selfLogSchema.parse({ ...blankSelfLog, kind: 'contractions', count: '4' }).value).toBe('4 in last hour');
    expect(selfLogSchema.parse({ ...blankSelfLog, kind: 'feeding', choice: 'family.log.feedWell' })).toEqual({ kind: 'feeding', value: 'family.log.feedWell', isChoice: true, subject: 'baby' });
  });

  it('needs a complete reading for the chosen kind', () => {
    expect(selfLogSchema.safeParse(blankSelfLog).success).toBe(false);
    expect(selfLogSchema.safeParse({ ...blankSelfLog, kind: 'movements', kg: '60' }).success).toBe(false);
  });
});

describe('caregiver schema', () => {
  const valid = { name: ' Ravi ', relation: 'husband' as const, phone: '9800000001', scopes: { schedule: true, baby: true, logs: false } };

  it('accepts a named relative with a mobile number', () => {
    expect(caregiverSchema.parse(valid)).toEqual({ ...valid, name: 'Ravi' });
  });

  it('rejects a missing name, relation or a wrong number', () => {
    const r = caregiverSchema.safeParse({ ...valid, name: 'R', relation: undefined, phone: '12345' });
    expect(r.error?.issues.map((i) => i.path[0])).toEqual(['name', 'relation', 'phone']);
  });
});

describe('call-back request schema', () => {
  it('may be sent with only a voice note or nothing typed; a blank note is dropped', () => {
    expect(callbackRequestSchema.parse({ signs: ['bleeding'], note: '  ', voice: undefined })).toEqual({ signs: ['bleeding'], note: undefined, voice: undefined });
    expect(callbackRequestSchema.parse({ signs: [], note: ' help ', voice: { uri: 'file://a.m4a', seconds: 4 } }).note).toBe('help');
  });
});
