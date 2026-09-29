import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { gestationalAge } from '@domain/gestation';

import { LEARN, type LearnCard } from '@/features/family/learn';
import { LEARN_ICONS } from '@/features/family/learnIcons';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { AppText, ListRow, Screen, StoryCard, TopBar, UnderlineTabs, space } from '@/ui';

type Tab = 'thisWeek' | LearnCard['stage'];

/** FH-50 Learn — clinically reviewed content only (PRD F-47); this set is pending review. */
export default function Learn() {
  const { t } = useTranslation();
  const now = useNow();
  const { pregnancy } = useFamily();
  const delivered = pregnancy?.status === 'delivered';
  const [tab, setTab] = useState<Tab>('thisWeek');
  const week = pregnancy && !delivered ? gestationalAge(pregnancy.edd, now).weeks : 0;

  const forNow = LEARN.filter((c) => (delivered ? c.stage !== 'pregnancy' : c.stage === 'pregnancy' && (!c.weeks || (week >= c.weeks[0] && week <= c.weeks[1]))));
  const list = tab === 'thisWeek' ? forNow : LEARN.filter((c) => c.stage === tab);
  const open = (slug: string) => router.push({ pathname: '/family/learn/[slug]', params: { slug } });

  return (
    <Screen withNav blob="none" header={<TopBar title={t('family.tabs.learn')} />}>
      <AppText variant="display">{t('family.learnTitle')}</AppText>
      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'thisWeek', label: t('family.learn.thisWeek') },
          { value: 'pregnancy', label: t('family.learn.pregnancy') },
          { value: 'afterBirth', label: t('family.learn.afterBirth') },
          { value: 'newborn', label: t('family.learn.newborn') },
        ]}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 8, paddingRight: space.md }} snapToInterval={272} decelerationRate="fast">
        {list.slice(0, 4).map((c) => (
          <StoryCard key={c.slug} icon={LEARN_ICONS[c.icon]} tone={c.tone} title={c.title} body={c.summary} onPress={() => open(c.slug)} />
        ))}
      </ScrollView>
      <View style={{ gap: space.sm }}>
        {list.slice(4).map((c) => (
          <ListRow key={c.slug} title={c.title} subtitle={c.summary} onPress={() => open(c.slug)} />
        ))}
      </View>
      <AppText variant="caption" tone="faint" align="center">
        {t('family.learn.reviewed')} · {t('family.learn.englishOnly')}
      </AppText>
    </Screen>
  );
}
