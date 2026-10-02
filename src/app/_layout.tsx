import '@/lib/env'; // validate configuration first — fails fast with a clear message
import '@/lib/i18n';

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider } from '@tanstack/react-query';

import { watchNetwork } from '@/lib/device';
import { useNetwork } from '@/lib/network';
import { queryClient } from '@/lib/query';
import { useSession } from '@/state/session';
import { fontAssets } from '@/ui/fonts';
import { AppText, Atmosphere, Button, OfflineBanner, space } from '@/ui';
import { palette } from '@/ui/tokens';

void SplashScreen.preventAutoHideAsync();

/** Friendly crash screen (DESIGN.md §8 error state) instead of a red box in production. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Atmosphere blobCenterY={260} />
      <AppText variant="display" align="center">
        {t('common.errorTitle')}
      </AppText>
      <AppText tone="secondary" align="center">
        {t('common.errorBody')}
      </AppText>
      <Button label={t('common.tryAgain')} onPress={retry} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const hydrated = useSession((s) => s.hydrated);
  const account = useSession((s) => s.account);
  const face = useSession((s) => s.face);

  const ready = (fontsLoaded || !!fontError) && hydrated;
  const { t } = useTranslation();
  const setOnline = useNetwork((s) => s.setOnline);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void watchNetwork(setOnline).then((fn) => (stop = fn));
    return () => stop?.();
  }, [setOnline]);

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
        <OfflineBanner offlineLabel={t('common.offline')} syncingLabel={t('common.syncing')} />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
