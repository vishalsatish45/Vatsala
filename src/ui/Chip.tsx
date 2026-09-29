import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette, radius } from './tokens';

type Variant = 'glass' | 'soft' | 'tag' | 'selected';

type Props = {
  label: string;
  icon?: LucideIcon;
  iconColor?: string;
  variant?: Variant;
  onPress?: () => void;
};

const bg: Record<Variant, string> = {
  glass: 'rgba(255,255,255,0.55)',
  soft: 'rgba(255,255,255,0.85)',
  tag: palette.lav100, // clinician tags (DESIGN.md §4 TagChip)
  selected: palette.ink,
};

/** Pill chip with optional icon badge (inspiration B). */
export function Chip({ label, icon: Icon, iconColor, variant = 'soft', onPress }: Props) {
  const fg = variant === 'selected' ? palette.white : variant === 'tag' ? palette.lav600 : palette.ink;
  const body = (
    <View style={[styles.chip, { backgroundColor: bg[variant] }, variant === 'glass' && styles.glassBorder, variant === 'soft' && styles.softBorder]}>
      {Icon && <Icon size={15} color={iconColor ?? fg} strokeWidth={2} />}
      <AppText variant="label" style={{ color: fg }} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: variant === 'selected' }}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  glassBorder: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  softBorder: { borderWidth: 1, borderColor: palette.softBorder },
});
