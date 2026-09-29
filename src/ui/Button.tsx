import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { elevation, palette, radius } from './tokens';

type Variant = 'primary' | 'secondary' | 'onCard';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
};

/** Primary = rose gradient pill; secondary = glass pill; onCard = white pill inside a gradient card. */
export function Button({ label, onPress, variant = 'primary', icon: Icon, disabled, loading }: Props) {
  const fg = variant === 'primary' ? palette.white : palette.ink;
  const content = (
    <View style={styles.content}>
      {loading ? <ActivityIndicator color={fg} /> : Icon && <Icon size={18} color={fg} strokeWidth={2} />}
      <AppText variant="headline" style={{ color: fg }}>
        {label}
      </AppText>
    </View>
  );

  return (
    <PressableScale
      onPress={disabled || loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={[styles.base, variant === 'primary' && elevation.glow, disabled && styles.disabled]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={[palette.rose300, palette.rose500]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.fill, variant === 'secondary' ? styles.secondary : styles.onCard]}>{content}</View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill },
  fill: { borderRadius: radius.pill, minHeight: 52, justifyContent: 'center', paddingHorizontal: 20 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondary: { backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.9)' },
  onCard: { backgroundColor: palette.white },
  disabled: { opacity: 0.45 },
});
