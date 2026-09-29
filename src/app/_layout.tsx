import '@/lib/env'; // validate configuration first — fails fast with a clear message
import '@/lib/i18n';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/query';
import { useSession } from '@/state/session';
import { fontAssets } from '@/ui/fonts';
import { palette } from '@/ui/tokens';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const hydrated = useSession((s) => s.hydrated);
  const account = useSession((s) => s.account);
  const face = useSession((s) => s.face);

  const ready = (fontsLoaded || !!fontError) && hydrated;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const signedIn = !!account;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: palette.rose100 } }}>
          {/* Always available: redirects to the right place for this session. */}
          <Stack.Screen name="index" />

          {/* Route guards are UX only — real enforcement is Postgres RLS (PRD §15.1). */}
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn && !face}>
            <Stack.Screen name="choose-face" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'care'}>
            <Stack.Screen name="care" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'family'}>
            <Stack.Screen name="family" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
