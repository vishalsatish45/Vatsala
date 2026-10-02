import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CircleAlert, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOutbox } from '@/data/outbox';
import { refresh, useSync } from '@/data/sync';
import { isRemote } from '@/lib/supabase';
import { AppText, Button, GlassSurface, palette, space } from '@/ui';

/**
 * Supabase mode: holds a face's screens until its first load from the server (they would otherwise flash empty),
 * and offers a retry if that load fails. Later reloads happen in the background.
 */
export function SyncGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const phase = useSync((s) => s.phase);
  const error = useSync((s) => s.error);
  if (!isRemote || (phase !== 'loading' && phase !== 'error')) return <>{children}</>;
  return (
    <View style={styles.center}>
      {phase === 'loading' ? (
        <ActivityIndicator color={palette.rose500} size="large" />
      ) : (
        <View style={{ gap: space.md, alignItems: 'center' }}>
          <AppText variant="title" align="center">
            {t('common.errorTitle')}
          </AppText>
          <AppText tone="secondary" align="center">
            {t('auth.network')}
          </AppText>
          {!!error && __DEV__ && (
            <AppText variant="caption" tone="faint" align="center">
              {error}
            </AppText>
          )}
          <Button label={t('common.tryAgain')} onPress={() => void refresh()} />
        </View>
      )}
    </View>
  );
}

/** A write the server refused (role, stale record, invalid input) — shown with its reason; the screen is reloaded. */
export function SyncFailureBanner() {
  const failure = useOutbox((s) => s.failure);
  const dismiss = useOutbox((s) => s.dismissFailure);
  const insets = useSafeAreaInsets();
  if (!failure) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]}>
      <GlassSurface strong radius={18} elevation="float" style={styles.banner}>
        <CircleAlert size={18} color={palette.overdue} />
        <AppText variant="label" style={{ flex: 1 }}>
          Not saved: {failure.message}
        </AppText>
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12}>
          <X size={18} color={palette.inkSoft} />
        </Pressable>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  wrap: { position: 'absolute', left: space.md, right: space.md, zIndex: 101 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.md, paddingVertical: 12 },
});
