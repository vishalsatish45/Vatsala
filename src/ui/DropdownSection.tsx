import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronDown, type LucideIcon } from 'lucide-react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { PressableScale } from './PressableScale';
import { palette, radius, space } from './tokens';

export type DropdownSectionProps = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  badge?: ReactNode;
  isOpen?: boolean;
  defaultOpen?: boolean;
  onToggle?: (nextOpen: boolean) => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Collapsible dropdown section with glassmorphic header, tactile press response,
 * and animated chevron indicator.
 */
export function DropdownSection({
  title,
  subtitle,
  icon: Icon,
  iconColor = palette.rose600,
  iconBg = palette.rose50,
  badge,
  isOpen: controlledIsOpen,
  defaultOpen = false,
  onToggle,
  children,
  style,
  contentStyle,
}: DropdownSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

  const rotation = useSharedValue(isOpen ? 180 : 0);

  useEffect(() => {
    rotation.set(withTiming(isOpen ? 180 : 0, { duration: 220 }));
  }, [isOpen, rotation]);

  const handleToggle = () => {
    const next = !isOpen;
    if (controlledIsOpen === undefined) {
      setInternalOpen(next);
    }
    onToggle?.(next);
  };

  const chevronAnimStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  return (
    <View style={[styles.container, style]}>
      <PressableScale
        onPress={handleToggle}
        pressedScale={0.98}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={title}
        accessibilityHint={isOpen ? 'Tap to collapse' : 'Tap to expand'}
      >
        <GlassSurface strong radius={radius.lg} elevation="card" style={styles.header}>
          {Icon && (
            <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
              <Icon size={20} color={iconColor} />
            </View>
          )}
          <View style={styles.textWrap}>
            <AppText variant="headline" numberOfLines={1}>
              {title}
            </AppText>
            {!!subtitle && (
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {subtitle}
              </AppText>
            )}
          </View>
          {badge}
          <Animated.View style={[styles.chevronWrap, chevronAnimStyle]}>
            <ChevronDown size={20} color={isOpen ? palette.rose600 : palette.inkFaint} />
          </Animated.View>
        </GlassSurface>
      </PressableScale>

      {isOpen && (
        <Animated.View entering={FadeInDown.duration(200)} style={[styles.content, contentStyle]}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    gap: space.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  chevronWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  content: {
    gap: space.sm,
  },
});
