import { Suspense, lazy, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Controller, useWatch } from 'react-hook-form';
import { CircleCheck, TriangleAlert } from 'lucide-react-native';

import { WARNING_SIGNS, type SignStage } from '@/data/catalogue';
import { useDb } from '@/data/store';
import type { CallbackId } from '@/data/types';
import { callbackRequestSchema } from '@/features/family/forms';
import { useFamily } from '@/features/family/useFamily';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { VoiceField } from '@/features/voice/VoiceField';
import VoicePlayer from '@/features/device/VoicePlayer';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, EmergencyButtons, GlassSurface, Screen, SegmentedPills, SyncBadge, TopBar, palette, space } from '@/ui';

const VoiceRecorder = lazy(() => import('@/features/device/VoiceRecorder'));

/**
 * Merged Emergency Call + Warning signs. Top = ask-for-call form (ticked signs,
 * note, voice note with playback). Below = educational warning-sign cards for
 * pregnancy / after birth / baby.
 */
export default function AskForCall() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const stages: SignStage[] = ctx.pregnancy?.status === 'delivered' ? ['postnatal', 'baby'] : ['pregnancy'];
  const { control, handleSubmit, setValue } = useZodForm(callbackRequestSchema, { defaultValues: { signs: [], note: '', voice: undefined } });
  const { busy, once } = useSubmitOnce();
  const voice = useWatch({ control, name: 'voice' });
  const [sentId, setSentId] = useState<CallbackId>();
  // Which warning-sign cards are shown below (reading only, not part of the request).
  const [infoStage, setInfoStage] = useState<SignStage>(ctx.pregnancy?.status === 'delivered' ? 'postnatal' : 'pregnancy');

  const send = handleSubmit(
    once((r) => {
      if (!ctx.mother) return;
      // Signs travel as codes; the care team reads their English labels.
      setSentId(db.requestCallback(ctx.mother.id, r.signs, r.note, ctx.isCaregiver ? `${ctx.accountName} (caregiver)` : `${ctx.mother.name} (mother)`, 'app', now, r.voice));
    }),
  );

  if (sentId) {
    return (
      <Screen blobCenterY={200} header={<TopBar back title={t('family.emergencyCall')} />} footer={<Button label={t('family.cb.done')} onPress={() => router.back()} />}>
        <View style={styles.sent}>
          <CircleCheck size={64} color={palette.rose500} strokeWidth={1.4} />
          <AppText variant="display" align="center">
            {t('family.cb.sentTitle')}
          </AppText>
          <AppText align="center" tone="secondary">
            {t('family.cb.sentBody', { phone: ctx.mother?.phone ?? '' })}
          </AppText>
          <SyncBadge id={sentId} pendingLabel={t('common.pending')} syncedLabel={t('common.synced')} />
        </View>
        <GlassSurface strong radius={20} style={{ padding: space.md }}>
          <AppText variant="bodyMedium">{t('family.cb.urgent')}</AppText>
        </GlassSurface>
        <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />
      </Screen>
    );
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title={t('family.emergencyCall')} right={<ReadAloudButton text={[t('family.cb.title'), t('family.cb.sub')].join('. ')} />} />}
      footer={<Button label={t('family.cb.send')} disabled={busy} onPress={send} />}
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{t('family.emergencyCall')}</AppText>
        <AppText tone="secondary">{t('family.emergencySub')}</AppText>
      </View>

      <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />

      <View style={{ gap: 4 }}>
        <AppText variant="headline">{t('family.cb.title')}</AppText>
        <AppText tone="secondary">{t('family.cb.sub')}</AppText>
      </View>

      <Controller
        control={control}
        name="signs"
        render={({ field }) => (
          <>
            {stages.map((st) => (
              <Card key={st} style={{ gap: space.sm }}>
                <AppText variant="headline">{t(`family.signs.${st}`)}</AppText>
                <View style={styles.chips}>
                  {Object.keys(WARNING_SIGNS[st]).map((k) => {
                    const on = field.value.includes(k);
                    return <Chip key={k} label={t(`signs.${k}`)} variant={on ? 'selected' : 'soft'} onPress={() => field.onChange(on ? field.value.filter((x) => x !== k) : [...field.value, k])} />;
                  })}
                </View>
              </Card>
            ))}
          </>
        )}
      />

      <Controller control={control} name="note" render={({ field }) => <VoiceField label={t('family.cb.note')} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline />} />

      <Suspense fallback={null}>
        <VoiceRecorder labels={{ record: t('family.cb.voice'), stop: t('family.cb.stop'), saved: t('family.cb.recorded') }} onRecorded={(uri, seconds) => setValue('voice', uri ? { uri, seconds } : undefined)} />
      </Suspense>
      {!!voice && <VoicePlayer uri={voice.uri} seconds={voice.seconds} />}

      <GlassSurface strong radius={20} style={styles.banner}>
        <TriangleAlert size={22} color={palette.amber} />
        <AppText variant="headline" style={{ flex: 1 }}>
          {t('family.signs.banner')}
        </AppText>
      </GlassSurface>

      <SegmentedPills
        value={infoStage}
        onChange={setInfoStage}
        options={(['pregnancy', 'postnatal', 'baby'] as const).map((s) => ({ value: s, label: t(`family.signs.${s}`) }))}
      />

      <View style={styles.grid}>
        {Object.keys(WARNING_SIGNS[infoStage]).map((k) => (
          <GlassSurface key={k} strong radius={18} elevation="card" style={styles.tile}>
            <AppText variant="bodyMedium" align="center">
              {t(`signs.${k}`)}
            </AppText>
          </GlassSurface>
        ))}
      </View>
      <AppText variant="caption" tone="faint" align="center">
        {t('family.signs.reviewed')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sent: { alignItems: 'center', gap: space.sm, marginTop: 60, marginBottom: space.md },
  banner: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexBasis: '47%', flexGrow: 1, padding: space.sm, alignItems: 'center', minHeight: 84, justifyContent: 'center' },
});
