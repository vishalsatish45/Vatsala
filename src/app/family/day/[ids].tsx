import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Info, MapPin, Package } from 'lucide-react-native';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { fmtDay, itemStatus, itemTitle, itemWhen } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { AppText, Card, GlassSurface, PressableScale, Screen, StatusBadge, TopBar, palette, space } from '@/ui';

/** Visit-day detail: every item due on the same day, each tappable for full details. */
export default function FamilyDayDetail() {
  const { ids } = useLocalSearchParams<{ ids: string }>();
  const { t, i18n } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const all = familyItems(db, ctx, now);
  const list = String(ids ?? '')
    .split(',')
    .map((id) => all.find((i) => i.id === id))
    .filter((i) => i !== undefined);
  if (list.length === 0) return <Screen header={<TopBar back />}><AppText>—</AppText></Screen>;

  return (
    <Screen blob="top" blobCenterY={120} header={<TopBar back title={fmtDay(list[0].date, i18n.language)} />}>
      <AppText variant="display">{fmtDay(list[0].date, i18n.language)}</AppText>
      {list.map((item) => (
        <PressableScale key={item.id} onPress={() => router.push({ pathname: '/family/item/[id]', params: { id: item.id } })} accessibilityRole="button" accessibilityLabel={itemTitle(t, item)}>
          <GlassSurface strong radius={20} style={{ padding: space.md, gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{itemTitle(t, item)}</AppText>
                <AppText variant="caption" tone="secondary">{itemWhen(t, item, i18n.language)}</AppText>
              </View>
              <StatusBadge status={item.status} label={itemStatus(t, item)} />
            </View>
            <Card style={{ gap: space.sm }}>
              {!!item.place && (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <MapPin size={16} color={palette.rose600} />
                  <AppText variant="bodyMedium">{item.place}</AppText>
                </View>
              )}
              {item.bring.length > 0 && (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Package size={16} color={palette.rose600} />
                  <AppText variant="bodyMedium">{item.bring.map((b) => t(b)).join(' · ')}</AppText>
                </View>
              )}
              {item.prep.length > 0 && (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Info size={16} color={palette.rose600} />
                  <AppText variant="bodyMedium">{item.prep.map((p) => t(p)).join(' · ')}</AppText>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                <CalendarClock size={16} color={palette.rose600} />
                <AppText variant="bodyMedium" tone="accent">{t('family.seeDetails')} ›</AppText>
              </View>
            </Card>
          </GlassSurface>
        </PressableScale>
      ))}
    </Screen>
  );
}
