import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { GlassSurface } from './GlassSurface';
import { space } from './tokens';

/** Frosted glass card (inspiration A) — the default container for content blocks. */
export function Card({ children, style, padded = true }: { children?: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  return (
    <GlassSurface strong elevation="card" style={[padded && { padding: space.lg }, style]}>
      {children}
    </GlassSurface>
  );
}
