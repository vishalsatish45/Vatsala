import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { palette, radius, space } from './tokens';

type Props = { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode };

/** Bottom sheet (radius 32, strong glass) for overrides, outcomes and pickers (DESIGN.md §4). */
export function Sheet({ visible, onClose, title, subtitle, children, footer }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.wrap, { paddingBottom: insets.bottom + space.sm }]}>
        <GlassSurface strong radius={radius.sheet} style={styles.sheet}>
          <View style={styles.grabber} />
          <AppText variant="title">{title}</AppText>
          {!!subtitle && (
            <AppText variant="caption" tone="secondary">
              {subtitle}
            </AppText>
          )}
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: space.sm, paddingTop: space.sm }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer && <View style={{ paddingTop: space.md, gap: space.sm }}>{footer}</View>}
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(46,31,42,0.28)' },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  sheet: { padding: space.lg, paddingTop: space.sm, gap: 2, backgroundColor: 'rgba(255,255,255,0.6)' },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: palette.divider, marginBottom: space.sm },
});
