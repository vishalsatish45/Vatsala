import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { palette, radius } from './tokens';

type Props = { progress: number; label?: string; leftCaption?: string; rightCaption?: string };

/** Rounded progress bar with captions — "24/40 weeks · 60%" (inspiration A). */
export function ProgressBar({ progress, label, leftCaption, rightCaption }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      {!!label && <AppText variant="label">{label}</AppText>}
      <View style={styles.track}>
        <LinearGradient
          colors={[palette.rose300, palette.rose500]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, { width: `${pct}%` }]}
        />
      </View>
      {(!!leftCaption || !!rightCaption) && (
        <View style={styles.captions}>
          <AppText variant="caption" tone="secondary">
            {leftCaption}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {rightCaption}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.7)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  captions: { flexDirection: 'row', justifyContent: 'space-between' },
});
