import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FAMILY_ROUTES } from '@/features/family/routes';
import { useFamily } from '@/features/family/useFamily';
import { SyncGate } from '@/features/sync/SyncGate';
import { unlock } from '@/lib/device';
import { useSession } from '@/state/session';
import { LockScreen } from '@/ui';
import { MoodProvider } from '@/ui/mood';

/** Shown over the Family face when app lock is on (PRD F-03 / FM-06 — shared-phone privacy). */
function FamilyLock({ onUnlock }: { onUnlock: () => void }) {
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
  return <LockScreen title={t('family.lock.locked')} body={t('family.lock.lockedSub')} unlockLabel={t('family.lock.unlock')} onUnlock={tryUnlock} />;
}

/** Family face — full rose/lavender glass atmosphere (DESIGN.md §6). First login goes through onboarding (F-03). */
export default function FamilyLayout() {
  const accountId = useSession((s) => s.account?.id ?? '');
  const onboarded = useSession((s) => !!s.familyPrefs[accountId]);
  const lockOn = useSession((s) => !!s.familyPrefs[accountId]?.lock);
  const { revoked } = useFamily();
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
      <SyncGate>
        <Stack screenOptions={{ headerShown: false }}>
          {/* A caregiver the mother removed sees only "no longer shared" + sign out. */}
          <Stack.Protected guard={revoked}>
            <Stack.Screen name="no-access" />
          </Stack.Protected>
          <Stack.Protected guard={!revoked && !onboarded}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>
          {/* Every other Family route opens only after consent (a screen not listed here would be reachable without it). */}
          <Stack.Protected guard={!revoked && onboarded}>
            <Stack.Screen name="(tabs)" />
            {FAMILY_ROUTES.map((name) => (
              <Stack.Screen key={name} name={name} />
            ))}
          </Stack.Protected>
        </Stack>
      </SyncGate>
      {lockOn && locked && <FamilyLock onUnlock={() => setLocked(false)} />}
    </MoodProvider>
  );
}
