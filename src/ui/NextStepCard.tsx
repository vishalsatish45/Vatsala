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
};

/** Peach → rose gradient card with a line illustration and an in-card white button (inspiration B). */
export function NextStepCard({ eyebrow, title, lines, actionLabel, onAction }: Props) {
  return (
    <View style={styles.shadow}>
      <LinearGradient colors={['#FCD9C4', '#F7B9CF', '#EFA3C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.art} pointerEvents="none">
          <Sparkles size={70} />
        </View>
        <AppText variant="label" tone="secondary">
          {eyebrow}
        </AppText>
        <AppText variant="title" style={styles.title}>
          {title}
        </AppText>
        <View style={styles.lines}>
          {lines.map((l) => (
            <AppText key={l} variant="body">
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
  shadow: { borderRadius: radius.card, ...elevation.float },
  card: { borderRadius: radius.card, padding: space.lg, overflow: 'hidden' },
  art: { position: 'absolute', right: 12, top: 10 },
  title: { marginTop: 2, marginRight: 64 },
  lines: { marginTop: space.xs, gap: 2 },
  action: { marginTop: space.md },
});

