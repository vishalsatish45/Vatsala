import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CircleCheck, Mic } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { WARNING_SIGNS, type SignStage } from '@/data/catalogue';
import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, EmergencyButtons, Field, GlassSurface, PressableScale, Screen, TopBar, palette, radius, space } from '@/ui';

/**
 * FA-01/02 "Ask the hospital to call me" (PRD F-42, F-25). The family may tick listed
 * signs; the app never evaluates them — a person calls back.
 */
export default function AskForCall() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const stages: SignStage[] = ctx.pregnancy?.status === 'delivered' ? ['postnatal', 'baby'] : ['pregnancy'];
  const [signs, setSigns] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [voiceHint, setVoiceHint] = useState(false);

  const toggle = (k: string) => setSigns((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  function send() {
    if (!ctx.mother) return;
    const labels = signs.map((k) => {
      for (const st of stages) {
        const map = WARNING_SIGNS[st] as Record<string, string>;
        if (map[k]) return map[k];
      }
      return k;
    });
    db.requestCallback(ctx.mother.id, labels, note.trim() || undefined, ctx.isCaregiver ? `${ctx.accountName} (caregiver)` : `${ctx.mother.name} (mother)`, 'app', now);
    setSent(true);
  }

  if (sent) {
    return (
      <Screen blobCenterY={200} header={<TopBar back />} footer={<Button label={t('family.cb.done')} onPress={() => router.back()} />}>
        <View style={styles.sent}>
          <CircleCheck size={72} color={palette.rose500} strokeWidth={1.4} />
          <AppText variant="display" align="center">
            {t('family.cb.sentTitle')}
          </AppText>
          <AppText align="center" tone="secondary">
            {t('family.cb.sentBody', { phone: ctx.mother?.phone ?? '' })}
          </AppText>
        </View>
        <GlassSurface strong radius={20} style={{ padding: space.lg }}>
          <AppText variant="bodyMedium">{t('family.cb.urgent')}</AppText>
        </GlassSurface>
        <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />
      </Screen>
    );
  }

  return (
    <Screen blob="none" header={<TopBar back />} footer={<Button label={t('family.cb.send')} onPress={send} />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{t('family.cb.title')}</AppText>
        <AppText tone="secondary">{t('family.cb.sub')}</AppText>
      </View>

      <EmergencyButtons call108={t('family.call108')} callHospital={t('family.callHospital')} />

      {stages.map((st) => (
        <Card key={st} style={{ gap: space.sm }}>
          <AppText variant="headline">{t(`family.signs.${st}`)}</AppText>
          <View style={styles.chips}>
            {Object.keys(WARNING_SIGNS[st]).map((k) => (
              <Chip key={k} label={t(`signs.${k}`)} variant={signs.includes(k) ? 'selected' : 'soft'} onPress={() => toggle(k)} />
            ))}
          </View>
        </Card>
      ))}

      <Field label={t('family.cb.note')} value={note} onChangeText={setNote} multiline />

      <PressableScale onPress={() => setVoiceHint(true)} accessibilityRole="button" accessibilityLabel={t('family.cb.voice')}>
        <LinearGradient colors={['#F9D3E1', palette.rose300]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.voice}>
          <View style={styles.mic}>
            <Mic size={18} color={palette.rose600} />
          </View>
          <AppText variant="bodyMedium">{voiceHint ? t('family.cb.voiceSoon') : t('family.cb.voice')}</AppText>
        </LinearGradient>
      </PressableScale>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.pill, padding: 8, paddingRight: space.lg },
  mic: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  sent: { alignItems: 'center', gap: space.sm, marginTop: 80, marginBottom: space.lg },
});
