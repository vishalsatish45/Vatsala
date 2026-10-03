import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { palette } from './tokens';

const TOP_LEFT = require('../../assets/images/floral-top-left.png');
const TOP_RIGHT = require('../../assets/images/floral-top-right.png');
const BOTTOM_LEFT = require('../../assets/images/floral-bottom-left.png');
const BOTTOM_RIGHT = require('../../assets/images/floral-bottom-right.png');

/**
 * The Vatsala brand artwork as a Screen `backdrop`: its paper with florals pinned to the four corners, each at the
 * share of the screen width it has in the artwork, so no phone shape crops them. Full strength on the welcome screen;
 * `faint` on the sign-in steps after it, so forms stay the focus.
 */
export function BrandBackdrop({ faint = false }: { faint?: boolean }) {
  return (
    <View style={styles.fill} pointerEvents="none">
      <Image source={TOP_LEFT} contentFit="contain" style={[styles.topLeft, faint && styles.faint]} />
      <Image source={TOP_RIGHT} contentFit="contain" style={[styles.topRight, faint && styles.faint]} />
      <Image source={BOTTOM_LEFT} contentFit="contain" style={[styles.bottomLeft, faint && styles.faint]} />
      <Image source={BOTTOM_RIGHT} contentFit="contain" style={[styles.bottomRight, faint && styles.faint]} />
    </View>
  );
}

// Widths as in the 1080-px artwork (345 / 338 px)
const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.brandPaper },
  topLeft: { position: 'absolute', top: 0, left: 0, width: '32%', aspectRatio: 345 / 653 },
  topRight: { position: 'absolute', top: 0, right: 0, width: '31.3%', aspectRatio: 338 / 653 },
  bottomLeft: { position: 'absolute', bottom: 0, left: 0, width: '32%', aspectRatio: 345 / 517 },
  bottomRight: { position: 'absolute', bottom: 0, right: 0, width: '31.3%', aspectRatio: 338 / 510 },
  faint: { opacity: 0.4 },
});
