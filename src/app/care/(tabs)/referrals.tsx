import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { ago, motherOf, referralStale } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS } from '@/data/types';
import { useNow } from '@/lib/clock';
import { AppText, Avatar, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, palette, space } from '@/ui';

/** CT-50 Referrals — open (needs action) vs closed. */
export default function Referrals() {
  const db = useDb();
  const now = useNow();
  const [view, setView] = useState<'open' | 'closed'>('open');
  const isOpen = (s: string) => !['closed', 'declined'].includes(s);
  const rows = db.referrals.filter((r) => (view === 'open' ? isOpen(r.status) : !isOpen(r.status))).sort((a, b) => b.events.at(-1)!.at.getTime() - a.events.at(-1)!.at.getTime());

  return (
    <Screen withNav blob="none" header={<TopBar title="Referrals" />}>
      <AppText variant="display">Referrals</AppText>
      <SegmentedPills
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'Open', count: db.referrals.filter((r) => isOpen(r.status)).length },
          { value: 'closed', label: 'Closed', count: db.referrals.filter((r) => !isOpen(r.status)).length },
        ]}
      />
      <View style={{ gap: space.sm }}>
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
                  <StatusBadge status={stale ? 'overdue' : r.status === 'closed' ? 'done' : 'due'} label={`${r.status} · ${ago(r.events.at(-1)!.at, now)}`} />
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
