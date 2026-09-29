import { useState } from 'react';
import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { Baby, BookOpen, CalendarDays, HeartPulse, House, IdCard, NotebookPen, PhoneCall, TriangleAlert } from 'lucide-react-native';

import { useFamily } from '@/features/family/useFamily';
import { ActionSheet, FloatingNavBar, palette, type NavItem } from '@/ui';

/** DESIGN.md §5.2 — Home · Schedule · (+) · My pregnancy · Learn. */
export default function FamilyTabs() {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState(false);
  const { pregnancy, babies } = useFamily();
  const hasBaby = pregnancy?.status === 'delivered' && babies.length > 0;

  const left: [NavItem, NavItem] = [
    { name: 'home', href: '/family', icon: House, label: t('family.tabs.home') },
    { name: 'schedule', href: '/family/schedule', icon: CalendarDays, label: t('family.tabs.schedule') },
  ];
  const right: [NavItem, NavItem] = [
    { name: 'journey', href: '/family/journey', icon: hasBaby ? Baby : HeartPulse, label: hasBaby ? t('family.baby.title') : t('family.tabs.journey') },
    { name: 'learn', href: '/family/learn', icon: BookOpen, label: t('family.tabs.learn') },
  ];

  return (
    <>
      <Tabs>
        <TabSlot />
        <TabList style={{ display: 'none' }}>
          {[...left, ...right].map((i) => (
            <TabTrigger key={i.name} name={i.name} href={i.href} />
          ))}
        </TabList>
        <FloatingNavBar left={left} right={right} onCenterPress={() => setSheet(true)} centerLabel={t('family.tabs.actions')} />
      </Tabs>
      <ActionSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={t('family.tabs.actions')}
        actions={[
          { key: 'call', label: t('family.askCall'), icon: PhoneCall, onPress: () => router.push('/family/callback') },
          { key: 'log', label: t('family.logReading'), icon: NotebookPen, tint: palette.lav600, onPress: () => router.push('/family/log') },
          { key: 'signs', label: t('family.warningSigns'), icon: TriangleAlert, tint: palette.amber, onPress: () => router.push('/family/signs') },
          { key: 'card', label: t('family.myCard'), icon: IdCard, tint: palette.done, onPress: () => router.push('/family/card') },
        ]}
      />
    </>
  );
}
