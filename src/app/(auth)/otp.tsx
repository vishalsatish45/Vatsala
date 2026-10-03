import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { DEMO_OTP } from '@/features/auth/demoAccounts';
import { authService, isMockAuth } from '@/features/auth/service';
import { useSession } from '@/state/session';
import { AppText, BrandBackdrop, Button, GlassSurface, Screen, TopBar, families, palette, space } from '@/ui';

const LEN = 6;
const RESEND_S = 30;

/** AU-03: OTP. On success the session flips and the root guards route to the right face. */
export default function Otp() {
  const { t } = useTranslation();
  const { phone = '' } = useLocalSearchParams<{ phone: string }>();
  const signIn = useSession((s) => s.signIn);
  const input = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState(RESEND_S);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  async function verify(value = code) {
    if (value.length !== LEN || loading) return;
    setLoading(true);
    setError(null);
    const res = await authService.verifyOtp(phone, value);
    setLoading(false);
    if (res.ok) {
      signIn(res.account);
    } else {
      const key = { wrong_code: 'auth.otpWrong', expired: 'auth.expired', network: 'auth.network', no_access: 'auth.noAccess' }[res.reason];
      setError(t(key));
      setCode('');
    }
  }

  const masked = phone ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : '';

  return (
    <Screen header={<TopBar back />} backdrop={<BrandBackdrop faint />} footer={<Button label={t('auth.verify')} onPress={() => verify()} disabled={code.length !== LEN} loading={loading} />}>
      <View style={{ gap: space.xs }}>
        <AppText variant="display">{t('auth.otpTitle')}</AppText>
        <AppText tone="secondary">{t('auth.otpSub', { phone: masked })}</AppText>
      </View>

      <Pressable onPress={() => input.current?.focus()} style={styles.boxes} accessibilityLabel={t('auth.otpTitle')}>
        {Array.from({ length: LEN }, (_, i) => {
          const focused = i === code.length;
          return (
            <GlassSurface key={i} strong radius={16} elevation="card" style={[styles.box, focused && styles.boxFocused]}>
              <AppText variant="stat" style={styles.digit}>
                {code[i] ?? ''}
              </AppText>
            </GlassSurface>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        value={code}
        onChangeText={(v) => {
          const next = v.replace(/\D/g, '').slice(0, LEN);
          setCode(next);
          setError(null);
          if (next.length === LEN) void verify(next);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LEN}
        autoFocus
        style={styles.hidden}
      />

      {!!error && <AppText tone="overdue">{error}</AppText>}
      {isMockAuth && (
        <AppText variant="caption" tone="secondary">
          {t('auth.demoSub', { code: DEMO_OTP })}
        </AppText>
      )}

      <Pressable
        disabled={left > 0}
        onPress={async () => {
          setLeft(RESEND_S);
          await authService.requestOtp(phone);
        }}
        accessibilityRole="button"
      >
        <AppText variant="label" tone={left > 0 ? 'faint' : 'accent'}>
          {left > 0 ? t('auth.resendIn', { s: left }) : t('auth.resend')}
        </AppText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: space.sm },
  box: { flex: 1, aspectRatio: 0.82, alignItems: 'center', justifyContent: 'center' },
  boxFocused: { borderWidth: 2, borderColor: palette.rose300 },
  digit: { fontFamily: families.latin.semibold },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
