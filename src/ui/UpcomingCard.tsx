import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, FlaskConical, Stethoscope, Syringe, type LucideIcon } from 'lucide-react-native';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { Sparkles } from './illustrations';
import { PressableScale } from './PressableScale';
import { palette, radius, space } from './tokens';

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
 * white card with a lavender edge — the kind of appointment, told apart at a glance. Status is in the eyebrow text.
 */
export function UpcomingCard({ kind, eyebrow, title, when, place, onPress }: Props) {
  const Icon = ICON[kind];
  const visit = kind === 'visit';
  const body = (
    <View style={styles.row}>
      <View style={styles.art} pointerEvents="none">
        <Sparkles size={34} color={visit ? palette.ink : palette.lav600} />
      </View>
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
          {body}
        </LinearGradient>
      ) : (
        <GlassSurface strong radius={radius.lg} style={[styles.card, styles.testCard]}>
          {body}
        </GlassSurface>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, paddingVertical: space.sm, paddingHorizontal: space.md, overflow: 'hidden' },
  testCard: { borderLeftWidth: 5, borderLeftColor: palette.lav400 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  art: { position: 'absolute', right: -4, top: -6 },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  when: { fontSize: 17, lineHeight: 22 },
});
