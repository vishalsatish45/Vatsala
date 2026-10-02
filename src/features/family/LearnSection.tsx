import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Baby } from 'lucide-react-native';
import { gestationalAge, localDay } from '@domain/gestation';

import { useNow } from '@/lib/clock';
import { AppText, ListRow, StoryCard, UnderlineTabs, palette, space } from '@/ui';

import { useFamilyFocus } from './FocusSwitch';
import { LEARN, learnText, type LearnCard } from './learn';
import { LEARN_ICONS } from './learnIcons';
import { birthHappened } from './stage';
import { useFamily } from './useFamily';

type Tab = 'thisWeek' | LearnCard['stage'];

/** FH-50 Learn (inside "My diet & exercises") — clinically reviewed content only (PRD F-47); this set is pending review. */
export function LearnSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const { pregnancy, stage } = useFamily();
  const delivered = birthHappened(pregnancy);
  // A living baby this account may see (stage.ts). Otherwise — a loss, or the baby not shared — nothing about caring
  // for a baby is pushed (no feeding, no newborn cards), only her own recovery after a birth.
  const withBaby = stage === 'baby';
  const { focus, canSwitch } = useFamilyFocus();
  const [tab, setTab] = useState<Tab>('thisWeek');
  const week = stage === 'pregnant' && pregnancy?.edd ? gestationalAge(pregnancy.edd, localDay(now)).weeks : 0;

  // After delivery "For now" follows the Me / Baby switch: recovery cards for her, newborn cards for the baby.
  const forNow =
    stage === 'pregnant'
      ? LEARN.filter((c) => c.stage === 'pregnancy' && (!c.weeks || (week >= c.weeks[0] && week <= c.weeks[1])))
      : withBaby
        ? LEARN.filter((c) => (canSwitch ? c.stage === (focus === 'baby' ? 'newborn' : 'afterBirth') : c.stage !== 'pregnancy'))
        : delivered
          ? LEARN.filter((c) => c.stage === 'afterBirth' && !c.aboutBaby)
          : [];
  const tabs: Tab[] = withBaby ? ['thisWeek', 'pregnancy', 'afterBirth', 'newborn'] : stage === 'pregnant' || stage === 'none' ? ['thisWeek', 'pregnancy', 'afterBirth', 'newborn'] : ['thisWeek', 'afterBirth'];
  const browse = (c: LearnCard) => c.stage === tab && (withBaby || stage === 'pregnant' || stage === 'none' || !c.aboutBaby);
  const list = tab === 'thisWeek' ? forNow : LEARN.filter(browse);
  const open = (slug: string) => router.push({ pathname: '/family/learn/[slug]', params: { slug } });

  return (
    <>
      <UnderlineTabs value={tab} onChange={setTab} tabs={tabs.map((v) => ({ value: v, label: t(`family.learn.${v}`) }))} />
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
      {list.length === 0 && <AppText tone="secondary">{t('family.learn.nothingNow')}</AppText>}
      {((tab === 'newborn' && tabs.includes('newborn')) || (tab === 'thisWeek' && withBaby && (!canSwitch || focus === 'baby'))) && (
        <ListRow leading={<Baby size={22} color={palette.lav600} />} title={t('family.guide.title')} onPress={() => router.push('/family/newborn-guide')} />
      )}
    </>
  );
}
