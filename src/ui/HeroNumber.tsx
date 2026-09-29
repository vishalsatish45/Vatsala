import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Chip } from './Chip';

type Props = {
  caption: string;
  value: string;
  /** Smaller suffix after the number, e.g. "th" or " days". */
  suffix?: string;
  subtitle?: string;
  chips?: string[];
};

/**
 * The one big thing on a screen — pregnancy week, baby age, items needing attention
 * (inspiration A: "Pregnancy Week: 24th"). Ink text, not white-on-pink, for contrast.
 */
export function HeroNumber({ caption, value, suffix, subtitle, chips }: Props) {
  return (
    <View style={styles.wrap} accessibilityRole="header" accessibilityLabel={`${caption} ${value}${suffix ?? ''}`}>
      <AppText variant="bodyMedium" tone="secondary" align="center">
        {caption}
      </AppText>
      <View style={styles.valueRow}>
        <AppText variant="hero">{value}</AppText>
        {!!suffix && (
          <AppText variant="stat" style={styles.suffix}>
            {suffix}
          </AppText>
        )}
      </View>
      {!!subtitle && (
        <AppText variant="body" tone="secondary" align="center">
          {subtitle}
        </AppText>
      )}
      {chips && chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((c) => (
            <Chip key={c} label={c} variant="glass" />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2, paddingVertical: 8 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-start' },
  suffix: { marginTop: 10, marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 10 },
});
