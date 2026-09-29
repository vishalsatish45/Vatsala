import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { palette, space } from './tokens';

type Bar = { label: string; value: number | null; highlight?: boolean };

const H = 150;

/**
 * Bar chart (inspiration B): soft bars, one highlighted bar with a value bubble, and a
 * dotted average line with a dark tag. Values are 0..1 (operational rates only).
 */
export function BarChart({ bars, average, format = (v) => `${Math.round(v * 100)}%` }: { bars: Bar[]; average?: number | null; format?: (v: number) => string }) {
  return (
    <View>
      <View style={styles.plot}>
        {average != null && (
          <View style={[styles.avg, { bottom: average * H }]}>
            <View style={styles.avgTag}>
              <AppText variant="caption" tone="onPrimary" style={{ fontSize: 10, lineHeight: 13 }}>
                Avg {format(average)}
              </AppText>
            </View>
            <View style={styles.avgLine} />
          </View>
        )}
        {bars.map((b, i) => {
          const h = b.value == null ? 6 : Math.max(8, b.value * H);
          return (
            <View key={i} style={styles.col}>
              {b.highlight && b.value != null && (
                <View style={styles.bubble}>
                  <AppText variant="caption" tone="onPrimary" style={{ fontSize: 11, lineHeight: 14 }}>
                    {format(b.value)}
                  </AppText>
                </View>
              )}
              {b.highlight ? (
                <LinearGradient colors={[palette.rose300, palette.rose500]} style={[styles.bar, { height: h }]} />
              ) : (
                <View style={[styles.bar, { height: h, backgroundColor: b.value == null ? palette.divider : 'rgba(201,85,127,0.18)' }]} />
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.labels}>
        {bars.map((b, i) => (
          <AppText key={i} variant="caption" tone={b.highlight ? 'accent' : 'faint'} style={styles.label} numberOfLines={1}>
            {b.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { height: H + 28, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 28 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 10 },
  bubble: { backgroundColor: palette.rose500, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 },
  avg: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', zIndex: 2 },
  avgTag: { backgroundColor: palette.ink, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  avgLine: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: palette.ink, opacity: 0.45 },
  labels: { flexDirection: 'row', gap: 8, marginTop: space.xs },
  label: { flex: 1, textAlign: 'center' },
});
