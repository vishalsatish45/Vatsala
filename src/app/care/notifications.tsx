import { View } from 'react-native';
import { router } from 'expo-router';
import { Bell, BellDot, FlaskConical, GitPullRequestArrow, PhoneCall, CalendarX } from 'lucide-react-native';

import { ago } from '@/data/selectors';
import { useDb } from '@/data/store';
import { careInbox, serverInbox, type InboxItem, type ServerInboxItem } from '@/features/care/inbox';
import { useNow } from '@/lib/clock';
import { isRemote } from '@/lib/supabase';
import { useSession } from '@/state/session';
import { Chip, EmptyState, ListRow, Screen, Section, TopBar, palette, space } from '@/ui';

const ICON: Record<InboxItem['kind'], typeof Bell> = { callback: PhoneCall, referral: GitPullRequestArrow, result: FlaskConical, missed: CalendarX };

const iconBox = (Icon: typeof Bell, strong?: boolean) => (
  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: strong ? palette.rose100 : palette.rose50, alignItems: 'center', justifyContent: 'center' }}>
    <Icon size={18} color={palette.rose600} />
  </View>
);

/**
 * Care Team notifications inbox (PRD F-04). Supabase mode lists the server's notification rows for this clinician
 * (call-backs, referral steps, babies born) above the signals derived from the worklist; the demo shows the latter.
 */
export default function CareNotifications() {
  const db = useDb();
  const now = useNow();
  const care = useSession((s) => s.account?.care);
  const items = careInbox(db, now, { department: care?.department, specialist: care?.role === 'specialist', teamIds: (care?.teams ?? []).map((t) => t.id) });
  const server = isRemote ? serverInbox(db) : [];
  const unread = server.filter((n) => n.unread);

  const open = (n: ServerInboxItem) => {
    if (n.unread) db.markNotificationsRead([n.id], new Date());
    if (n.href) router.push(n.href);
  };

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Notifications" right={unread.length > 0 ? <Chip label="Mark all read" onPress={() => db.markNotificationsRead('all', new Date())} /> : undefined} />}
    >
      {items.length === 0 && server.length === 0 ? (
        <EmptyState icon={Bell} title="You're all caught up" body="New call-backs, referral updates, results and missed visits appear here." />
      ) : (
        <>
          {server.length > 0 && (
            <Section title={unread.length ? `From the hospital · ${unread.length} new` : 'From the hospital'}>
              {server.map((n) => (
                <ListRow
                  key={n.id}
                  leading={iconBox(n.unread ? BellDot : Bell, n.unread)}
                  title={n.title}
                  subtitle={[n.body, `${ago(n.at, now)} ago`].filter(Boolean).join(' · ')}
                  meta={n.unread ? <Chip label="New" variant="tag" /> : undefined}
                  onPress={n.href || n.unread ? () => open(n) : undefined}
                />
              ))}
            </Section>
          )}
          {items.length > 0 && (
            <Section title={isRemote ? 'Needs attention' : 'Latest'}>
              <View style={{ gap: space.sm }}>
                {items.map((i) => (
                  <ListRow key={i.id} leading={iconBox(ICON[i.kind])} title={i.title} subtitle={`${i.body} · ${ago(i.at, now)} ago`} onPress={() => router.push(i.href)} />
                ))}
              </View>
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
