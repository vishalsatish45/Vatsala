import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { Button } from './Button';
import { Sparkles } from './illustrations';
import { elevation, radius, space } from './tokens';

type Props = {
  eyebrow: string;
  title: string;
  lines: string[];
  actionLabel?: string;
  onAction?: () => void;
  /** Render the first line (usually the date) large instead of caption-sized. */
  bigFirstLine?: boolean;
};

/** Peach → rose gradient card with a line illustration and an in-card white button (inspiration B). */
export function NextStepCard({ eyebrow, title, lines, actionLabel, onAction, bigFirstLine }: Props) {
  return (
    <View style={styles.shadow}>
      <LinearGradient colors={['#FCD9C4', '#F7B9CF', '#EFA3C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.art} pointerEvents="none">
          <Sparkles size={44} />
        </View>
        <AppText variant="label" tone="secondary">
          {eyebrow}
        </AppText>
        <AppText variant="headline" style={styles.title}>
          {title}
        </AppText>
        <View style={styles.lines}>
          {lines.slice(0, 3).map((l, i) => (
            <AppText key={l} variant={bigFirstLine && i === 0 ? 'headline' : 'caption'} tone={bigFirstLine && i === 0 ? 'primary' : 'secondary'} style={bigFirstLine && i === 0 ? styles.bigDate : undefined}>
              {l}
            </AppText>
          ))}
        </View>
        {!!actionLabel && (
          <View style={styles.action}>
            <Button label={actionLabel} variant="onCard" onPress={onAction} />
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: radius.lg, ...elevation.float },
  card: { borderRadius: radius.lg, padding: space.md, overflow: 'hidden' },
  art: { position: 'absolute', right: 10, top: 8 },
  title: { marginTop: 2, marginRight: 48 },
  lines: { marginTop: space.xxs, gap: 2 },
  bigDate: { fontSize: 20, lineHeight: 26 },
  action: { marginTop: space.sm },
});

