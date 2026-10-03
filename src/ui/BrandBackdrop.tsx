import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { palette } from './tokens';

const TOP_LEFT = require('../../assets/images/floral-top-left.png');
const BOTTOM_RIGHT = require('../../assets/images/floral-bottom-right.png');

/**
 * The Vatsala brand artwork as a Screen `backdrop`: its paper with florals pinned to two opposite corners.
 * The corners are sized by screen width, so no phone shape crops them. Full strength on the welcome screen;
 * `faint` on the sign-in steps after it, so forms stay the focus.
 */
export function BrandBackdrop({ faint = false }: { faint?: boolean }) {
  return (
    <View style={styles.fill} pointerEvents="none">
      <Image source={TOP_LEFT} contentFit="contain" style={[styles.topLeft, faint && styles.faint]} />
      <Image source={BOTTOM_RIGHT} contentFit="contain" style={[styles.bottomRight, faint && styles.faint]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.brandPaper },
  // 30% of the screen width (the artwork's own corners are ~39%)
  topLeft: { position: 'absolute', top: 0, left: 0, width: '30%', aspectRatio: 420 / 562 },
  bottomRight: { position: 'absolute', bottom: 0, right: 0, width: '30%', aspectRatio: 424 / 519 },
  faint: { opacity: 0.4 },
});
