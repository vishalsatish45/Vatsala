import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Atmosphere } from './Atmosphere';
import { GUTTER, NAV_CLEARANCE } from './tokens';

type Props = {
  children: ReactNode;
  /** Rendered above the scroll area (e.g. TopBar). */
  header?: ReactNode;
  /** Pinned to the bottom (e.g. a primary button on forms). */
  footer?: ReactNode;
  scroll?: boolean;
  blob?: 'top' | 'none';
  blobCenterY?: number;
  /** Leave room for the floating navbar. */
  withNav?: boolean;
};

/** Screen scaffold: atmosphere background + safe areas + scroll with navbar clearance. */
export function Screen({ children, header, footer, scroll = true, blob = 'top', blobCenterY, withNav = false }: Props) {
  const bottomPad = withNav ? NAV_CLEARANCE : 32;
  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Atmosphere blob={blob} blobCenterY={blobCenterY} />
      {/* edge-to-edge Android doesn't resize for the keyboard, so pad on both platforms */}
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
          {header}
          {scroll ? (
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.content, styles.root]}>{children}</View>
          )}
          {footer && (
            <SafeAreaView edges={['bottom']} style={styles.footer}>
              {footer}
            </SafeAreaView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: GUTTER, gap: 16 },
  footer: { paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 12 },
});
