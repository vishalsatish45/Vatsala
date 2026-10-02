import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { PressableScale } from './PressableScale';
import { palette, radius, space } from './tokens';

export type LinkCardProps = {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

/** A card that opens another screen — the same look as a DropdownSection header, with a forward chevron. */
export function LinkCard({ title, subtitle, icon: Icon, iconColor = palette.rose600, iconBg = palette.rose50, onPress, style }: LinkCardProps) {
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} accessibilityRole="button" accessibilityLabel={title} style={style}>
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
        <View style={styles.chevronWrap}>
          <ChevronRight size={20} color={palette.inkFaint} />
        </View>
      </GlassSurface>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm + 2, gap: space.sm },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, gap: 2 },
  chevronWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.6)' },
});
