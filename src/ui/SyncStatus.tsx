import { StyleSheet, View } from 'react-native';
import { CloudOff, CloudUpload, CheckCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { useNetwork, useOnline, useSyncState } from '@/lib/network';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { palette, space } from './tokens';

/** Glass banner at the top while offline or syncing (DESIGN.md §8). */
export function OfflineBanner({ offlineLabel, syncingLabel }: { offlineLabel: string; syncingLabel: string }) {
  const online = useOnline();
  const pending = useNetwork((s) => s.pending.length);
  const insets = useSafeAreaInsets();
  if (online && pending === 0) return null;
  return (
    <Animated.View entering={FadeInUp} exiting={FadeOutUp} style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="none">
      <GlassSurface strong radius={999} elevation="float" style={styles.banner}>
        {online ? <CloudUpload size={16} color={palette.rose600} /> : <CloudOff size={16} color={palette.inkSoft} />}
        <AppText variant="label">{online ? syncingLabel.replace('{{n}}', String(pending)) : offlineLabel}</AppText>
      </GlassSurface>
    </Animated.View>
  );
}

/** ⏳ Pending sync → ✓ Synced, for records created offline (PRD F-61). */
export function SyncBadge({ id, pendingLabel = 'Pending sync', syncedLabel = 'Synced' }: { id?: string; pendingLabel?: string; syncedLabel?: string }) {
  const st = useSyncState(id);
  if (!st) return null;
  return (
    <View style={styles.badge}>
      {st === 'pending' ? <CloudUpload size={13} color={palette.due} /> : <CheckCheck size={13} color={palette.done} />}
      <AppText variant="caption" style={{ color: st === 'pending' ? palette.due : palette.done }}>
        {st === 'pending' ? `⏳ ${pendingLabel}` : `✓ ${syncedLabel}`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingVertical: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
