import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Stack } from 'expo-router';

import { SyncGate } from '@/features/sync/SyncGate';
import { canUseDeviceLock, unlock } from '@/lib/device';
import { useCareLock } from '@/state/careLock';
import { useSession } from '@/state/session';
import { LockScreen } from '@/ui';
import { MoodProvider } from '@/ui/mood';

const IDLE_MS = 10 * 60 * 1000;

/**
 * Care Team face — quieter, denser atmosphere (DESIGN.md §7). Locks after 10 min idle
 * (PRD §15.1); unlock with fingerprint / device PIN, or re-login on devices without one.
 */
export default function CareLayout() {
  const { locked, lock, release } = useCareLock();
  const signOut = useSession((s) => s.signOut);
  const name = useSession((s) => s.account?.name ?? '');
  // Last touch; 0 until the first interaction or tick (set outside render, so render stays pure).
  const last = useRef(0);
  const [hasDeviceLock, setHasDeviceLock] = useState<boolean>();

  const touch = useCallback(() => {
    last.current = Date.now();
  }, []);

  useEffect(() => {
    last.current = Date.now();
    const id = setInterval(() => {
      if (!useCareLock.getState().locked && Date.now() - last.current > IDLE_MS) lock();
    }, 15_000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && Date.now() - last.current > IDLE_MS) lock();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [lock]);

  async function tryUnlock() {
    try {
      const ok = hasDeviceLock ?? (await canUseDeviceLock());
      setHasDeviceLock(ok);
      if (!ok || (await unlock(`Unlock for ${name}`))) {
        touch();
        release();
      }
    } catch {
      touch();
      release();
    }
  }

  return (
    <MoodProvider mood="care">
      <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => (touch(), false)}>
        <SyncGate>
          <Stack screenOptions={{ headerShown: false }} />
        </SyncGate>
        {locked && (
          <LockScreen
            title="Locked"
            body={`Care Team session paused after 10 minutes without activity. Unlock to continue as ${name}.`}
            unlockLabel="Unlock"
            onUnlock={tryUnlock}
            secondary={{ label: 'Sign out', onPress: () => { release(); signOut(); } }}
          />
        )}
      </View>
    </MoodProvider>
  );
}
