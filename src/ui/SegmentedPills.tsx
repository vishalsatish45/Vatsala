import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette, radius } from './tokens';

type Option<T extends string> = { value: T; label: string; count?: number };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
};

/** Pill group — active is an ink pill with white text, inactive is beige (inspiration B). */
export function SegmentedPills<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.pill, { backgroundColor: active ? palette.ink : 'rgba(255,255,255,0.6)' }]}
          >
            <AppText variant="label" style={{ color: active ? palette.white : palette.ink }}>
              {o.label}
            </AppText>
            {o.count !== undefined && (
              <View style={[styles.count, { backgroundColor: active ? 'rgba(255,255,255,0.18)' : palette.rose50 }]}>
                <AppText variant="caption" style={{ color: active ? palette.white : palette.inkSoft }}>
                  {o.count}
                </AppText>
              </View>
            )}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  count: { borderRadius: radius.pill, paddingHorizontal: 7, minWidth: 22, alignItems: 'center' },
});
