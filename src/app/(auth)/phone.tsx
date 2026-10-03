import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DEMO_ACCOUNTS, DEMO_OTP } from '@/features/auth/demoAccounts';
import { authService, isMockAuth } from '@/features/auth/service';
import { AppText, Avatar, BrandBackdrop, Button, GlassSurface, ListRow, Screen, TopBar, families, palette, space } from '@/ui';

const roleLabel = (a: (typeof DEMO_ACCOUNTS)[number]) =>
  [a.care && `Care team · ${a.care.role}`, a.family && `Family · ${a.family.role}`].filter(Boolean).join(' + ');

/** AU-02: phone number entry. */
export default function Phone() {
  const { t } = useTranslation();
  // The welcome button chosen (care / family): checked after the OTP, never before (that would tell anyone whose number it is)
  const { door } = useLocalSearchParams<{ door?: string }>();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = /^[6-9]\d{9}$/.test(phone);

  async function submit() {
    if (!valid) return setError(t('auth.phoneInvalid'));
    setLoading(true);
    setError(null);
    const res = await authService.requestOtp(phone);
    setLoading(false);
    if (!res.ok) return setError(t(res.reason === 'not_registered' ? 'auth.notRegistered' : res.reason === 'rate_limited' ? 'auth.rateLimited' : 'auth.network'));
    router.push({ pathname: '/otp', params: door ? { phone, door } : { phone } });
  }

  return (
    <Screen header={<TopBar back />} backdrop={<BrandBackdrop faint />} footer={<Button label={t('common.continue')} onPress={submit} loading={loading} />}>
      <View style={{ gap: space.xs }}>
        <AppText variant="display">{t('auth.phoneTitle')}</AppText>
        <AppText tone="secondary">{t('auth.phoneSub')}</AppText>
      </View>

      <GlassSurface strong style={styles.field}>
        <AppText variant="headline" tone="secondary">
          +91
        </AppText>
        <View style={styles.divider} />
        <TextInput
          value={phone}
          onChangeText={(v) => {
            setPhone(v.replace(/\D/g, '').slice(0, 10));
            setError(null);
          }}
          keyboardType="number-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={10}
          autoFocus
          placeholder="98765 43210"
          placeholderTextColor={palette.inkFaint}
          style={styles.input}
          accessibilityLabel={t('auth.phoneTitle')}
          onSubmitEditing={submit}
        />
      </GlassSurface>
      {!!error && <AppText tone="overdue">{error}</AppText>}

      {isMockAuth && (
        <View style={{ gap: space.xs, marginTop: space.md }}>
          <AppText variant="title">{t('auth.demoTitle')}</AppText>
          <AppText variant="caption" tone="secondary">
            {t('auth.demoSub', { code: DEMO_OTP })}
          </AppText>
          {DEMO_ACCOUNTS.map((a) => (
            <ListRow key={a.id} leading={<Avatar name={a.name} size={40} />} title={a.name} subtitle={`${a.phone} · ${roleLabel(a)}`} onPress={() => setPhone(a.phone)} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 64, gap: space.sm },
  divider: { width: 1, height: 28, backgroundColor: palette.hairline },
  input: { flex: 1, fontFamily: families.latin.semibold, fontSize: 22, letterSpacing: 1, color: palette.ink, paddingVertical: 12 },
});
