import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { palette, radius } from './tokens';

export type IntensityValue = 'routine' | 'enhanced' | 'close';

const LABEL: Record<IntensityValue, string> = { routine: 'Routine', enhanced: 'Enhanced', close: 'Close follow-up' };
const DOTS: Record<IntensityValue, number> = { routine: 1, enhanced: 2, close: 3 };

export const intensityLabel = (i: IntensityValue) => LABEL[i];

/**
 * Clinician-set follow-up intensity — neutral styling with 1/2/3 dots.
 * Deliberately NOT red/amber: it is a care-plan choice, not a risk score (PRD §2.2).
 */
export function IntensityPill({ value }: { value: IntensityValue }) {
  return (
    <View style={styles.pill} accessibilityLabel={`Follow-up intensity: ${LABEL[value]}`}>
      <View style={styles.dots}>
        {[1, 2, 3].map((d) => (
          <View key={d} style={[styles.dot, { backgroundColor: d <= DOTS[value] ? palette.ink : palette.softBorder }]} />
        ))}
      </View>
      <AppText variant="label">{LABEL[value]}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: palette.softBorder,
  },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
