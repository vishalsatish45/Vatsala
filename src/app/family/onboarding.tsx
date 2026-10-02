import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, HeartHandshake, MessageCircle, MessageSquareText, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react-native';

import { recordConsent } from '@/data/sync';
import { useDb } from '@/data/store';
import { useFamily } from '@/features/family/useFamily';
import { LANGUAGES } from '@/lib/i18n';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, GlassSurface, InfoRow, PressableScale, ProgressBar, Screen, palette, space } from '@/ui';

const TOTAL = 4;

function Point({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>
        <Icon size={20} color={palette.rose600} strokeWidth={1.9} />
      </View>
      <AppText variant="body" style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

/** ON-01…04 Family onboarding: language → consent → details → reminder channels (PRD F-03). */
export default function Onboarding() {
  const { t } = useTranslation();
  const lang = useSession((s) => s.lang);
  const setLang = useSession((s) => s.setLang);
  const complete = useSession((s) => s.completeOnboarding);
  const signOut = useSession((s) => s.signOut);
  const { mother, pregnancy, accountId, accountName, isCaregiver } = useFamily();
  const hospitalName = useDb((s) => s.hospital?.name);
  const [step, setStep] = useState(0);
  const [channels, setChannels] = useState<string[]>(['app', 'whatsapp']);

  const toggle = (c: string) => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const [saving, setSaving] = useState(false);
  // The app opens only once the server has her consent (Supabase mode); the demo records it on the phone.
  async function next() {
    if (step < TOTAL - 1) return setStep(step + 1);
    setSaving(true);
    try {
      await recordConsent(channels, lang);
      complete(accountId, channels);
    } catch {
      Alert.alert(t('common.errorTitle'), t('auth.network'));
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <View style={{ gap: 8 }}>
      <Button label={step === 1 ? t('on.agree') : step === TOTAL - 1 ? t('on.finish') : t('common.continue')} onPress={next} loading={saving} disabled={step === 3 && channels.length === 0} />
      {step === 1 && <Button variant="secondary" label={t('common.signOut')} onPress={signOut} />}
    </View>
  );

  return (
    <Screen blobCenterY={120} footer={footer}>
      <ProgressBar progress={(step + 1) / TOTAL} leftCaption={t('on.step', { n: step + 1, total: TOTAL })} />

      {step === 0 && (
        <>
          <AppText variant="display">{t('on.langTitle')}</AppText>
          {LANGUAGES.map((l) => (
            <PressableScale key={l.code} onPress={() => setLang(l.code)} accessibilityRole="radio" accessibilityState={{ selected: l.code === lang }}>
              <GlassSurface strong style={[styles.lang, l.code === lang && styles.langOn]}>
                <AppText variant="title">{l.label}</AppText>
                {l.code === lang && <Chip label="✓" variant="selected" />}
              </GlassSurface>
            </PressableScale>
          ))}
        </>
      )}

      {step === 1 && (
        <>
          <AppText variant="display">{t('on.consentTitle')}</AppText>
          <Card style={{ gap: space.md }}>
            <Point icon={Stethoscope} text={t('on.consent1')} />
            <Point icon={ShieldCheck} text={t('on.consent2')} />
            <Point icon={Bell} text={t('on.consent3')} />
            <Point icon={HeartHandshake} text={t('on.consent4')} />
            <Point icon={MessageSquareText} text={t('on.consent5')} />
          </Card>
        </>
      )}

      {step === 2 && (
        <>
          <AppText variant="display">{t('on.detailsTitle')}</AppText>
          <AppText tone="secondary">{t('on.detailsSub')}</AppText>
          <Card>
            <InfoRow label={t('family.me.name')} value={isCaregiver ? accountName : mother?.name} />
            {isCaregiver && <InfoRow label="↳" value={mother?.name} />}
            <InfoRow label={t('family.me.phone')} value={mother?.phone} />
            <InfoRow label={t('family.card.f.hospital')} value={hospitalName} />
            <InfoRow label="MCH ID" value={pregnancy?.mchId} />
            <InfoRow label={t('family.card.f.emergency')} value={mother ? `${mother.emergencyContact.name} · ${mother.emergencyContact.phone}` : undefined} />
          </Card>
        </>
      )}

      {step === 3 && (
        <>
          <AppText variant="display">{t('on.channelsTitle')}</AppText>
          <AppText tone="secondary">{t('on.channelsSub')}</AppText>
          {[
            { key: 'app', icon: Bell, label: t('on.app') },
            { key: 'whatsapp', icon: MessageCircle, label: t('on.whatsapp') },
            { key: 'sms', icon: MessageSquareText, label: t('on.sms') },
          ].map(({ key, icon: Icon, label }) => {
            const on = channels.includes(key);
            return (
              <PressableScale key={key} onPress={() => toggle(key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <GlassSurface strong style={[styles.lang, on && styles.langOn]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Icon size={22} color={palette.rose600} />
                    <AppText variant="headline">{label}</AppText>
                  </View>
                  <Chip label={on ? '✓' : ' '} variant={on ? 'selected' : 'soft'} />
                </GlassSurface>
              </PressableScale>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lang: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg },
  langOn: { borderWidth: 2, borderColor: palette.rose300 },
  point: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  pointIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
});
