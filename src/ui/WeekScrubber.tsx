import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { palette, space } from './tokens';

const MARKS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40];

/** Pregnancy week scale with a knob at the current week (inspiration C "12W 16W 20W…"). */
export function WeekScrubber({ week, label }: { week: number; label?: string }) {
  const pct = Math.min(1, Math.max(0, week / 40));
  return (
    <GlassSurface strong style={styles.card}>
      {!!label && <AppText variant="headline">{label}</AppText>}
      <View style={styles.marks}>
        {MARKS.map((m) => (
          <AppText key={m} variant="caption" tone={m <= week ? 'secondary' : 'faint'} style={styles.mark}>
            {m}
          </AppText>
        ))}
      </View>
      <View style={styles.track}>
        <LinearGradient colors={[palette.rose300, palette.rose500]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${pct * 100}%` }]} />
        <View style={[styles.knob, { left: `${pct * 100}%` }]}>
          <AppText variant="caption" tone="onPrimary">
            {week}
          </AppText>
        </View>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  marks: { flexDirection: 'row', justifyContent: 'space-between' },
  mark: { width: 22, textAlign: 'center' },
  track: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.8)', justifyContent: 'center', marginVertical: 8 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  knob: {
    position: 'absolute',
    marginLeft: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.rose500,
    borderWidth: 3,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
