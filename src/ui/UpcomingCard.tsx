import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, FlaskConical, Stethoscope, Syringe, type LucideIcon } from 'lucide-react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { elevation, palette, radius, space } from './tokens';

export type UpcomingKind = 'visit' | 'test' | 'vaccine';

type Props = {
  kind: UpcomingKind;
  eyebrow: string;
  title: string;
  /** The date (and time), shown bold. */
  when: string;
  place?: string;
  onPress?: () => void;
};

const ICON: Record<UpcomingKind, LucideIcon> = { visit: Stethoscope, test: FlaskConical, vaccine: Syringe };

/**
 * Compact "what's next" card for the family Home. A hospital visit is a warm gradient card; a test (or vaccine) is a
 * white card with lavender accents — the kind of appointment, told apart at a glance. Status is in the eyebrow text.
 */
export function UpcomingCard({ kind, eyebrow, title, when, place, onPress }: Props) {
  const Icon = ICON[kind];
  const visit = kind === 'visit';
  // Behind the content: two soft circles and a large faint copy of the card's icon, bleeding off the corner
  const tint = visit ? palette.rose600 : palette.lav600;
  const deco = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.blobBig, { backgroundColor: visit ? 'rgba(255,255,255,0.28)' : palette.lav100 }]} />
      <View style={[styles.blobSmall, { backgroundColor: visit ? 'rgba(255,255,255,0.22)' : 'rgba(238,232,251,0.7)' }]} />
      <View style={styles.watermark}>
        <Icon size={74} color={tint} strokeWidth={1.4} style={{ opacity: 0.13 }} />
      </View>
    </View>
  );
  const body = (
    <View style={styles.row}>
      <View style={[styles.badge, { backgroundColor: visit ? 'rgba(255,255,255,0.7)' : palette.lav100 }]}>
        <Icon size={22} color={visit ? palette.rose600 : palette.lav600} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="caption" tone="secondary">
          {eyebrow}
        </AppText>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="headline" style={styles.when}>
          {when}
        </AppText>
        {!!place && (
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {place}
          </AppText>
        )}
      </View>
      {onPress && <ChevronRight size={20} color={palette.inkSoft} />}
    </View>
  );

  return (
    <PressableScale onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${eyebrow}: ${title}, ${when}`}>
      {visit ? (
        <LinearGradient colors={['#FCD9C4', '#F7B9CF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          {deco}
          {body}
        </LinearGradient>
      ) : (
        <View style={[styles.card, styles.testCard]}>
          {deco}
          {body}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.md, overflow: 'hidden' },
  testCard: { backgroundColor: 'rgba(255,255,255,0.92)', ...elevation.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  blobBig: { position: 'absolute', width: 120, height: 120, borderRadius: 60, right: -38, bottom: -52 },
  blobSmall: { position: 'absolute', width: 56, height: 56, borderRadius: 28, right: 46, top: -26 },
  watermark: { position: 'absolute', right: 2, bottom: -14, transform: [{ rotate: '-14deg' }] },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  when: { fontSize: 17, lineHeight: 22 },
});
