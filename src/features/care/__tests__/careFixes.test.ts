/**
 * Care Team fixes (audit of 2 Oct): what the store sends, who sees which button, and the read models.
 * Synthetic demo data only (src/data/seed.ts).
 */
import { addDays } from '@domain/gestation';

import { enqueue } from '@/data/outbox';
import { asStaffId, asTeamId } from '@/data/ids';
import { currentPregnancy, kpi, worklist } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { AuditEntry, Referral } from '@/data/types';
import { recordEntries } from '@/features/care/audit';
import type { CareMe } from '@/features/care/CareTeam';
import { canCorrectSelfLog, canWriteSubject, onMyWorklist, referralMoves, referralSide } from '@/features/care/permissions';

// Hoisted above the imports by babel-jest.
jest.mock('@/lib/supabase', () => ({
  isRemote: false,
  supabase: () => {
    throw new Error('no network in tests');
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));
jest.mock('@/data/outbox', () => ({ enqueue: jest.fn(), useOutbox: { setState: jest.fn(), getState: () => ({ queue: [] }) } }));

const now = new Date('2026-09-29T09:00:00+05:30');
const by = 'Dr. Test';
const db = () => useDb.getState();
const sent = (rpc: string) => (enqueue as jest.Mock).mock.calls.filter(([name]) => name === rpc).map(([, payload]) => payload as Record<string, unknown>);
const pregnancyOf = (name: string) => {
  const m = db().mothers.find((x) => x.name === name)!;
  return currentPregnancy(db(), m.id)!;
};

beforeEach(() => {
  db().reset(now);
  (enqueue as jest.Mock).mockClear();
});

const OB: CareMe = { role: 'obstetrician', staffId: 'staff_priya', teamIds: ['team_ob_unit_a'] };
const PAED: CareMe = { role: 'paediatrician', staffId: 'staff_arjun', teamIds: ['team_paediatrics_unit'] };
const CARDIO: CareMe = { role: 'specialist', staffId: 'staff_kiran', teamIds: ['team_cardiology'] };

describe('1 · intensity on a delivered pregnancy plans no ANC visit', () => {
  it('records the intensity only, and sends no planned visits', () => {
    const p = pregnancyOf('Meena T');
    expect(p.status).toBe('delivered');
    const before = db().tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.cancelledAt && !t.completedAt).length;
    db().setIntensity(p.id, 'close', by, now);
    expect(db().pregnancies.find((x) => x.id === p.id)!.intensity).toBe('close');
    expect(db().tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.cancelledAt && !t.completedAt)).toHaveLength(before);
    expect(sent('set_intensity')).toEqual([{ pregnancy_id: p.id, intensity: 'close', at: now.toISOString() }]);
  });

  it('an ongoing pregnancy is re-planned as before', () => {
    const p = pregnancyOf('Lakshmi K');
    db().setIntensity(p.id, 'close', by, now);
    const [payload] = sent('set_intensity');
    expect((payload!.new_tasks as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('2 · a visit keeps counselling and fetal movements', () => {
  it('sends counselling codes and the fetal movements observation', () => {
    const p = pregnancyOf('Lakshmi K');
    db().recordVisit(p.id, { vitals: { weightKg: 61, fetalMovements: 'Reduced' }, checklist: {}, complaints: [], counselling: ['Nutrition', 'Birth preparedness'], nextVisitOn: addDays(now, 14) }, by, now);
    const [payload] = sent('record_visit');
    expect(payload!.counselling).toEqual(['nutrition', 'birth_preparedness']);
    expect(payload!.observations).toEqual([{ code: 'weight', value_num: 61 }, { code: 'fetal_movements', value_text: 'Reduced' }]);
    const v = db().visits.find((x) => x.id === payload!.encounter_id)!;
    expect(v).toMatchObject({ counselling: ['Nutrition', 'Birth preparedness'], vitals: { fetalMovements: 'Reduced' } });
  });
});

describe('3 · buttons follow the server rules', () => {
  const ref = (over: Partial<Referral> = {}): Referral =>
    ({ id: 'rf', pregnancyId: pregnancyOf('Lakshmi K').id, toTeamId: asTeamId('team_cardiology'), department: 'Cardiology', urgency: 'routine', reason: 'r', question: 'q', status: 'requested', events: [], createdBy: 'x', ...over }) as Referral;

  it('writers: obstetrician for a pregnancy, paediatrician for a baby; self-logs by subject', () => {
    expect([OB, PAED, CARDIO].map((m) => canWriteSubject(m, 'pregnancy'))).toEqual([true, false, false]);
    expect([OB, PAED, CARDIO].map((m) => canWriteSubject(m, 'baby'))).toEqual([false, true, false]);
    expect(canCorrectSelfLog(PAED, 'mother')).toBe(false);
    expect(canCorrectSelfLog(PAED, 'baby')).toBe(true);
  });

  it('the receiving department accepts, schedules, sees and answers; the referrer closes or cancels', () => {
    const r = ref();
    const ob = referralSide(db(), OB, r);
    const kiran = referralSide(db(), CARDIO, r);
    expect(ob).toEqual({ receiving: false, referring: true });
    expect(kiran).toEqual({ receiving: true, referring: false });
    expect(referralMoves('requested', kiran)).toEqual(['accepted', 'declined']);
    expect(referralMoves('requested', ob)).toEqual(['cancelled']);
    expect(referralMoves('scheduled', kiran)).toEqual(['seen', 'scheduled']);
    expect(referralMoves('recommendations', kiran)).toEqual([]);
    expect(referralMoves('recommendations', ob)).toEqual(['closed']);
    expect(referralMoves('closed', ob)).toEqual([]);
    expect(referralSide(db(), PAED, r)).toEqual({ receiving: false, referring: false });
  });

  it('"Referral to accept" is on the department’s worklist, not the referrer’s', () => {
    const items = worklist(db(), now).filter((w) => w.target.type === 'referral');
    const toAccept = items.find((w) => w.what.startsWith('Referral to accept'))!;
    const answered = items.find((w) => w.what.startsWith('Referral answered'));
    expect(toAccept).toBeDefined();
    // the seed's Anaesthesia referral: nobody in the demo belongs to Anaesthesia
    expect(onMyWorklist(toAccept, OB)).toBe(false);
    expect(onMyWorklist(toAccept, { ...CARDIO, teamIds: [toAccept.referral!.toTeamId!] })).toBe(true);
    if (answered) {
      expect(onMyWorklist(answered, OB)).toBe(true);
      expect(onMyWorklist(answered, CARDIO)).toBe(false);
    }
    // specialists see no treating-team items (call-backs, visits)
    expect(worklist(db(), now).filter((w) => !w.referral).some((w) => onMyWorklist(w, CARDIO))).toBe(false);
  });
});

describe('4 · who viewed this record', () => {
  it('finds server entries by entity id and mother, keeping the raw action', () => {
    const p = pregnancyOf('Lakshmi K');
    const other = pregnancyOf('Sunita R');
    const at = now;
    const audit: AuditEntry[] = [
      { id: '1', at, actor: 'Dr. A', action: 'view_record', entity: 'pregnancies', entityId: p.id, motherId: p.motherId },
      { id: '2', at, actor: 'Dr. A', action: 'record_visit', entity: 'encounters', entityId: 'enc-1', motherId: p.motherId },
      { id: '3', at, actor: 'Dr. B', action: 'view_record', entity: 'pregnancies', entityId: other.id, motherId: other.motherId },
      { id: '4', at, actor: 'Dr. C', action: 'view_record', entity: p.id },
    ];
    expect(recordEntries(audit, new Set([p.id, p.mchId]), p.motherId).map((a) => a.id)).toEqual(['1', '2', '4']);
  });
});

describe('5 · tags are sent as changes', () => {
  it('a tag another clinician added meanwhile is kept; only the change is sent', () => {
    const p = pregnancyOf('Lakshmi K');
    // someone else adds GDM after this clinician opened the screen (with Lakshmi's tags at that time)
    db().setTags(p.id, { add: ['gdm'], remove: [] }, undefined, 'Dr. Other', now);
    (enqueue as jest.Mock).mockClear();
    db().setTags(p.id, { add: ['anaemia'], remove: [] }, 'Documented', by, now);
    const active = db().tags.filter((t) => t.subjectId === p.id && !t.removedAt).map((t) => t.code);
    expect(active).toEqual(expect.arrayContaining(['gdm', 'anaemia']));
    expect(sent('set_tags')).toEqual([{ pregnancy_id: p.id, add: ['anaemia'], remove: undefined, note: 'Documented', removal_reason: undefined, at: now.toISOString() }]);
  });

  it('a removal carries its reason; nothing changed sends nothing', () => {
    const p = pregnancyOf('Sunita R');
    db().setTags(p.id, { add: [], remove: ['gdm'] }, 'Entered by mistake', by, now);
    expect(sent('set_tags')[0]).toMatchObject({ remove: ['gdm'], removal_reason: 'Entered by mistake', note: undefined });
    expect(db().tags.find((t) => t.subjectId === p.id && t.code === 'gdm')!.removedAt).toEqual(now);
    db().setTags(p.id, { add: [], remove: [] }, undefined, by, now);
    expect(sent('set_tags')).toHaveLength(1);
  });
});

describe("6 · a returning mother's current pregnancy", () => {
  it('prefers the ongoing pregnancy, else the latest registered', () => {
    const p = pregnancyOf('Lakshmi K');
    const old = { ...p, id: 'old' as typeof p.id, status: 'closed' as const, registeredOn: addDays(p.registeredOn, 400) };
    const pregnancies = [old, p];
    expect(currentPregnancy({ pregnancies }, p.motherId)!.id).toBe(p.id);
    expect(currentPregnancy({ pregnancies: [old, { ...p, status: 'delivered' as const }] }, p.motherId)!.id).toBe('old');
    expect(currentPregnancy({ pregnancies: [] }, p.motherId)).toBeUndefined();
  });
});

describe('8 · referral steps keep what was documented', () => {
  it('declining or cancelling takes the open appointment with it; the reason is on the timeline', () => {
    const p = pregnancyOf('Lakshmi K');
    const id = db().createReferral({ pregnancyId: p.id, department: 'Cardiology', urgency: 'routine', reason: 'r', question: 'q' }, by, now);
    expect(db().referrals.find((r) => r.id === id)!.toTeamId).toBe('team_cardiology');
    db().advanceReferral(id, 'accepted', {}, by, now);
    db().advanceReferral(id, 'scheduled', { scheduledAt: addDays(now, 3), place: 'Cardiology OPD, room 4' }, by, now);
    const appt = db().tasks.find((t) => t.refId === id)!;
    expect(appt).toMatchObject({ place: 'Cardiology OPD, room 4' });
    db().advanceReferral(id, 'cancelled', { note: 'Seen at another hospital' }, by, now);
    expect(db().tasks.find((t) => t.id === appt.id)!.cancelledAt).toEqual(now);
    const r = db().referrals.find((x) => x.id === id)!;
    expect(r.status).toBe('cancelled');
    expect(r.events.at(-1)).toMatchObject({ status: 'cancelled', note: 'Seen at another hospital' });
    expect(sent('advance_referral').at(-1)).toMatchObject({ to: 'cancelled', note: 'Seen at another hospital' });
  });
});

describe('10 · a cancelled referral is not an answered one', () => {
  it('leaves the referral KPI', () => {
    const base = kpi(db(), now).referralMedianDays;
    const p = pregnancyOf('Lakshmi K');
    const id = db().createReferral({ pregnancyId: p.id, department: 'Cardiology', urgency: 'routine', reason: 'r', question: 'q' }, by, addDays(now, -2));
    db().advanceReferral(id, 'cancelled', { note: 'No longer needed' }, by, now);
    expect(kpi(db(), now).referralMedianDays).toBe(base);
    // the demo's Cardiology team member is Dr. Kiran
    expect(db().teamMembers).toEqual(expect.arrayContaining([{ teamId: asTeamId('team_cardiology'), staffId: asStaffId('staff_kiran') }]));
  });
});
