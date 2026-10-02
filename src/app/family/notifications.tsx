import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Bell, CalendarClock, FileCheck2, PhoneIncoming, Syringe, type LucideIcon } from 'lucide-react-native';
import { daysBetween } from '@domain/gestation';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { itemTitle, itemWhen } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { EmptyState, ListRow, Screen, TopBar, palette, space } from '@/ui';

type Row = { id: string; icon: LucideIcon; title: string; body: string; href?: Href };

/** Family notifications inbox (PRD F-04) — plain words, no clinical details. */
export default function FamilyNotifications() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const rows: Row[] = [];

  for (const i of familyItems(db, ctx, now)) {
    const soon = daysBetween(now, i.date) <= 2;
    if (i.status === 'missed') rows.push({ id: i.id, icon: CalendarClock, title: t('family.missedUs'), body: itemTitle(t, i), href: { pathname: '/family/item/[id]', params: { id: i.id } } });
    else if (soon) rows.push({ id: i.id, icon: i.kind === 'vaccine' ? Syringe : CalendarClock, title: t('family.rem.notifTitle'), body: `${itemTitle(t, i)} · ${itemWhen(t, i, i18n.language)}`, href: { pathname: '/family/item/[id]', params: { id: i.id } } });
  }
  if (ctx.pregnancy && (ctx.scopes.logs || !ctx.isCaregiver)) {
    for (const inv of db.investigations.filter((x) => x.subjectId === ctx.pregnancy!.id && !x.sensitive && x.status === 'resulted')) {
      rows.push({ id: inv.id, icon: FileCheck2, title: t('family.status.discuss'), body: inv.label, href: '/family/journey' });
    }
  }
  if (ctx.mother) {
    for (const c of db.callbacks.filter((x) => x.motherId === ctx.mother!.id && x.closedAt && now.getTime() - x.closedAt.getTime() < 3 * 86_400_000)) {
      rows.push({ id: c.id, icon: PhoneIncoming, title: t('family.notif.called'), body: '' });
    }
  }

  return (
    <Screen blob="none" header={<TopBar back title={t('family.notif.title')} />}>
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={t('family.notif.empty')} />
      ) : (
        <View style={{ gap: space.sm }}>
          {rows.map((r) => (
            <ListRow
              key={r.id}
              leading={
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' }}>
                  <r.icon size={18} color={palette.rose600} />
                </View>
              }
              title={r.title}
              subtitle={r.body || undefined}
              onPress={r.href ? () => router.push(r.href!) : undefined}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
