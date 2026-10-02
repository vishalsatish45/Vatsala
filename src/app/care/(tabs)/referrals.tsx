import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { ago, motherOf, referralOpen, referralStale, referralStatusLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS } from '@/data/types';
import { useCareMe } from '@/features/care/CareTeam';
import { useNow } from '@/lib/clock';
import { useSession } from '@/state/session';
import { AppText, Avatar, EmptyState, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, palette, space } from '@/ui';

/** CT-50 Referrals — open (needs action) vs closed. */
export default function Referrals() {
  const db = useDb();
  const now = useNow();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const care = useSession((s) => s.account?.care);
  const me = useCareMe();
  // A specialist's inbox: the referrals addressed to her department(s).
  const mine = db.referrals.filter((r) => me.role !== 'specialist' || (!!r.toTeamId && me.teamIds.includes(r.toTeamId)));
  const rows = mine.filter((r) => (view === 'open' ? referralOpen(r) : !referralOpen(r))).sort((a, b) => b.events.at(-1)!.at.getTime() - a.events.at(-1)!.at.getTime());

  return (
    <Screen withNav blob="none" header={<TopBar title="Referrals" />}>
      <AppText variant="display">{care?.role === 'specialist' ? `${care.department} inbox` : 'Referrals'}</AppText>
      <SegmentedPills
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'Open', count: mine.filter(referralOpen).length },
          { value: 'closed', label: 'Closed', count: mine.filter((r) => !referralOpen(r)).length },
        ]}
      />
      <View style={{ gap: space.sm }}>
        {rows.length === 0 && <EmptyState title="No referrals here" />}
        {rows.map((r) => {
          const p = db.pregnancies.find((x) => x.id === r.pregnancyId)!;
          const m = motherOf(db, p.motherId);
          const step = REFERRAL_STEPS.indexOf(r.status);
          const stale = referralStale(r, now);
          return (
            <ListRow
              key={r.id}
              leading={<Avatar name={m.name} size={40} />}
              title={`${m.name} → ${r.department}`}
              subtitle={r.reason}
              meta={
                <>
                  <View style={styles.stepper}>
                    {REFERRAL_STEPS.map((s, i) => (
                      <View key={s} style={[styles.dot, { backgroundColor: i <= step ? palette.rose500 : palette.softBorder }]} />
                    ))}
                  </View>
                  <StatusBadge status={stale ? 'overdue' : referralOpen(r) ? 'due' : 'done'} label={`${referralStatusLabel(r.status)} · ${ago(r.events.at(-1)!.at, now)}`} />
                </>
              }
              onPress={() => router.push({ pathname: '/care/referral/[id]', params: { id: r.id } })}
            />
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', gap: 4 },
  dot: { width: 18, height: 5, borderRadius: 3 },
});
