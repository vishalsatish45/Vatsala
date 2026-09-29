import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { elevation, palette, radius, space } from './tokens';

const TONES = {
  rose: ['#F9C9DA', '#EE9CBD'],
  peach: ['#FCE0CC', '#F6B28A'],
  lavender: ['#E7DEFA', '#B9A6EE'],
} as const;

type Props = { icon: LucideIcon; title: string; body: string; tone?: keyof typeof TONES; onPress?: () => void; width?: number };

/** Illustrated card with a glass caption panel (inspiration A "Lungs are Maturing"). No photos of people. */
export function StoryCard({ icon: Icon, title, body, tone = 'rose', onPress, width = 260 }: Props) {
  return (
    <PressableScale onPress={onPress} style={[styles.shadow, { width }]} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={TONES[tone]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.art}>
          <Icon size={72} color="rgba(255,255,255,0.9)" strokeWidth={1.2} />
        </View>
        <View style={styles.caption}>
          <AppText variant="headline" numberOfLines={2}>
            {title}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={3}>
            {body}
          </AppText>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: radius.card, ...elevation.float },
  card: { borderRadius: radius.card, height: 280, padding: space.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  art: { position: 'absolute', top: 40, left: 0, right: 0, alignItems: 'center' },
  caption: { backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: radius.lg, borderWidth: 1, borderColor: palette.white, padding: space.md, gap: 4 },
});
