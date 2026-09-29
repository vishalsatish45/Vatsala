import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette } from './tokens';

type Props<T extends string> = { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void };

/** Text tabs with a rose underline (inspiration B "Rankings | Activity"). */
export function UnderlineTabs<T extends string>({ tabs, value, onChange }: Props<T>) {
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <PressableScale key={t.value} onPress={() => onChange(t.value)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.tab} haptic={false}>
              <AppText variant="bodyMedium" tone={active ? 'primary' : 'faint'}>
                {t.label}
                {t.count ? ` · ${t.count}` : ''}
              </AppText>
              <View style={[styles.bar, active && styles.barActive]} />
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: palette.divider },
  row: { gap: 22 },
  tab: { paddingTop: 6, gap: 8 },
  bar: { height: 2.5, borderRadius: 2, backgroundColor: 'transparent' },
  barActive: { backgroundColor: palette.rose500 },
});
