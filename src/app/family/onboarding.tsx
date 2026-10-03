import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, HeartHandshake, MessageCircle, MessageSquareText, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react-native';

import { RemoteError } from '@/data/remote';
import { recordConsent } from '@/data/sync';
import { confirmSignOut } from '@/features/auth/confirmSignOut';
import { NoAccess } from '@/features/family/NoAccess';
import { useOnboardingDetails, type DetailsState } from '@/features/family/onboardingDetails';
import { useFamily } from '@/features/family/useFamily';
import { LANGUAGES, localeFor } from '@/lib/i18n';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, GlassSurface, InfoRow, LoadingDots, PressableScale, ProgressBar, Screen, palette, space } from '@/ui';

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
  const account = useSession((s) => s.account);
  const { mother, accountId, isCaregiver } = useFamily();
  // Read before consent (her record loads only after it): see onboardingDetails.ts.
  const details = useOnboardingDetails();
  const [step, setStep] = useState(0);
  const [channels, setChannels] = useState<string[]>(['app', 'whatsapp']);

  const toggle = (c: string) => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const [saving, setSaving] = useState(false);
  // The server no longer lets this account see her record (a caregiver the mother removed): no retry loop.
  const [noAccess, setNoAccess] = useState(false);
  // The app opens only once the server has her consent (Supabase mode); the demo records it on the phone.
  async function next() {
    if (step < TOTAL - 1) return setStep(step + 1);
    setSaving(true);
    try {
      await recordConsent(channels, lang);
      complete(accountId, channels);
    } catch (e) {
      // PT404 is "not visible": not a network problem, and trying again will not help.
      if (e instanceof RemoteError && e.code === 'PT404') setNoAccess(true);
      else Alert.alert(t('common.errorTitle'), t('auth.network'));
    } finally {
      setSaving(false);
    }
  }

  if (noAccess || details.status === 'noAccess') return <NoAccess caregiver={isCaregiver} motherName={mother?.name ?? account?.family?.motherName} />;

  const footer = (
    <View style={{ gap: 8 }}>
      <Button label={step === 1 ? t('on.agree') : step === TOTAL - 1 ? t('on.finish') : t('common.continue')} onPress={next} loading={saving} disabled={step === 3 && channels.length === 0} />
      {step === 1 && <Button variant="secondary" label={t('common.signOut')} onPress={() => confirmSignOut(signOut)} />}
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
          <DetailsCard state={details} lang={lang} />
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

/** ON-03 "Your details": loading, error (with retry) or her details. Her MCH id and EDD are hers: a caregiver is not sent them. */
function DetailsCard({ state, lang }: { state: DetailsState; lang: string }) {
  const { t } = useTranslation();
  if (state.status === 'loading' || state.status === 'noAccess') {
    return (
      <Card style={styles.centered}>
        <LoadingDots color={palette.rose600} />
        <AppText tone="secondary">{t('on.detailsLoading')}</AppText>
      </Card>
    );
  }
  if (state.status === 'error') {
    return (
      <Card style={styles.centered}>
        <AppText tone="secondary" align="center">
          {t('on.detailsError')}
        </AppText>
        <Button variant="secondary" label={t('common.tryAgain')} onPress={state.retry} />
      </Card>
    );
  }
  const d = state.details;
  const caregiver = d.role === 'caregiver';
  return (
    <Card>
      <InfoRow label={t('family.me.name')} value={d.name || undefined} />
      {caregiver && <InfoRow label="↳" value={d.motherName || undefined} />}
      <InfoRow label={t('family.me.phone')} value={d.phone} />
      <InfoRow label={t('family.card.f.hospital')} value={d.hospitalName} />
      <InfoRow label={t('family.doctor')} value={d.doctorName ?? t('family.noDoctor')} />
      {!caregiver && <InfoRow label={t('on.mchId')} value={d.mchId} />}
      {!caregiver && d.edd ? (
        <InfoRow label={t('family.dueDate')} value={d.edd.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} />
      ) : null}
      {!caregiver && d.emergency ? <InfoRow label={t('family.card.f.emergency')} value={d.emergency} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', gap: space.sm },
  lang: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg },
  langOn: { borderWidth: 2, borderColor: palette.rose300 },
  point: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  pointIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' },
});
