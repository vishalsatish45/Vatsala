import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Baby, UserRound } from 'lucide-react-native';

import { useFamilyFocusStore, type FamilyFocus } from '@/state/familyFocus';
import { AppText, GlassSurface, PressableScale, palette, radius } from '@/ui';

import { useFamily } from './useFamily';

/**
 * Mother / baby focus for the shared Family screens. Only meaningful once a live baby is
 * recorded; before that (or after a loss) the focus is always the mother.
 */
export function useFamilyFocus() {
  const { pregnancy, babies } = useFamily();
  const stored = useFamilyFocusStore((s) => s.focus);
  const setFocus = useFamilyFocusStore((s) => s.setFocus);
  const canSwitch = pregnancy?.status === 'delivered' && babies.length > 0;
  return { focus: (canSwitch ? stored : 'mother') as FamilyFocus, setFocus, canSwitch };
}

const SEG = 104;
const PAD = 4;

/** "Me | Baby" segmented switch with a sliding rose thumb, centred under the top-bar title. Renders nothing before delivery. */
export function FocusSwitch() {
  const { t } = useTranslation();
  const { isCaregiver } = useFamily();
  const { focus, setFocus, canSwitch } = useFamilyFocus();
  const x = useSharedValue(focus === 'baby' ? SEG : 0);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  useEffect(() => {
    // Ease-out with no overshoot, so the thumb never slides past the track's edge.
    x.set(withTiming(focus === 'baby' ? SEG : 0, { duration: 240, easing: Easing.out(Easing.cubic) }));
  }, [focus, x]);

  if (!canSwitch) return null;

  const options: { value: FamilyFocus; label: string; icon: typeof UserRound }[] = [
    { value: 'mother', label: isCaregiver ? t('family.focus.mother') : t('family.focus.me'), icon: UserRound },
    { value: 'baby', label: t('family.focus.baby'), icon: Baby },
  ];

  return (
    <GlassSurface radius={radius.pill} elevation="card" style={styles.track}>
      <View style={styles.clip}>
        <Animated.View pointerEvents="none" style={[styles.thumb, thumb]}>
          <LinearGradient colors={[palette.rose500, palette.rose600]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]} />
        </Animated.View>
        <View accessibilityRole="tablist" style={styles.row}>
          {options.map(({ value, label, icon: Icon }) => {
            const active = focus === value;
            return (
              <PressableScale
                key={value}
                onPress={() => setFocus(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={label}
                hitSlop={4}
                style={styles.seg}
              >
                <Icon size={16} color={active ? palette.white : palette.inkSoft} strokeWidth={2} />
                <AppText variant="label" numberOfLines={1} style={{ color: active ? palette.white : palette.inkSoft }}>
                  {label}
                </AppText>
              </PressableScale>
            );
          })}
        </View>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  track: { padding: PAD, marginTop: 12 },
  clip: { borderRadius: radius.pill, overflow: 'hidden' },
  row: { flexDirection: 'row' },
  seg: { width: SEG, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  thumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SEG,
    height: 36,
    borderRadius: radius.pill,
    ...Platform.select({
      ios: { shadowColor: palette.rose600, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
      default: { boxShadow: '0px 4px 10px rgba(201, 85, 127, 0.35)' },
    }),
  },
});
