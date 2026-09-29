import { View } from 'react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette } from './tokens';

export function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?)\s+/i, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

type Props = { name: string; size?: number; onPress?: () => void; tint?: 'rose' | 'lavender' };

/** Initials avatar (no photos of patients — synthetic data only). */
export function Avatar({ name, size = 44, onPress, tint = 'rose' }: Props) {
  const bg = tint === 'rose' ? palette.rose100 : palette.lav100;
  const fg = tint === 'rose' ? palette.rose600 : palette.lav600;
  const body = (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.white }}>
      <AppText variant="label" style={{ color: fg, fontSize: size * 0.34, lineHeight: size * 0.42 }}>
        {initials(name)}
      </AppText>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={name}>
      {body}
    </PressableScale>
  );
}
