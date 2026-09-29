import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { space } from './tokens';

/** Serif section title with an optional right-side action (inspiration B). */
export function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children?: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <AppText variant="title">{title}</AppText>
        {!!action && (
          <PressableScale onPress={onAction} accessibilityRole="button" hitSlop={8}>
            <AppText variant="label" tone="accent">
              {action}
            </AppText>
          </PressableScale>
        )}
      </View>
      {children}
    </View>
  );
}

/** Label/value line inside cards. */
export function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.info}>
      <AppText variant="label" tone="secondary" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="bodyMedium" style={{ flex: 1.4, textAlign: 'right' }}>
        {value || '—'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  info: { flexDirection: 'row', gap: space.sm, paddingVertical: 6 },
});
