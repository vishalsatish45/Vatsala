import { addDays } from '@domain/gestation';
import { asBabyId, asMotherId, asPregnancyId } from '../ids';

import {
  caregiverScopesPayload,
  datingPayload,
  eddFor,
  eiePayload,
  mchIdIn,
  notificationsReadPayload,
  overrideActive,
  prescribePayload,
  prescriptionProblem,
  reasonOk,
  redateProblem,
} from '../payloads';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const now = new Date('2026-10-02T09:00:00Z');

describe('re-dating', () => {
  it('derives the EDD by calendar arithmetic only', () => {
    expect(eddFor({ method: 'lmp', lmp: day('2026-06-01') })).toEqual(day('2027-03-08'));
    // scan on 2 Oct at 12+0 weeks (84 days) → 196 days to go
    expect(eddFor({ method: 'scan', scanOn: day('2026-10-02'), gaAtScanDays: 84 })).toEqual(addDays(day('2026-10-02'), 196));
    expect(eddFor({ method: 'clinician', edd: day('2027-04-01') })).toEqual(day('2027-04-01'));
  });

  it('sends exactly the dating keys of the chosen method', () => {
    expect(datingPayload({ method: 'lmp', lmp: day('2026-06-01'), note: '  ' })).toEqual({ method: 'lmp', lmp: '2026-06-01', edd: '2027-03-08', note: undefined });
    expect(datingPayload({ method: 'scan', scanOn: day('2026-10-02'), gaAtScanDays: 84, note: 'Dating scan' })).toEqual({
      method: 'scan',
      scan_on: '2026-10-02',
      ga_at_scan_days: 84,
      edd: '2027-04-16',
      note: 'Dating scan',
    });
    expect(datingPayload({ method: 'clinician', edd: day('2027-04-01') })).toEqual({ method: 'clinician', edd: '2027-04-01', note: undefined });
  });

  it('checks only what the database also enforces', () => {
    expect(redateProblem({ method: 'lmp', lmp: day('2026-10-05') }, now)).toMatch(/future/);
    expect(redateProblem({ method: 'scan', scanOn: day('2026-10-01'), gaAtScanDays: 20 }, now)).toMatch(/gestational age/);
    expect(redateProblem({ method: 'scan', scanOn: day('2026-10-01'), gaAtScanDays: Number.NaN }, now)).toBeDefined();
    expect(redateProblem({ method: 'scan', scanOn: day('2026-10-01'), gaAtScanDays: 90 }, now)).toBeUndefined();
    expect(redateProblem({ method: 'clinician', edd: day('2026-09-01') }, now)).toMatch(/past/);
  });
});

describe('prescriptions', () => {
  it('maps one subject, trims free text and orders slots morning → night', () => {
    expect(prescribePayload('rx1', { babyId: asBabyId('b1') }, { name: ' Syrup X ', dose: '', slots: ['night', 'morning'], instructions: ' after feeds ' }, now)).toEqual({
      id: 'rx1',
      baby_id: 'b1',
      name: 'Syrup X',
      dose: undefined,
      slots: ['morning', 'night'],
      instructions: 'after feeds',
      start_on: '2026-10-02',
    });
    const p = prescribePayload('rx2', { pregnancyId: asPregnancyId('p1') }, { name: 'Tab Y', slots: ['afternoon'] }, now);
    expect(p).toMatchObject({ pregnancy_id: 'p1', slots: ['afternoon'] });
    expect(p).not.toHaveProperty('baby_id');
  });

  it('needs a medicine and a time of day', () => {
    expect(prescriptionProblem({ name: ' ', slots: ['morning'] })).toBeDefined();
    expect(prescriptionProblem({ name: 'Tab Y', slots: [] })).toBeDefined();
    expect(prescriptionProblem({ name: 'Tab Y', slots: ['night'] })).toBeUndefined();
  });
});

describe('small payloads', () => {
  it('entered in error carries kind, id, a trimmed reason and the time', () => {
    expect(eiePayload('care_note', 'n1', ' Wrong patient ', now)).toEqual({ kind: 'care_note', id: 'n1', reason: 'Wrong patient', at: now.toISOString() });
    expect(reasonOk('ab')).toBe(false);
    expect(reasonOk(' abc ')).toBe(true);
  });

  it('caregiver scopes state every scope', () => {
    expect(caregiverScopesPayload({ schedule: true, baby: false, logs: false, tests: true })).toEqual({ schedule: true, baby: false, logs: false, tests: true });
  });

  it('notifications are read by id or all at once', () => {
    expect(notificationsReadPayload(['a', 'b'])).toEqual({ ids: ['a', 'b'] });
    expect(notificationsReadPayload('all')).toEqual({ all: true });
  });

  it('finds an MCH id in typed or scanned text', () => {
    expect(mchIdIn('mch-2026-000123')).toBe('MCH-2026-000123');
    expect(mchIdIn('{"id":"MCH-2026-000123-B1"}')).toBe('MCH-2026-000123');
    expect(mchIdIn('Lakshmi')).toBeUndefined();
  });

  it('an override counts until it expires', () => {
    const o = { id: 'o', motherId: asMotherId('m'), reason: 'r', grantedAt: now, expiresAt: new Date(now.getTime() + 3_600_000) };
    expect(overrideActive(o, now)).toBe(true);
    expect(overrideActive(o, new Date(now.getTime() + 2 * 3_600_000))).toBe(false);
  });
});
