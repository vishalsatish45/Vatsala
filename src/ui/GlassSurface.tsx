import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { useMood } from './mood';
import { elevation as elev, radius as radii } from './tokens';

type Props = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** More opaque fill for text-heavy content. */
  strong?: boolean;
  radius?: number;
  elevation?: 'none' | 'card' | 'float';
};

/**
 * Frosted-glass card (inspiration A, DESIGN.md §3.7): a white → translucent vertical
 * gradient so the atmosphere shows through at the bottom, a soft white rim and a top
 * highlight. iOS adds real blur underneath; Android skips blur (needs a BlurTargetView
 * and is slow before SDK 31) — over our soft gradient it looks nearly identical.
 */
export function GlassSurface({ children, style, strong, radius = radii.card, elevation = 'float' }: Props) {
  const mood = useMood();
  const fill = strong ? mood.glassStrong : mood.glass;

  return (
    <View style={[{ borderRadius: radius }, elevation !== 'none' && elev[elevation], style]}>
      <View style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]} pointerEvents="none">
        {Platform.OS === 'ios' && <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={fill} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* soft top sheen */}
        <LinearGradient colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} style={styles.sheen} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.border, { borderRadius: radius, borderColor: mood.glassBorder }]} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  border: { borderWidth: 1.2 },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
});
