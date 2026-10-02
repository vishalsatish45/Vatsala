import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, HeartHandshake, MessageSquareText, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react-native';

import { withdrawConsent } from '@/data/sync';
import { useFamily } from '@/features/family/useFamily';
import { fmtShort } from '@/features/family/itemText';
import { cancelAllReminders } from '@/lib/device';
import { useSession } from '@/state/session';
import { AppText, Button, Card, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

function Point({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
      <Icon size={20} color={palette.rose600} style={{ marginTop: 2 }} />
      <AppText style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

/** FM-07 Consent: what was agreed, when, and withdrawal (PRD F-03). */
export default function Consent() {
  const { t, i18n } = useTranslation();
  const ctx = useFamily();
  const prefs = useSession((s) => s.familyPrefs[ctx.accountId]);
  const withdraw = useSession((s) => s.withdrawConsent);
  const [confirming, setConfirming] = useState(false);

  async function confirmWithdraw() {
    try {
      await cancelAllReminders();
    } catch {
      /* nothing scheduled or module unavailable */
    }
    try {
      await withdrawConsent(); // reaches the server before this phone signs out
    } catch {
      return Alert.alert(t('common.errorTitle'), t('auth.network'));
    }
    withdraw(ctx.accountId);
  }

  return (
    <Screen blob="none" header={<TopBar back title={t('family.consent.title')} />}>
      <AppText variant="display">{t('family.consent.title')}</AppText>
      {prefs && <AppText tone="secondary">{t('family.consent.version', { v: prefs.consentVersion, date: fmtShort(new Date(prefs.consentAt), i18n.language) })}</AppText>}
      <Card style={{ gap: space.md }}>
        <Point icon={Stethoscope} text={t('on.consent1')} />
        <Point icon={ShieldCheck} text={t('on.consent2')} />
        <Point icon={Bell} text={t('on.consent3')} />
        <Point icon={HeartHandshake} text={t('on.consent4')} />
        <Point icon={MessageSquareText} text={t('on.consent5')} />
      </Card>
      {!confirming ? (
        <Button variant="secondary" label={t('family.consent.withdraw')} onPress={() => setConfirming(true)} />
      ) : (
        <GlassSurface strong style={{ padding: space.lg, gap: space.md }}>
          <AppText>{t('family.consent.withdrawBody')}</AppText>
          <Button label={t('family.consent.confirm')} onPress={confirmWithdraw} />
          <Button variant="secondary" label={t('family.consent.cancel')} onPress={() => setConfirming(false)} />
        </GlassSurface>
      )}
    </Screen>
  );
}
