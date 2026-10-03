import { useEffect } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Baby, Bell, CalendarClock, FileCheck2, PhoneIncoming, Syringe, type LucideIcon } from 'lucide-react-native';

import { useDb } from '@/data/store';
import { isReminder, reminderKey } from '@/features/family/notifBadge';
import { useSession } from '@/state/session';
import { familyNotificationRows } from '@/features/family/serverNotifications';
import { familyTests } from '@/features/family/tests';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { fmtShort, itemTitle, itemWhen } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { Chip, EmptyState, ListRow, Screen, TopBar, palette, space } from '@/ui';

type Row = { id: string; icon: LucideIcon; title: string; body: string; href?: Href; unread?: boolean };

/** Family notifications inbox (PRD F-04) — plain words, no clinical details. */
export default function FamilyNotifications() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const rows: Row[] = [];

  // From the hospital (Supabase mode): appointment booked, baby arrived … newest first.
  const server = familyNotificationRows(db.notifications, ctx.babies);
  for (const n of server) {
    rows.push({
      id: n.id,
      icon: n.titleKey === 'family.notif.babyArrived' ? Baby : n.titleKey === 'family.notif.appointment' ? CalendarClock : Bell,
      title: t(n.titleKey),
      body: fmtShort(n.at, i18n.language),
      href: n.href,
      unread: n.unread,
    });
  }

  const items = familyItems(db, ctx, now);
  for (const i of items) {
    if (!isReminder(i, now)) continue;
    if (i.status === 'missed') rows.push({ id: i.id, icon: CalendarClock, title: t('family.missedUs'), body: itemTitle(t, i), href: { pathname: '/family/item/[id]', params: { id: i.id } } });
    else rows.push({ id: i.id, icon: i.kind === 'vaccine' ? Syringe : CalendarClock, title: t('family.rem.notifTitle'), body: `${itemTitle(t, i)} · ${itemWhen(t, i, i18n.language)}`, href: { pathname: '/family/item/[id]', params: { id: i.id } } });
  }
  // "Result ready — discuss at your visit" is the mother's prompt; a caregiver never gets it.
  if (!ctx.isCaregiver) {
    for (const inv of familyTests(db.investigations, ctx).filter((x) => x.status === 'resulted')) {
      rows.push({ id: inv.id, icon: FileCheck2, title: t('family.status.discuss'), body: inv.label, href: '/family/journey' });
    }
  }
  if (ctx.mother) {
    for (const c of db.callbacks.filter((x) => x.motherId === ctx.mother!.id && x.closedAt && now.getTime() - x.closedAt.getTime() < 3 * 86_400_000)) {
      rows.push({ id: c.id, icon: PhoneIncoming, title: t('family.notif.called'), body: '' });
    }
  }

  const unread = server.filter((n) => n.unread);

  // Opening this page counts its reminders as seen, so the bell on Home stops counting them.
  const accountId = useSession((s) => s.account?.id);
  const setSeen = useSession((s) => s.setSeenReminders);
  const keys = items.filter((i) => isReminder(i, now)).map(reminderKey).sort().join(',');
  useEffect(() => {
    if (accountId) setSeen(accountId, keys ? keys.split(',') : []);
  }, [accountId, keys, setSeen]);

  const open = (r: Row) => {
    if (r.unread) db.markNotificationsRead([r.id], new Date());
    if (r.href) router.push(r.href);
  };

  return (
    <Screen
      blob="none"
      header={<TopBar back title={t('family.notif.title')} right={unread.length > 0 ? <Chip label={t('family.notif.markAll')} onPress={() => db.markNotificationsRead('all', new Date())} /> : undefined} />}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={t('family.notif.empty')} />
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map((r) => (
            <ListRow
              key={r.id}
              leading={
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: r.unread ? palette.rose100 : palette.rose50, alignItems: 'center', justifyContent: 'center' }}>
                  <r.icon size={18} color={palette.rose600} />
                </View>
              }
              title={r.title}
              subtitle={r.body || undefined}
              meta={r.unread ? <Chip label={t('family.notif.new')} variant="tag" /> : undefined}
              onPress={r.href || r.unread ? () => open(r) : undefined}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
