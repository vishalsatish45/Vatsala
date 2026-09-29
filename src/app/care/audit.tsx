import { View } from 'react-native';

import { ago } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Card, Screen, TopBar, space } from '@/ui';

/** CT-82 Audit log (PRD F-60) — append-only record of who did what. */
export default function Audit() {
  const db = useDb();
  const now = useNow();
  return (
    <Screen blob="none" header={<TopBar back title="Audit log" />}>
      <AppText variant="display">Audit log</AppText>
      <Card style={{ gap: space.sm }}>
        {db.audit.slice(0, 80).map((a) => (
          <View key={a.id} style={{ gap: 1 }}>
            <AppText variant="bodyMedium">{a.action}</AppText>
            <AppText variant="caption" tone="secondary">
              {a.actor} · {a.entity} · {ago(a.at, now)} ago
            </AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
