import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { palette } from './tokens';

const FRAME = require('../../assets/images/welcome-backdrop.png');

/**
 * The Vatsala brand artwork's paper and floral frame, as a Screen `backdrop`.
 * Full strength on the welcome screen; `faint` on the sign-in steps after it, so forms stay the focus.
 */
export function BrandBackdrop({ faint = false }: { faint?: boolean }) {
  return (
    <View style={styles.fill} pointerEvents="none">
      <Image source={FRAME} contentFit="cover" style={[styles.fill, faint && styles.faint]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.brandPaper },
  faint: { opacity: 0.4 },
});
