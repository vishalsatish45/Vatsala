import fs from 'fs';
import path from 'path';

import type { Investigation, MedDose, Prescription } from '@/data/types';
import { asInvestigationId, asMotherId, asPregnancyId, asPrescriptionId } from '@/data/ids';

import { dosesToday, familyMedsFrom } from '../meds';
import { FAMILY_ROUTES } from '../routes';
import { birthHappened, familyStage, infoSignStages, isPregnant, localDaysBetween, readingKinds, requestSignStages, todayIso } from '../stage';
import { familyTestStatus, familyTests } from '../tests';

const ALL = { schedule: true, baby: true, logs: true, tests: true };
const NONE = { schedule: false, baby: false, logs: false, tests: false };

describe('family stage', () => {
  it('a delivered episode the hospital has closed is still a birth (not a pregnancy, not a loss)', () => {
    expect(birthHappened({ status: 'delivered' })).toBe(true);
    expect(birthHappened({ status: 'closed', endReason: 'delivered' })).toBe(true);
    expect(birthHappened({ status: 'closed', endReason: 'miscarriage' })).toBe(false);
    expect(familyStage({ status: 'closed', endReason: 'delivered' }, 1, true)).toBe('baby');
  });

  it('week counters only while pregnant', () => {
    expect(isPregnant({ status: 'active' })).toBe(true);
    expect(isPregnant({ status: 'admitted' })).toBe(true);
    expect(isPregnant({ status: 'delivered' })).toBe(false);
    expect(isPregnant({ status: 'closed', endReason: 'miscarriage' })).toBe(false);
    expect(isPregnant(undefined)).toBe(false);
  });

  it('a loss: no living baby after a birth, or a pregnancy that ended without one', () => {
    expect(familyStage({ status: 'delivered' }, 0, true)).toBe('loss');
    expect(familyStage({ status: 'closed', endReason: 'miscarriage' }, 0, true)).toBe('loss');
    // Also for a caregiver without the baby scope: the episode itself says it ended without a birth.
    expect(familyStage({ status: 'closed', endReason: 'miscarriage' }, 0, false)).toBe('loss');
  });

  it('a caregiver without the baby scope never sees the loss screen after a birth (babies not shared)', () => {
    expect(familyStage({ status: 'delivered' }, 0, false)).toBe('notShared');
    expect(familyStage({ status: 'closed', endReason: 'delivered' }, 0, false)).toBe('notShared');
  });

  it('none / pregnant', () => {
    expect(familyStage(undefined, 0, true)).toBe('none');
    expect(familyStage({ status: 'active' }, 0, false)).toBe('pregnant');
  });
});

describe('warning signs and readings by stage', () => {
  it('baby signs only with a living baby the family may see', () => {
    expect(requestSignStages('baby')).toEqual(['postnatal', 'baby']);
    expect(requestSignStages('loss')).toEqual(['postnatal']);
    expect(requestSignStages('notShared')).toEqual(['postnatal']);
    expect(requestSignStages('pregnant')).toEqual(['pregnancy']);
    expect(infoSignStages('loss')).toEqual(['postnatal']);
    expect(infoSignStages('baby')).toEqual(['pregnancy', 'postnatal', 'baby']);
  });

  it('reading kinds follow the stage and the scopes add_self_log checks', () => {
    expect(readingKinds('pregnant', ALL)).toEqual(['bp', 'weight', 'movements', 'contractions']);
    expect(readingKinds('baby', ALL)).toEqual(['bp', 'weight', 'feeding']);
    // After a stillbirth / a baby's death: no feeding.
    expect(readingKinds('loss', ALL)).toEqual(['bp', 'weight']);
    // A caregiver with the baby scope only: feeding, never her BP or weight.
    expect(readingKinds('baby', { ...NONE, baby: true })).toEqual(['feeding']);
    expect(readingKinds('baby', { ...NONE, logs: true })).toEqual(['bp', 'weight']);
    expect(readingKinds('pregnant', NONE)).toEqual([]);
  });
});

describe('the phone calendar day (00:00–05:30 IST is the previous UTC day)', () => {
  // Jest runs with the machine's zone; build local times so the test holds anywhere.
  const justAfterMidnight = new Date(2026, 9, 3, 0, 30);

  it('today is the local date', () => {
    expect(todayIso(justAfterMidnight)).toBe('2026-10-03');
    expect(todayIso(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
  });

  it('days since a birth count local dates', () => {
    expect(localDaysBetween(new Date(2026, 9, 2, 23, 50), justAfterMidnight)).toBe(1);
    expect(localDaysBetween(new Date(2026, 9, 3, 0, 5), justAfterMidnight)).toBe(0);
  });
});

describe('family tests', () => {
  const pregnancyId = asPregnancyId('11111111-1111-4111-8111-111111111111');
  const inv = (over: Partial<Investigation>): Investigation => ({
    id: asInvestigationId('22222222-2222-4222-8222-222222222222'),
    subjectId: pregnancyId,
    code: 'hb1',
    label: 'Hb',
    kind: 'lab',
    sensitive: false,
    dueFrom: new Date(Date.UTC(2026, 9, 1)),
    dueBy: new Date(Date.UTC(2026, 9, 10)),
    late: false,
    status: 'due',
    ...over,
  });
  const now = new Date(2026, 9, 5, 10, 0);

  it('not done has its own word (never "Done")', () => {
    expect(familyTestStatus(inv({ status: 'not_done' }), now, false)).toEqual({ status: 'upcoming', labelKey: 'family.status.notDone' });
  });

  it('"result ready — discuss" is the mother’s prompt; a caregiver sees done', () => {
    expect(familyTestStatus(inv({ status: 'resulted' }), now, false).labelKey).toBe('family.status.discuss');
    expect(familyTestStatus(inv({ status: 'resulted' }), now, true)).toEqual({ status: 'done', labelKey: 'family.status.done' });
    expect(familyTestStatus(inv({ status: 'reviewed' }), now, false).labelKey).toBe('family.status.done');
  });

  it('the list and the detail screen share one guard: her pregnancy, never sensitive, tests scope', () => {
    const list = [inv({}), inv({ id: asInvestigationId('33333333-3333-4333-8333-333333333333'), sensitive: true }), inv({ id: asInvestigationId('44444444-4444-4444-8444-444444444444'), subjectId: asPregnancyId('55555555-5555-4555-8555-555555555555') })];
    expect(familyTests(list, { pregnancy: { id: pregnancyId }, scopes: { tests: true } }).map((i) => i.id)).toEqual([list[0]!.id]);
    expect(familyTests(list, { pregnancy: { id: pregnancyId }, scopes: { tests: false } })).toEqual([]);
    expect(familyTests(list, { pregnancy: undefined, scopes: { tests: true } })).toEqual([]);
  });
});

describe('family medicines', () => {
  const motherId = asMotherId('66666666-6666-4666-8666-666666666666');
  const rx: Prescription = { id: asPrescriptionId('77777777-7777-4777-8777-777777777777'), motherId, name: 'Iron', slots: ['morning', 'night'] };
  const who = { mother: { id: motherId }, pregnancy: { history: { conditions: [], allergies: [], medicines: ['Iron'] } }, scopes: ALL };

  it('Supabase mode counts the prescription’s own times of day (same list as the medicines screen)', () => {
    const meds = familyMedsFrom({ prescriptions: [rx] }, who, true);
    expect(meds).toEqual([{ name: 'Iron', id: rx.id, slots: ['morning', 'night'], note: '' }]);
    const at = new Date(2026, 9, 3, 0, 30);
    const dose = (slot: MedDose['slot']): MedDose => ({ id: `d-${slot}` as MedDose['id'], motherId, med: 'Iron', medicationId: rx.id, date: '2026-10-03', slot, status: 'taken', at });
    expect(dosesToday({ medDoses: [dose('morning')] }, motherId, meds, at)).toEqual({ taken: 1, total: 2 });
  });

  it('a caregiver without the readings scope gets no medicines', () => {
    expect(familyMedsFrom({ prescriptions: [rx] }, { ...who, scopes: { ...ALL, logs: false } }, true)).toEqual([]);
  });
});

describe('family routes', () => {
  it('every Family route file is behind consent in the layout', () => {
    const dir = path.resolve(__dirname, '../../../app/family');
    const routes: string[] = [];
    const walk = (d: string, prefix: string) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) {
          if (name !== '(tabs)') walk(p, `${prefix}${name}/`);
        } else if (name.endsWith('.tsx') && !name.startsWith('_')) routes.push(`${prefix}${name.replace(/\.tsx$/, '')}`);
      }
    };
    walk(dir, '');
    const guarded = new Set<string>([...FAMILY_ROUTES, 'onboarding', 'no-access']);
    expect(routes.filter((r) => !guarded.has(r))).toEqual([]);
  });
});
