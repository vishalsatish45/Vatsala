import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { learnText } from '@/features/family/learn';
import { LEARN_ICONS } from '@/features/family/learnIcons';
import { findArticle } from '@/features/family/wellbeing';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { AppText, Card, Screen, TopBar, radius, space } from '@/ui';

const TONES = { rose: ['#F9C9DA', '#EE9CBD'], peach: ['#FCE0CC', '#F6B28A'], lavender: ['#E7DEFA', '#B9A6EE'] } as const;

/** FH-51 Article. */
export default function Article() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const c = findArticle(slug);
  if (!c) return <Screen header={<TopBar back />}><AppText>—</AppText></Screen>;
  const Icon = LEARN_ICONS[c.icon];
  const tx = learnText(c, i18n.language);

  return (
    <Screen blob="none" header={<TopBar back right={<ReadAloudButton text={[tx.title, ...tx.body].join('. ')} />} />}>
      <LinearGradient colors={TONES[c.tone]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Icon size={80} color="rgba(255,255,255,0.92)" strokeWidth={1.2} />
      </LinearGradient>
      <AppText variant="display">{tx.title}</AppText>
      <Card style={{ gap: space.md }}>
        {tx.body.map((para, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <AppText variant="bodyMedium" tone="accent">
              •
            </AppText>
            <AppText style={{ flex: 1 }}>{para}</AppText>
          </View>
        ))}
      </Card>
      <AppText variant="caption" tone="faint">
        {t('family.learn.reviewed')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 180, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center' },
});
