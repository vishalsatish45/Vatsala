import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Bell, ScanLine, Search } from 'lucide-react-native';

import { worklist, patientIds, type WorkGroup } from '@/data/selectors';
import { useDb } from '@/data/store';
import { openTarget } from '@/features/care/nav';
import { useCareMe } from '@/features/care/CareTeam';
import { careInbox } from '@/features/care/inbox';
import { onMyWorklist } from '@/features/care/permissions';
import { useNow } from '@/lib/clock';
import { useSession } from '@/state/session';
import { AppText, Avatar, Chip, EmptyState, GlassIconButton, GlassSurface, HeroNumber, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, families, intensityLabel, palette, space } from '@/ui';

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** CT-01 Worklist — operational care gaps only (PRD F-10, F-15). */
export default function Worklist() {
  const account = useSession((s) => s.account);
  const db = useDb();
  const now = useNow();
  const [group, setGroup] = useState<WorkGroup>('today');
  const [q, setQ] = useState('');

  const me = useCareMe();
  const isSpecialist = me.role === 'specialist';
  const dept = account?.care?.department;
  // Her specialty's items; a referral only on the side whose move it is (receiving department vs referring team).
  const all = useMemo(() => worklist(db, now).filter((w) => onMyWorklist(w, me)), [db, now, me]);
  const inboxCount = careInbox(db, now, { department: dept, specialist: isSpecialist, teamIds: me.teamIds }).length;
  const count = (g: WorkGroup) => all.filter((w) => w.group === g).length;
  const items = all.filter((w) => w.group === group && (!q || w.name.toLowerCase().includes(q.toLowerCase())));
  const shortName = account?.name.split(' ').slice(0, 2).join(' ') ?? '';

  return (
    <Screen
      withNav
      blobCenterY={190}
      header={
        <TopBar
          centerTitle={false}
          left={<Avatar name={account?.name ?? '?'} onPress={() => router.push('/care/profile')} />}
          title={`${greeting(now)}, ${shortName}`}
          right={
            <>
              <GlassIconButton icon={ScanLine} accessibilityLabel="Scan patient QR" onPress={() => router.push('/care/scan')} />
              <GlassIconButton icon={Bell} accessibilityLabel="Notifications" badge={inboxCount} onPress={() => router.push('/care/notifications')} />
            </>
          }
        />
      }
    >
      <HeroNumber caption={isSpecialist ? `${dept} referrals` : 'Appointments for Today'} value={String(isSpecialist ? count('now') + count('today') : count('today'))} subtitle={isSpecialist ? `${count('week')} more this week` : `${count('now')} need attention now · ${count('week')} more this week`} />

      <GlassSurface strong radius={999} elevation="card" style={styles.search}>
        <Search size={18} color={palette.inkFaint} />
        <TextInput value={q} onChangeText={setQ} placeholder="Filter by name" placeholderTextColor={palette.inkFaint} style={styles.searchInput} />
      </GlassSurface>

      <SegmentedPills
        value={group}
        onChange={setGroup}
        options={[
          { value: 'now', label: 'Now', count: count('now') },
          { value: 'today', label: 'Today', count: count('today') },
          { value: 'week', label: 'This week', count: count('week') },
        ]}
      />

      <View style={{ gap: space.sm }}>
        <AppText variant="title">{group === 'now' ? 'Needs attention now' : group === 'today' ? 'Appointments for Today' : 'Coming up this week'}</AppText>
        {items.map((w) => {
          const ids = patientIds(db, w.motherId, w.pregnancyId);
          return (
            <ListRow
              key={w.id}
              leading={<Avatar name={w.name.replace(/^Baby of /, '')} size={40} tint={w.name.startsWith('Baby') ? 'lavender' : 'rose'} />}
              title={w.name}
              subtitle={ids.ip ? `${ids.ageObs}\n${ids.ip}` : ids.ageObs}
              meta={
                <>
                  <AppText variant="caption" tone="secondary">
                    {w.what} · {w.context}
                  </AppText>
                  <StatusBadge status={w.status} label={w.statusLabel} />
                  {w.intensity && w.intensity !== 'routine' && <Chip label={intensityLabel(w.intensity)} variant="soft" />}
                  {w.familySign && <Chip label="Family reported warning sign" variant="tag" />}
                </>
              }
              stats={w.stats}
              onPress={() => openTarget(w.target)}
            />
          );
        })}
        {items.length === 0 && <EmptyState title="All caught up" body="Nothing needs you in this group right now." />}
      </View>
      <AppText variant="caption" tone="faint" align="center">
        Synthetic demo data · care gaps only, no clinical scoring
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.md, height: 48 },
  searchInput: { flex: 1, fontFamily: families.latin.regular, fontSize: 15, color: palette.ink },
});
