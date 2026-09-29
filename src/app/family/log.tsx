import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, GlassSurface, OptionChips, Screen, SegmentedPills, TopBar, space } from '@/ui';

type Kind = 'bp' | 'weight' | 'movements' | 'feeding';

/**
 * FA-10/11 Record a reading (PRD F-42). Stored as family-reported and shown to the care
 * team exactly as entered — the app never says whether a value is good or bad.
 */
export default function LogReading() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const delivered = ctx.pregnancy?.status === 'delivered';
  const kinds: Kind[] = delivered ? ['bp', 'weight', 'feeding'] : ['bp', 'weight', 'movements'];
  const [kind, setKind] = useState<Kind>('bp');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [kg, setKg] = useState('');
  const [choice, setChoice] = useState<string>();
  const [saved, setSaved] = useState(false);

  const value = kind === 'bp' ? (sys && dia ? `${sys}/${dia}` : '') : kind === 'weight' ? (kg ? `${kg} kg` : '') : (choice ?? '');

  function save() {
    if (!ctx.mother || !value) return;
    const tEn = (k: string) => t(k, { lng: 'en' });
    const enValue = kind === 'movements' || kind === 'feeding' ? tEn(choice!) : value;
    db.addSelfLog({ motherId: ctx.mother.id, subject: kind === 'feeding' ? 'baby' : 'mother', kind, value: enValue, at: now, by: ctx.accountName });
    setSaved(true);
  }

  if (saved) {
    return (
      <Screen header={<TopBar back />} footer={<Button label={t('family.cb.done')} onPress={() => router.back()} />}>
        <AppText variant="display">{t('family.log.saved')}</AppText>
        <GlassSurface strong radius={20} style={{ padding: space.lg, gap: space.sm }}>
          <AppText variant="bodyMedium">{t('family.log.worried')}</AppText>
          <Button variant="secondary" label={t('family.askCall')} onPress={() => router.replace('/family/callback')} />
        </GlassSurface>
      </Screen>
    );
  }

  return (
    <Screen blob="none" header={<TopBar back />} footer={<Button label={t('family.log.save')} onPress={save} disabled={!value} />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{t('family.log.title')}</AppText>
        <AppText tone="secondary">{t('family.log.sub')}</AppText>
      </View>
      <SegmentedPills value={kind} onChange={(k) => { setKind(k); setChoice(undefined); }} options={kinds.map((k) => ({ value: k, label: t(`family.log.${k}`) }))} />
      <Card style={{ gap: space.md }}>
        {kind === 'bp' && (
          <View style={styles.row}>
            <Field flex label={t('family.log.sys')} keyboardType="number-pad" value={sys} onChangeText={setSys} unit="mmHg" />
            <Field flex label={t('family.log.dia')} keyboardType="number-pad" value={dia} onChangeText={setDia} unit="mmHg" />
          </View>
        )}
        {kind === 'weight' && <Field label={t('family.log.weight')} keyboardType="decimal-pad" value={kg} onChangeText={setKg} unit="kg" />}
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

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: space.sm } });
