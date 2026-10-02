import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { palette, radius } from './tokens';

/**
 * Marks an antenatal-care (ANC) visit so it stands out in lists and timelines. It labels the
 * kind of appointment only — never a clinical value (hackathon scope rules).
 */
export function AncBadge() {
  return (
    <View style={styles.badge} accessibilityLabel="ANC visit">
      <AppText variant="caption" style={styles.text}>
        ANC
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', backgroundColor: palette.lav600, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  text: { color: palette.white, fontWeight: '700', letterSpacing: 0.5 },
});
