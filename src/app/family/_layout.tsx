import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LockKeyhole } from 'lucide-react-native';

import { unlock } from '@/lib/device';
import { useSession } from '@/state/session';
import { Atmosphere, AppText, Button, palette, space } from '@/ui';
import { MoodProvider } from '@/ui/mood';

/** Shown over the Family face when app lock is on (PRD F-03 / FM-06 — shared-phone privacy). */
function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const tryUnlock = async () => {
    try {
      if (await unlock(t('family.lock.unlock'))) onUnlock();
    } catch {
      /* alert already shown */
    }
  };
  useEffect(() => {
    void tryUnlock();
  }, []);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Atmosphere blobCenterY={300} />
      <View style={styles.lock}>
        <LockKeyhole size={56} color={palette.rose600} strokeWidth={1.5} />
        <AppText variant="display" align="center">
          {t('family.lock.locked')}
        </AppText>
        <AppText tone="secondary" align="center">
          {t('family.lock.lockedSub')}
        </AppText>
        <Button label={t('family.lock.unlock')} onPress={tryUnlock} />
      </View>
    </View>
  );
}

/** Family face — full rose/lavender glass atmosphere (DESIGN.md §6). First login goes through onboarding (F-03). */
export default function FamilyLayout() {
  const accountId = useSession((s) => s.account?.id ?? '');
  const onboarded = useSession((s) => !!s.familyPrefs[accountId]);
  const lockOn = useSession((s) => !!s.familyPrefs[accountId]?.lock);
  const [locked, setLocked] = useState(lockOn);

  // Re-lock whenever the app goes to the background.
  useEffect(() => {
    if (!lockOn) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, [lockOn]);

  return (
    <MoodProvider mood="family">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>
      {lockOn && locked && <LockScreen onUnlock={() => setLocked(false)} />}
    </MoodProvider>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
});
