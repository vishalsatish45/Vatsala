import type { LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { PressableScale } from './PressableScale';
import { palette, radius, space } from './tokens';

export type SheetAction = { key: string; label: string; icon: LucideIcon; tint?: string; onPress: () => void };

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  actions: SheetAction[];
};

/** Opens from the centre nav button: a 2×2 grid of large tiles (inspiration B "Following" tiles). */
export function ActionSheet({ visible, onClose, title, actions }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + space.md }]}>
        <GlassSurface strong radius={radius.sheet} style={styles.sheet}>
          <View style={styles.grabber} />
          <AppText variant="title" align="center" style={styles.title}>
            {title}
          </AppText>
          <View style={styles.grid}>
            {actions.map((a) => (
              <PressableScale
                key={a.key}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                onPress={() => {
                  onClose();
                  a.onPress();
                }}
              >
                <View style={[styles.iconBadge, { backgroundColor: (a.tint ?? palette.rose500) + '1F' }]}>
                  <a.icon size={22} color={a.tint ?? palette.rose600} strokeWidth={1.9} />
                </View>
                <AppText variant="bodyMedium">{a.label}</AppText>
              </PressableScale>
            ))}
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(46,31,42,0.28)' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  sheet: { padding: space.lg, paddingTop: space.sm },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: palette.hairline, marginBottom: space.sm },
  title: { marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: radius.lg,
    borderWidth: 1.2,
    borderColor: palette.white,
    padding: space.md,
    gap: space.sm,
    minHeight: 112,
  },
  iconBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
