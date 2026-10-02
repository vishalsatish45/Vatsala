import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import type { SelfLogId } from '@/data/types';
import { fmtDay, fmtTime } from '@/features/family/itemText';
import { SelfLogFields, useSelfLogForm } from '@/features/family/RecordForm';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { AppText, Button, GlassSurface, Screen, SyncBadge, TopBar, space } from '@/ui';

/**
 * FA-10/11 Record a reading (PRD F-42). Stored as family-reported and shown to the care
 * team exactly as entered — the app never says whether a value is good or bad.
 */
export default function LogReading() {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<{ id: SelfLogId; at: Date }>();
  const form = useSelfLogForm(setSaved);

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
    <Screen
      blob="none"
      header={<TopBar back right={<ReadAloudButton text={`${t('family.log.title')}. ${t('family.log.sub')}`} />} />}
      footer={<Button label={t('family.log.save')} onPress={form.save} disabled={!form.ready || form.busy} />}
    >
      <View style={{ gap: 6 }}>
        <AppText variant="display">{t('family.log.title')}</AppText>
        <AppText tone="secondary">{t('family.log.sub')}</AppText>
      </View>
      <SelfLogFields form={form} rowHeight={56} />
    </Screen>
  );
}
