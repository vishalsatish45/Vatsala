import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { useMood } from './mood';
import { PressableScale } from './PressableScale';
import { palette, radius, space } from './tokens';

type Props = {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** Status badge, chips etc. under the subtitle. */
  meta?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Optional expanded 4-column stats row (inspiration B). */
  stats?: { label: string; value: string }[];
};

/** Glass card row (inspiration A) with leading avatar/icon, text, trailing meta and chevron. */
export function ListRow({ leading, title, subtitle, meta, trailing, onPress, stats }: Props) {
  const mood = useMood();
  const body = (
    <GlassSurface strong radius={radius.lg} elevation="card" style={[styles.card, { minHeight: mood.rowMinHeight }]}>
      <View style={styles.main}>
        {leading}
        <View style={styles.text}>
          <AppText variant="headline" numberOfLines={1}>
            {title}
          </AppText>
          {!!subtitle && (
            <AppText variant="caption" tone="secondary" numberOfLines={2}>
              {subtitle}
            </AppText>
          )}
          {meta && <View style={styles.meta}>{meta}</View>}
        </View>
        {trailing}
        {onPress && <ChevronRight size={18} color={palette.inkFaint} />}
      </View>
      {stats && stats.length > 0 && (
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.label} style={styles.stat}>
              <AppText variant="caption" tone="faint" numberOfLines={1}>
                {s.label}
              </AppText>
              <AppText variant="label" numberOfLines={1}>
                {s.value}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </GlassSurface>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} accessibilityRole="button" accessibilityLabel={title}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    justifyContent: 'center',
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' },
  stats: {
    flexDirection: 'row',
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: palette.divider,
  },
  stat: { flex: 1, gap: 2 },
});
