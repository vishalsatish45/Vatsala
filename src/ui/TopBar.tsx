import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { AppText } from './AppText';
import { GlassIconButton } from './GlassIconButton';
import { GUTTER } from './tokens';

type Props = {
  title?: string;
  /** Show a glass back button. */
  back?: boolean;
  left?: ReactNode;
  right?: ReactNode;
};

/** Glass back button · centred title · actions (inspiration A). */
export function TopBar({ title, back, left, right }: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {back ? <GlassIconButton icon={ChevronLeft} accessibilityLabel="Back" onPress={() => router.back()} /> : left}
      </View>
      <AppText variant="headline" align="center" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingVertical: 8, minHeight: 60 },
  side: { minWidth: 44, flexDirection: 'row', gap: 8 },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, marginHorizontal: 8 },
});
