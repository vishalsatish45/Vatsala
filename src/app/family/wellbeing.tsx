import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FocusSwitch } from '@/features/family/FocusSwitch';
import { LearnSection } from '@/features/family/LearnSection';
import { LEARN_ICONS } from '@/features/family/learnIcons';
import { birthHappened } from '@/features/family/stage';
import { useFamily } from '@/features/family/useFamily';
import { wellbeingFor, type WellbeingCard } from '@/features/family/wellbeing';
import { AppText, ListRow, Screen, StoryCard, TopBar, UnderlineTabs, space } from '@/ui';

type Tab = 'diet' | 'exercise' | 'learn';

/** "My diet & exercises" (from the Home card): diet and exercise cards for her stage, and the Learn library. */
export default function Wellbeing() {
  const { t } = useTranslation();
  const { pregnancy, stage } = useFamily();
  const [tab, setTab] = useState<Tab>('diet');

  return (
    <Screen blob="none" header={<TopBar back title={t('family.wellbeing.title')} below={tab === 'learn' ? <FocusSwitch /> : undefined} />}>
      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'diet', label: t('family.wellbeing.diet') },
          { value: 'exercise', label: t('family.wellbeing.exercise') },
          { value: 'learn', label: t('family.wellbeing.learn') },
        ]}
      />
      {tab === 'learn' ? (
        <LearnSection />
      ) : (
        <Cards cards={wellbeingFor(tab, { birthHappened: birthHappened(pregnancy), withBaby: stage === 'baby' })} />
      )}
      <AppText variant="caption" tone="faint" align="center">
        {t('family.learn.reviewed')}
      </AppText>
    </Screen>
  );
}

function Cards({ cards }: { cards: WellbeingCard[] }) {
  const { t } = useTranslation();
  const open = (slug: string) => router.push({ pathname: '/family/learn/[slug]', params: { slug } });
  if (!cards.length) return <AppText tone="secondary">{t('family.learn.nothingNow')}</AppText>;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 8, paddingRight: space.md }} snapToInterval={272} decelerationRate="fast">
        {cards.slice(0, 3).map((c) => (
          <StoryCard key={c.slug} icon={LEARN_ICONS[c.icon]} tone={c.tone} title={c.title} body={c.summary} onPress={() => open(c.slug)} />
        ))}
      </ScrollView>
      <View style={{ gap: space.sm }}>
        {cards.slice(3).map((c) => (
          <ListRow key={c.slug} title={c.title} subtitle={c.summary} onPress={() => open(c.slug)} />
        ))}
      </View>
    </>
  );
}
