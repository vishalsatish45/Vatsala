import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { ClipboardCheck } from 'lucide-react-native';

import { asPregnancyId } from '@/data/ids';
import { fmtDay, fmtTime, motherOf, sexLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import { AppText, Button, Chip, GlassSurface, PressableScale, Screen, TopBar, palette, space } from '@/ui';

/**
 * CT-58 Delivered — linked baby IDs, paediatrics notified (PRD F-18, F-19). Every baby is its own card (tap a
 * liveborn baby to open the record; its discharge checklist is one tap away). Neutral tone for loss.
 */
export default function Delivered() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const babies = db.babies.filter((b) => b.pregnancyId === p.id);
  const d = db.deliveries.find((x) => x.pregnancyId === p.id);

  return (
    <Screen blobCenterY={160} header={<TopBar title="Delivery recorded" />}>
      <View style={{ alignItems: 'center', gap: 4, marginTop: space.md }}>
        <AppText variant="display" align="center">
          {m.name}
        </AppText>
        <AppText tone="secondary" align="center">
          {d ? `${d.mode} · ${fmtDay(d.at)} ${fmtTime(d.at)} · ` : ''}
          {babies.length > 1 ? `${babies.length} babies` : '1 baby'}
        </AppText>
      </View>

      {babies.map((b) => {
        const live = b.outcome === 'live';
        const card = (
          <GlassSurface strong style={styles.baby}>
            {live ? (
              <View style={styles.qr}>
                <QRCode value={b.childId} size={96} color={palette.ink} backgroundColor="transparent" />
              </View>
            ) : null}
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="headline">{b.childId}</AppText>
              <AppText tone="secondary">
                {[sexLabel(b.sex), b.birthWeightG != null ? `${b.birthWeightG} g` : undefined, b.apgar5 != null ? `Apgar ${b.apgar1 ?? '–'}/${b.apgar5}` : undefined].filter(Boolean).join(' · ')}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {live ? 'Linked to mother · vaccine schedule created · paediatrics notified' : 'Stillbirth recorded · baby reminders suppressed'}
              </AppText>
              {live && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Chip label="Open baby ›" />
                  <Chip label="Discharge checklist" icon={ClipboardCheck} onPress={() => router.push({ pathname: '/care/discharge/[id]', params: { id: b.id } })} />
                </View>
              )}
            </View>
          </GlassSurface>
        );
        return live ? (
          <PressableScale key={b.id} onPress={() => router.push({ pathname: '/care/b/[id]', params: { id: b.id } })} accessibilityRole="button" accessibilityLabel={`Open ${b.childId}`}>
            {card}
          </PressableScale>
        ) : (
          <View key={b.id}>{card}</View>
        );
      })}

      <Button label="Mother's discharge checklist" icon={ClipboardCheck} onPress={() => router.push({ pathname: '/care/discharge/[id]', params: { id: p.id } })} />
      <Button variant="secondary" label={`Back to ${m.name}`} onPress={() => router.replace({ pathname: '/care/p/[id]', params: { id: p.id } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  baby: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md },
  qr: { padding: 8, backgroundColor: palette.white, borderRadius: 14 },
});
