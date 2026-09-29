import { Pressable, StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Plus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import type { Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { GlassSurface } from './GlassSurface';
import { useMood } from './mood';
import { PressableScale } from './PressableScale';
import { elevation, palette } from './tokens';

export type NavItem = { name: string; href: Href; icon: LucideIcon; label: string };

type Props = {
  left: [NavItem, NavItem];
  right: [NavItem, NavItem];
  onCenterPress: () => void;
  centerLabel: string;
};

const CIRCLE = 48;
const CENTER = 64;

type NavCircleProps = TabTriggerSlotProps & { icon: LucideIcon; label: string };

/** One glass circle; filled rose when its tab is focused. Receives trigger props via asChild. */
function NavCircle({ icon: Icon, label, isFocused, onPress, onLongPress, ref }: NavCircleProps) {
  return (
    <Pressable
      ref={ref}
      onPress={(e) => {
        void Haptics.selectionAsync();
        onPress?.(e);
      }}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!isFocused }}
      hitSlop={4}
    >
      {isFocused ? (
        <View style={[styles.circle, styles.active, elevation.float]}>
          <Icon size={22} color={palette.white} strokeWidth={1.9} />
        </View>
      ) : (
        <GlassSurface strong radius={CIRCLE / 2} elevation="card" style={styles.circle}>
          <Icon size={22} color={palette.rose600} strokeWidth={1.75} />
        </GlassSurface>
      )}
    </Pressable>
  );
}

/**
 * Floating navbar (inspiration A): 4 glass circles + a larger rose centre action button with a glow.
 * No bar background — content scrolls underneath. Must be rendered inside expo-router/ui <Tabs>.
 */
export function FloatingNavBar({ left, right, onCenterPress, centerLabel }: Props) {
  const insets = useSafeAreaInsets();
  const mood = useMood();
  const bottom = Math.max(insets.bottom, 8) + 8;
  const renderItem = (item: NavItem) => (
    <TabTrigger key={item.name} name={item.name} asChild>
      <NavCircle icon={item.icon} label={item.label} />
    </TabTrigger>
  );

  return (
    <>
      {/* Content dissolves into the background before it reaches the bar. */}
      <LinearGradient
        pointerEvents="none"
        colors={[mood.bgGradient[2] + '00', mood.bgGradient[2] + 'E6', mood.bgGradient[2]]}
        locations={[0, 0.55, 1]}
        style={[styles.scrim, { height: bottom + CENTER + 48 }]}
      />
      <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
        {left.map(renderItem)}
        <PressableScale onPress={onCenterPress} accessibilityRole="button" accessibilityLabel={centerLabel} pressedScale={0.92} style={[styles.centerShadow, elevation.glow]}>
          <LinearGradient colors={[palette.rose300, palette.rose500]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.center}>
            <View style={styles.centerRing}>
              <Plus size={26} color={palette.white} strokeWidth={2.2} />
            </View>
          </LinearGradient>
        </PressableScale>
        {right.map(renderItem)}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // Shadow must follow the circle, not the wrapper's square bounds.
  centerShadow: { borderRadius: CENTER / 2 },
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: palette.rose500 },
  center: { width: CENTER, height: CENTER, borderRadius: CENTER / 2, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  centerRing: {
    width: CENTER - 10,
    height: CENTER - 10,
    borderRadius: (CENTER - 10) / 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
