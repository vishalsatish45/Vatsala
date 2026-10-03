import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { palette } from './tokens';

type Props = {
  /** Dot diameter; the dots rise by about their own size. */
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

const STAGGER = 140; // ms between one dot and the next — the wave
const RISE = 260;

function Dot({ index, size, color }: { index: number; size: number; color: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    const ease = Easing.inOut(Easing.quad);
    y.value = withDelay(
      index * STAGGER,
      withRepeat(withSequence(withTiming(-size, { duration: RISE, easing: ease }), withTiming(0, { duration: RISE, easing: ease }), withTiming(0, { duration: STAGGER * 2 })), -1),
    );
  }, [index, size, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** Loading: three dots rising and falling in turn, like a wave. */
export function LoadingDots({ size = 10, color = palette.rose500, accessibilityLabel = 'Loading' }: Props) {
  return (
    <View style={[styles.row, { gap: size * 0.7, paddingTop: size }]} accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} size={size} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' } });
