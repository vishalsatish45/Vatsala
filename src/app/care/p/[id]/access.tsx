import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Eye, PencilLine } from 'lucide-react-native';

import { asPregnancyId } from '@/data/ids';
import { ago, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Card, EmptyState, Screen, TopBar, palette, space } from '@/ui';

/** CT-82 Access history for one record (PRD F-60): who viewed or changed it, and when. */
export default function AccessHistory() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const babies = db.babies.filter((b) => b.pregnancyId === p.id).map((b) => b.id);
  const keys = new Set([p.id, p.mchId, ...babies]);
  const rows = db.audit.filter((a) => keys.has(a.entity));

  return (
    <Screen blob="none" header={<TopBar back title="Who viewed this record" />}>
      <AppText variant="display">{motherOf(db, p.motherId).name}</AppText>
      <AppText tone="secondary">Every view and change is logged and cannot be edited or deleted.</AppText>
      {rows.length === 0 ? (
        <EmptyState icon={Eye} title="No access logged yet" />
      ) : (
        <Card style={{ gap: space.sm }}>
          {rows.map((a) => (
            <View key={a.id} style={{ flexDirection: 'row', gap: 10 }}>
              {a.action === 'view_record' ? <Eye size={16} color={palette.inkSoft} /> : <PencilLine size={16} color={palette.rose600} />}
              <View style={{ flex: 1 }}>
                <AppText variant="bodyMedium">{a.action === 'view_record' ? 'Viewed record' : a.action}</AppText>
                <AppText variant="caption" tone="secondary">
                  {a.actor} · {ago(a.at, now)} ago
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
