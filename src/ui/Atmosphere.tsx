import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useMood } from './mood';
import { palette } from './tokens';

type Props = {
  /** Where the soft glowing blob sits (behind the hero). */
  blob?: 'top' | 'none';
  /** Vertical centre of the blob, in px from the top. */
  blobCenterY?: number;
};

/**
 * Full-screen rose → lavender gradient with a blurred radial "blob" behind the hero
 * (inspiration A). Drawn once per screen; no runtime blur, so it is cheap on low-end Android.
 */
export function Atmosphere({ blob = 'top', blobCenterY = 220 }: Props) {
  const mood = useMood();
  const { width, height } = useWindowDimensions();
  const r = width * mood.blob.radius;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={mood.bgGradient} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="blob" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={mood.blob.color} stopOpacity={mood.blob.opacity} />
            <Stop offset="0.55" stopColor={mood.blob.color} stopOpacity={mood.blob.opacity * 0.45} />
            <Stop offset="1" stopColor={mood.blob.color} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="lav" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={palette.lav200} stopOpacity={0.7} />
            <Stop offset="1" stopColor={palette.lav200} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* soft lavender depth, bottom-left */}
        <Circle cx={width * 0.05} cy={height * 0.82} r={width * 0.7} fill="url(#lav)" />
        {blob === 'top' && <Circle cx={width / 2} cy={blobCenterY} r={r} fill="url(#blob)" />}
      </Svg>
    </View>
  );
}
