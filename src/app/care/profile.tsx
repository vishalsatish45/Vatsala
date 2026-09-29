import { View } from 'react-native';
import { router } from 'expo-router';
import { BarChart3, ScrollText } from 'lucide-react-native';

import { useDb } from '@/data/store';
import { env } from '@/lib/env';
import { useClock } from '@/lib/clock';
import { useSession } from '@/state/session';
import { AppText, Avatar, Button, Card, Chip, Screen, TopBar, space } from '@/ui';

/** CT-80 Profile hub (+ CT-83 dev tools in development builds). */
export default function CareProfile() {
  const account = useSession((s) => s.account);
  const signOut = useSession((s) => s.signOut);
  const chooseFace = useSession((s) => s.chooseFace);
  const { offsetDays, shift, reset } = useClock();
  const resetDb = useDb((s) => s.reset);

  return (
    <Screen header={<TopBar back title="Profile" />}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Avatar name={account?.name ?? '?'} size={72} />
        <AppText variant="title">{account?.name}</AppText>
        <AppText tone="secondary">
          {account?.care?.role} · {account?.care?.department} · {account?.care?.hospital}
        </AppText>
      </View>

      <Button label="KPI · on-time visits" icon={BarChart3} onPress={() => router.push('/care/kpi')} />
      <Button variant="secondary" label="Audit log" icon={ScrollText} onPress={() => router.push('/care/audit')} />

      {account?.faces.includes('family') && <Button variant="secondary" label="Switch to Family" onPress={() => chooseFace('family')} />}

      {env.isDev && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Developer tools</AppText>
          <AppText variant="caption" tone="secondary">
            Auth mode: {env.authMode} · Time travel: {offsetDays >= 0 ? '+' : ''}
            {offsetDays} days
          </AppText>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chip label="+1 day" onPress={() => shift(1)} />
            <Chip label="+7 days" onPress={() => shift(7)} />
            <Chip label="Reset clock" onPress={reset} />
            <Chip label="Reset demo data" onPress={() => resetDb(new Date())} />
          </View>
        </Card>
      )}

      <Button variant="secondary" label="Sign out" onPress={signOut} />
    </Screen>
  );
}
