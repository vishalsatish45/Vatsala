import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { useTranslation } from 'react-i18next';
import { Baby, BookOpen, CalendarDays, HeartPulse, House } from 'lucide-react-native';

import { useFamily } from '@/features/family/useFamily';
import { FloatingNavBar, type NavItem } from '@/ui';

/** Home · Schedule · (Emergency call) · My pregnancy · Learn. */
export default function FamilyTabs() {
  const { t } = useTranslation();
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
    <Tabs>
      <TabSlot />
      <TabList style={{ display: 'none' }}>
        {[...left, ...right].map((i) => (
          <TabTrigger key={i.name} name={i.name} href={i.href} />
        ))}
      </TabList>
      <FloatingNavBar left={left} right={right} onCenterPress={() => router.push('/family/callback')} centerLabel={t('family.emergencyCall')} centerIcon="call" />
    </Tabs>
  );
}
