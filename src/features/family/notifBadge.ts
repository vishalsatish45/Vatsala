import { daysBetween } from '@domain/gestation';

import type { FamilyItem } from './useFamily';

/** A reminder the notifications page lists: missed, or due within two days. */
export const isReminder = (i: FamilyItem, now: Date) => i.status === 'missed' || daysBetween(now, i.date) <= 2;

/** A reminder as seen: its id and status, so one that turns from due to missed counts again. */
export const reminderKey = (i: FamilyItem) => `${i.id}:${i.status}`;

/** The bell's number: unread hospital messages plus reminders not yet seen on the notifications page. */
export function bellCount(items: FamilyItem[], unreadServer: number, seen: readonly string[] | undefined, now: Date) {
  const seenSet = new Set(seen ?? []);
  return unreadServer + items.filter((i) => isReminder(i, now) && !seenSet.has(reminderKey(i))).length;
}
