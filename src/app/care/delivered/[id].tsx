import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { AppText, Button, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

/** CT-58 Delivered — linked baby IDs, paediatrics notified (PRD F-18, F-19). Neutral tone for loss. */
export default function Delivered() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const babies = db.babies.filter((b) => b.pregnancyId === p.id);
  const d = db.deliveries.find((x) => x.pregnancyId === p.id);
  const anyLive = babies.some((b) => b.outcome === 'live');

  return (
    <Screen blobCenterY={160} header={<TopBar title="Delivery recorded" />}>
      <View style={{ alignItems: 'center', gap: 4, marginTop: space.md }}>
        <AppText variant="display" align="center">
          {m.name}
        </AppText>
        <AppText tone="secondary" align="center">
          {d?.mode} · {babies.length > 1 ? `${babies.length} babies` : '1 baby'}
        </AppText>
      </View>

      {babies.map((b) => (
        <GlassSurface key={b.id} strong style={styles.baby}>
          {b.outcome === 'live' ? (
            <View style={styles.qr}>
              <QRCode value={b.childId} size={96} color={palette.ink} backgroundColor="transparent" />
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="headline">{b.childId}</AppText>
            <AppText tone="secondary">
              {b.sex === 'F' ? 'Girl' : 'Boy'} · {b.birthWeightG} g{b.apgar5 != null ? ` · Apgar ${b.apgar1 ?? '–'}/${b.apgar5}` : ''}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {b.outcome === 'live' ? 'Linked to mother · vaccine schedule created · paediatrics notified' : 'Stillbirth recorded · baby reminders suppressed'}
            </AppText>
          </View>
        </GlassSurface>
      ))}

      {anyLive && (
        <Button label="Open baby" onPress={() => router.replace({ pathname: '/care/b/[id]', params: { id: babies.find((b) => b.outcome === 'live')!.id } })} />
      )}
      <Button variant="secondary" label="Mother's discharge checklist" onPress={() => router.replace({ pathname: '/care/discharge/[id]', params: { id: p.id } })} />
      <Button variant="secondary" label={`Back to ${m.name}`} onPress={() => router.replace({ pathname: '/care/p/[id]', params: { id: p.id } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  baby: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md },
  qr: { padding: 8, backgroundColor: palette.white, borderRadius: 14 },
});
