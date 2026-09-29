import Svg, { Circle, Path } from 'react-native-svg';

import { palette } from './tokens';

/** Hand-drawn sparkles in the line style of inspiration B's promo card. */
export function Sparkles({ size = 72, color = palette.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" fill="none">
      <Path
        d="M40 10 C41.5 20 44 22.5 54 24 C44 25.5 41.5 28 40 38 C38.5 28 36 25.5 26 24 C36 22.5 38.5 20 40 10 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={palette.white}
      />
      <Path
        d="M18 40 C19 45.5 20.5 47 26 48 C20.5 49 19 50.5 18 56 C17 50.5 15.5 49 10 48 C15.5 47 17 45.5 18 40 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={palette.white}
      />
      <Path d="M56 46 L62 52 M62 46 L56 52" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={60} cy={12} r={2.5} stroke={color} strokeWidth={1.6} />
      <Circle cx={12} cy={22} r={1.8} fill={color} />
    </Svg>
  );
}
