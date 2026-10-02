import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { gestationalAge } from '@domain/gestation';

import { LEARN, learnText, type LearnCard } from '@/features/family/learn';
import { LEARN_ICONS } from '@/features/family/learnIcons';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { Baby } from 'lucide-react-native';

import { AppText, ListRow, Screen, StoryCard, TopBar, UnderlineTabs, palette, space } from '@/ui';

type Tab = 'thisWeek' | LearnCard['stage'];

/** FH-50 Learn — clinically reviewed content only (PRD F-47); this set is pending review. */
export default function Learn() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
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
          <StoryCard key={c.slug} icon={LEARN_ICONS[c.icon]} tone={c.tone} title={learnText(c, lang).title} body={learnText(c, lang).summary} onPress={() => open(c.slug)} />
        ))}
      </ScrollView>
      <View style={{ gap: space.sm }}>
        {list.slice(4).map((c) => (
          <ListRow key={c.slug} title={learnText(c, lang).title} subtitle={learnText(c, lang).summary} onPress={() => open(c.slug)} />
        ))}
      </View>
      {(tab === 'newborn' || (tab === 'thisWeek' && delivered)) && (
        <ListRow leading={<Baby size={22} color={palette.lav600} />} title={t('family.guide.title')} onPress={() => router.push('/family/newborn-guide')} />
      )}
      <AppText variant="caption" tone="faint" align="center">
        {t('family.learn.reviewed')}
      </AppText>
    </Screen>
  );
}
