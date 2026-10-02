import { buildSeed } from '@/data/seed';
import type { AppNotification } from '@/data/types';
import { serverInbox } from '@/features/care/inbox';
import { familyNotificationRows } from '@/features/family/serverNotifications';

const now = new Date('2026-09-29T09:00:00+05:30');
const at = new Date('2026-09-29T08:00:00+05:30');

describe('care server notifications', () => {
  const db = buildSeed(now);
  const cb = db.callbacks[0]!;
  const ref = db.referrals[0]!;
  const baby = db.babies[0]!;
  db.notifications = [
    { id: 'n1', kind: 'callback_requested', targetType: 'callback', targetId: cb.id, at },
    { id: 'n2', kind: 'referral_scheduled', targetType: 'referral', targetId: ref.id, at, readAt: at },
    { id: 'n3', kind: 'baby_born', targetType: 'baby', targetId: baby.id, at },
    { id: 'n4', kind: 'referral_requested', targetType: 'referral', targetId: 'gone', at },
  ];

  it('chooses the text from the kind and links the target', () => {
    const rows = serverInbox(db);
    expect(rows[0]).toMatchObject({ title: 'Call-back requested', unread: true, href: { pathname: '/care/callback/[id]', params: { id: cb.id } } });
    expect(rows[1]).toMatchObject({ title: 'Referral scheduled', unread: false, href: { pathname: '/care/referral/[id]' } });
    expect(rows[2]?.title).toBe('Baby born · now with your team');
    expect(rows[2]?.body).toContain(baby.childId);
  });

  it('lists a target this clinician can no longer open without a link', () => {
    expect(serverInbox(db)[3]).toMatchObject({ title: 'New referral to your department', href: undefined });
  });
});

describe('family server notifications', () => {
  const rows: AppNotification[] = [
    { id: 'a', kind: 'appointment_booked', targetType: 'task', targetId: 't1', at },
    { id: 'b', kind: 'baby_arrived', targetType: 'baby', targetId: 'b1', at, readAt: at },
    { id: 'c', kind: 'something_new', at },
  ];

  it('uses plain-word keys and opens the appointment', () => {
    const out = familyNotificationRows(rows, [{ id: 'b1' }]);
    expect(out.map((r) => r.titleKey)).toEqual(['family.notif.appointment', 'family.notif.babyArrived', 'family.notif.update']);
    expect(out[0]).toMatchObject({ unread: true, href: { pathname: '/family/item/[id]', params: { id: 't1' } } });
    expect(out[1]?.unread).toBe(false);
  });

  it('drops "baby arrived" once that baby is no longer with the family', () => {
    expect(familyNotificationRows(rows, []).some((r) => r.titleKey === 'family.notif.babyArrived')).toBe(false);
  });
});
