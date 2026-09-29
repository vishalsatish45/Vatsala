import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { PressableScale } from './PressableScale';
import { palette } from './tokens';

type Props = {
  icon: LucideIcon;
  onPress?: () => void;
  accessibilityLabel: string;
  size?: number;
  badge?: number;
};

/** 44 dp frosted circle with an icon — back, share, bell, scan (inspiration A). */
export function GlassIconButton({ icon: Icon, onPress, accessibilityLabel, size = 44, badge }: Props) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={6}>
      <GlassSurface radius={size / 2} elevation="card" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} color={palette.rose600} strokeWidth={1.75} />
      </GlassSurface>
      {!!badge && (
        <View style={styles.badge}>
          <AppText variant="caption" tone="onPrimary" style={styles.badgeText}>
            {badge > 99 ? '99+' : badge}
          </AppText>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: palette.rose500,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12 },
});
