import { View } from 'react-native';
import { router } from 'expo-router';
import { Bell, FlaskConical, GitPullRequestArrow, PhoneCall, CalendarX } from 'lucide-react-native';

import { ago } from '@/data/selectors';
import { useDb } from '@/data/store';
import { careInbox, type InboxItem } from '@/features/care/inbox';
import { useNow } from '@/lib/clock';
import { useSession } from '@/state/session';
import { EmptyState, ListRow, Screen, TopBar, palette, space } from '@/ui';

const ICON: Record<InboxItem['kind'], typeof Bell> = { callback: PhoneCall, referral: GitPullRequestArrow, result: FlaskConical, missed: CalendarX };

/** Care Team notifications inbox (PRD F-04). */
export default function CareNotifications() {
  const db = useDb();
  const now = useNow();
  const care = useSession((s) => s.account?.care);
  const items = careInbox(db, now, { department: care?.department, specialist: care?.role === 'specialist' });

  return (
    <Screen blob="none" header={<TopBar back title="Notifications" />}>
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" body="New call-backs, referral updates, results and missed visits appear here." />
      ) : (
        <View style={{ gap: space.sm }}>
          {items.map((i) => {
            const Icon = ICON[i.kind];
            return (
              <ListRow
                key={i.id}
                leading={
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: palette.rose50, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={palette.rose600} />
                  </View>
                }
                title={i.title}
                subtitle={`${i.body} · ${ago(i.at, now)} ago`}
                onPress={() => router.push(i.href)}
              />
            );
          })}
        </View>
      )}
    </Screen>
  );
}
