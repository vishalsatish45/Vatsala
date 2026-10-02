import { useState, type ReactNode } from 'react';
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
  /** Centred under the title, e.g. the Family "Me | Baby" switch. Collapses when it renders nothing. */
  below?: ReactNode;
  /** Keep the title in the true middle (default). Off lets a long title use the space beside narrow sides. */
  centerTitle?: boolean;
  /** Large bold page title for top-level tab pages. */
  large?: boolean;
};

/** Glass back button · centred title · actions (inspiration A), with an optional centred row below. */
export function TopBar({ title, back, left, right, below, centerTitle = true, large }: Props) {
  // Both sides take the wider side's width, so the title sits in the true middle of the screen.
  const [leftW, setLeftW] = useState(0);
  const [rightW, setRightW] = useState(0);
  const side = centerTitle ? { width: Math.max(44, leftW, rightW) } : { minWidth: 44 };
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <View style={[styles.side, side]}>
          <View style={styles.row} onLayout={(e) => setLeftW(e.nativeEvent.layout.width)}>
            {back ? <GlassIconButton icon={ChevronLeft} accessibilityLabel="Back" onPress={() => router.back()} /> : left}
          </View>
        </View>
        <AppText variant={large ? 'pageTitle' : 'headline'} align="center" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
        <View style={[styles.side, styles.right, side]}>
          <View style={styles.row} onLayout={(e) => setRightW(e.nativeEvent.layout.width)}>
            {right}
          </View>
        </View>
      </View>
      {below && <View style={styles.below}>{below}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: GUTTER, paddingVertical: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  side: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  right: { justifyContent: 'flex-end' },
  title: { flex: 1, marginHorizontal: 8 },
  below: { alignItems: 'center' },
});
