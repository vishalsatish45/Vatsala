import type { Href } from 'expo-router';

import type { AppNotification, Baby } from '@/data/types';

export type FamilyNotificationRow = { id: string; at: Date; titleKey: string; unread: boolean; href?: Href };

/**
 * Server notifications (Supabase mode) → Family rows: plain words chosen on the phone from the kind (never names or
 * clinical detail). A "baby arrived" row is not shown once that baby is no longer with the family (no cheerful
 * content after a loss).
 */
export function familyNotificationRows(rows: AppNotification[], liveBabies: Pick<Baby, 'id'>[]): FamilyNotificationRow[] {
  const live = new Set(liveBabies.map((b) => b.id));
  return rows.flatMap((n): FamilyNotificationRow[] => {
    const base = { id: n.id, at: n.at, unread: !n.readAt };
    if (n.kind === 'appointment_booked') {
      return [{ ...base, titleKey: 'family.notif.appointment', href: n.targetType === 'task' && n.targetId ? { pathname: '/family/item/[id]', params: { id: n.targetId } } : undefined }];
    }
    if (n.kind === 'baby_arrived') return n.targetId && live.has(n.targetId) ? [{ ...base, titleKey: 'family.notif.babyArrived', href: '/family' }] : [];
    return [{ ...base, titleKey: 'family.notif.update' }];
  });
}
