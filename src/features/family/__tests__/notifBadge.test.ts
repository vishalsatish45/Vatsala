import { bellCount, reminderKey } from '../notifBadge';
import type { FamilyItem } from '../useFamily';

const NOW = new Date('2026-10-03T06:00:00Z');
const item = (id: string, date: string, status: FamilyItem['status']) => ({ id, date: new Date(date), status }) as FamilyItem;

describe('family bell count', () => {
  const soon = item('t1', '2026-10-04', 'due');
  const later = item('t2', '2026-10-28', 'due');
  const missed = item('v1', '2026-09-30', 'missed');

  it('counts unread hospital messages and reminders the page lists (missed, or due within two days)', () => {
    expect(bellCount([soon, later, missed], 2, undefined, NOW)).toBe(4);
  });

  it('stops counting reminders once seen on the notifications page', () => {
    expect(bellCount([soon, later, missed], 0, [reminderKey(soon), reminderKey(missed)], NOW)).toBe(0);
  });

  it('counts a seen reminder again when it turns from due to missed', () => {
    const nowMissed = item('t1', '2026-10-04', 'missed');
    expect(bellCount([nowMissed], 0, [reminderKey(soon)], NOW)).toBe(1);
  });
});
