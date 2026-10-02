import { useState } from 'react';
import { router } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { Camera, FileSpreadsheet, GitPullRequestArrow, LayoutList, PhoneCall, UserPlus, Users, ClipboardPlus } from 'lucide-react-native';

import { useSession } from '@/state/session';
import { ActionSheet, FloatingNavBar, palette, type NavItem } from '@/ui';

const left: [NavItem, NavItem] = [
  { name: 'worklist', href: '/care', icon: LayoutList, label: 'Worklist' },
  { name: 'patients', href: '/care/patients', icon: Users, label: 'Patients' },
];
const right: [NavItem, NavItem] = [
  { name: 'callbacks', href: '/care/callbacks', icon: PhoneCall, label: 'Call-backs' },
  { name: 'referrals', href: '/care/referrals', icon: GitPullRequestArrow, label: 'Referrals' },
];

/** DESIGN.md §5.3 — Worklist · Patients · (+) · Call-backs · Referrals. */
export default function CareTabs() {
  const [sheet, setSheet] = useState(false);
  // Registering and importing pregnancies is the obstetrician's (register_pregnancy / confirm_import refuse others).
  const obstetrician = useSession((s) => s.account?.care?.role) === 'obstetrician';

  return (
    <>
      <Tabs>
        <TabSlot />
        <TabList style={{ display: 'none' }}>
          {[...left, ...right].map((i) => (
            <TabTrigger key={i.name} name={i.name} href={i.href} />
          ))}
        </TabList>
        <FloatingNavBar left={left} right={right} onCenterPress={() => setSheet(true)} centerLabel="Quick actions" />
      </Tabs>
      <ActionSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title="Quick actions"
        actions={[
          ...(obstetrician ? [{ key: 'register', label: 'Register pregnancy', icon: UserPlus, onPress: () => router.push('/care/register') }] : []),
          { key: 'visit', label: 'Record visit', icon: ClipboardPlus, onPress: () => router.push('/care/patients') },
          { key: 'capture', label: 'Capture paper record', icon: Camera, tint: palette.lav600, onPress: () => router.push('/care/capture') },
          ...(obstetrician ? [{ key: 'import', label: 'Import register', icon: FileSpreadsheet, tint: palette.done, onPress: () => router.push('/care/import') }] : []),
        ]}
      />
    </>
  );
}
