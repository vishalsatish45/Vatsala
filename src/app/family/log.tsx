import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/data/store';
import { fmtDay, fmtTime } from '@/features/family/itemText';
import { useFamily } from '@/features/family/useFamily';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { VoiceField } from '@/features/voice/VoiceField';
import { useClock } from '@/lib/clock';
import { AppText, Button, Card, GlassSurface, OptionChips, PressableScale, Screen, SyncBadge, TopBar, palette, radius, space } from '@/ui';

type Kind = 'bp' | 'weight' | 'movements' | 'contractions' | 'feeding';

/**
 * FA-10/11 Record a reading (PRD F-42). Stored as family-reported and shown to the care
 * team exactly as entered — the app never says whether a value is good or bad.
 */
export default function LogReading() {
  const { t, i18n } = useTranslation();
  const db = useDb();
  const ctx = useFamily();
  const delivered = ctx.pregnancy?.status === 'delivered';
  const kinds: Kind[] = delivered ? ['bp', 'weight', 'feeding'] : ['bp', 'weight', 'movements', 'contractions'];
  const [kind, setKind] = useState<Kind>('bp');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [kg, setKg] = useState('');
  const [count, setCount] = useState('');
  const [choice, setChoice] = useState<string>();
  const [saved, setSaved] = useState<{ id: string; at: Date }>();

  const value =
    kind === 'bp' ? (sys && dia ? `${sys}/${dia}` : '') : kind === 'weight' ? (kg ? `${kg} kg` : '') : kind === 'contractions' ? (count ? `${count} in last hour` : '') : (choice ?? '');

  function save() {
    if (!ctx.mother || !value) return;
    const tEn = (k: string) => t(k, { lng: 'en' });
    const enValue = kind === 'movements' || kind === 'feeding' ? tEn(choice!) : value;
    // Stamp the moment of saving (date + hh:mm), not when the screen last rendered.
    const at = new Date(Date.now() + useClock.getState().offsetDays * 86_400_000);
    setSaved({ id: db.addSelfLog({ motherId: ctx.mother.id, subject: kind === 'feeding' ? 'baby' : 'mother', kind, value: enValue, at, by: ctx.accountName }), at });
  }

  if (saved) {
    return (
      <Screen header={<TopBar back />} footer={<Button label={t('family.cb.done')} onPress={() => router.back()} />}>
        <AppText variant="display">{t('family.log.saved')}</AppText>
        <AppText tone="secondary">{t('family.log.savedAt', { day: fmtDay(saved.at, i18n.language), time: fmtTime(saved.at, i18n.language) })}</AppText>
        <SyncBadge id={saved.id} pendingLabel={t('common.pending')} syncedLabel={t('common.synced')} />
        <GlassSurface strong radius={20} style={{ padding: space.lg, gap: space.sm }}>
          <AppText variant="bodyMedium">{t('family.log.worried')}</AppText>
          <Button variant="secondary" label={t('family.askCall')} onPress={() => router.replace('/family/callback')} />
        </GlassSurface>
      </Screen>
    );
  }

  return (
    <Screen blob="none" header={<TopBar back right={<ReadAloudButton text={`${t('family.log.title')}. ${t('family.log.sub')}`} />} />} footer={<Button label={t('family.log.save')} onPress={save} disabled={!value} />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{t('family.log.title')}</AppText>
        <AppText tone="secondary">{t('family.log.sub')}</AppText>
      </View>
      <View style={styles.kinds} accessibilityRole="radiogroup">
        {kinds.map((k) => {
          const active = k === kind;
          return (
            <PressableScale
              key={k}
              onPress={() => { setKind(k); setChoice(undefined); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.kind, { backgroundColor: active ? palette.ink : 'rgba(255,255,255,0.75)' }]}
            >
              <View style={[styles.dot, { borderColor: active ? palette.white : palette.inkFaint }]}>{active && <View style={styles.dotFill} />}</View>
              <AppText variant="bodyMedium" style={{ color: active ? palette.white : palette.ink }}>
                {t(`family.log.${k}`)}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
      <Card style={{ gap: space.md }}>
        {kind === 'bp' && (
          <View style={styles.row}>
            <VoiceField voiceMode="number" flex label={t('family.log.sys')} keyboardType="number-pad" value={sys} onChangeText={setSys} unit="mmHg" />
            <VoiceField voiceMode="number" flex label={t('family.log.dia')} keyboardType="number-pad" value={dia} onChangeText={setDia} unit="mmHg" />
          </View>
        )}
        {kind === 'contractions' && <VoiceField voiceMode="number" label={t('family.log.contractionsCount')} hint={t('family.log.contractionsHint')} keyboardType="number-pad" value={count} onChangeText={(v) => setCount(v.replace(/[^0-9]/g, ''))} />}
        {kind === 'weight' && <VoiceField voiceMode="number" label={t('family.log.weight')} keyboardType="decimal-pad" value={kg} onChangeText={setKg} unit="kg" />}
        {kind === 'movements' && (
          <OptionChips options={['family.log.moveNormal', 'family.log.moveLess'].map((k) => t(k))} value={choice ? t(choice) : undefined} onChange={(v) => setChoice(['family.log.moveNormal', 'family.log.moveLess'].find((k) => t(k) === v))} />
        )}
        {kind === 'feeding' && (
          <OptionChips options={['family.log.feedWell', 'family.log.feedPoorly', 'family.log.feedNot'].map((k) => t(k))} value={choice ? t(choice) : undefined} onChange={(v) => setChoice(['family.log.feedWell', 'family.log.feedPoorly', 'family.log.feedNot'].find((k) => t(k) === v))} />
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  kinds: { gap: space.xs },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.white },
});
