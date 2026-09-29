import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { addDays } from '@domain/gestation';

import { ago, fmtDay, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS, type ReferralStatus } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, Field, InfoRow, OptionChips, Screen, Sheet, TopBar, palette, space } from '@/ui';

const NEXT: Partial<Record<ReferralStatus, { to: ReferralStatus; label: string }>> = {
  requested: { to: 'accepted', label: 'Accept referral' },
  accepted: { to: 'scheduled', label: 'Schedule appointment' },
  scheduled: { to: 'seen', label: 'Mark patient seen' },
  seen: { to: 'recommendations', label: 'Document recommendations' },
  recommendations: { to: 'closed', label: 'Close referral' },
};

const LABEL: Record<ReferralStatus, string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  seen: 'Seen',
  recommendations: 'Recommendations',
  closed: 'Closed',
  declined: 'Declined',
};

/** CT-52 Referral detail — full lifecycle between departments (PRD F-17). */
export default function ReferralDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const r = db.referrals.find((x) => x.id === id);
  const [sheet, setSheet] = useState(false);
  const [inDays, setInDays] = useState('3');
  const [recs, setRecs] = useState('');
  if (!r) return <Screen header={<TopBar back title="Referral" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === r.pregnancyId)!;
  const m = motherOf(db, p.motherId);
  const next = NEXT[r.status];
  const stepIndex = REFERRAL_STEPS.indexOf(r.status);

  function advance() {
    if (!next) return;
    if (next.to === 'scheduled' || next.to === 'recommendations') return setSheet(true);
    db.advanceReferral(r!.id, next.to, {}, by, now);
  }

  function confirmSheet() {
    if (next?.to === 'scheduled') db.advanceReferral(r!.id, 'scheduled', { scheduledAt: addDays(now, Number(inDays)), place: `Block C · ${r!.department} OPD` }, by, now);
    if (next?.to === 'recommendations') db.advanceReferral(r!.id, 'recommendations', { recommendations: recs.trim() || 'Documented in notes' }, by, now);
    setSheet(false);
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Referral" />}
      footer={
        next ? (
          <View style={{ gap: 8 }}>
            <Button label={next.label} onPress={advance} />
            {r.status === 'requested' && <Button variant="secondary" label="Decline" onPress={() => db.advanceReferral(r.id, 'declined', { note: 'Declined' }, by, now)} />}
          </View>
        ) : undefined
      }
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{r.department}</AppText>
        <AppText tone="secondary">
          {m.name} · {p.mchId} · {gaLabel(p, now)}
        </AppText>
      </View>

      <Card style={{ gap: space.sm }}>
        <View style={styles.stepper}>
          {REFERRAL_STEPS.map((s, i) => (
            <View key={s} style={styles.stepCol}>
              <View style={[styles.bar, { backgroundColor: i <= stepIndex ? palette.rose500 : palette.softBorder }]} />
              <AppText variant="caption" tone={i <= stepIndex ? 'primary' : 'faint'} numberOfLines={1}>
                {LABEL[s]}
              </AppText>
            </View>
          ))}
        </View>
        {r.status === 'declined' && <Chip label="Declined" variant="selected" />}
      </Card>

      <Card>
        <InfoRow label="Reason" value={r.reason} />
        <InfoRow label="Question" value={r.question} />
        <InfoRow label="Urgency" value={r.urgency === '24h' ? 'Within 24 h' : r.urgency} />
        <InfoRow label="Appointment" value={r.scheduledAt ? `${fmtDay(r.scheduledAt)} · ${r.place ?? ''}` : undefined} />
        <InfoRow label="Recommendations" value={r.recommendations} />
        <InfoRow label="Referred by" value={r.createdBy} />
      </Card>

      <Card style={{ gap: 8 }}>
        <AppText variant="headline">History</AppText>
        {[...r.events].reverse().map((e, i) => (
          <AppText key={i} variant="caption" tone="secondary">
            {LABEL[e.status]} · {e.by} · {ago(e.at, now)} ago{e.note ? ` · ${e.note}` : ''}
          </AppText>
        ))}
      </Card>

      <Button variant="secondary" label={`Open ${m.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={next?.to === 'scheduled' ? 'Schedule appointment' : 'Recommendations'} footer={<Button label="Confirm" onPress={confirmSheet} />}>
        {next?.to === 'scheduled' ? (
          <>
            <OptionChips label="Appointment in (days)" options={['1', '2', '3', '5', '7']} value={inDays} onChange={(v) => v && setInDays(v)} />
            <AppText variant="bodyMedium">{fmtDay(addDays(now, Number(inDays)))} · Block C · {r.department} OPD</AppText>
            <AppText variant="caption" tone="secondary">The mother sees this in her app with place and date.</AppText>
          </>
        ) : (
          <Field label="Assessment & recommendations (specialist)" value={recs} onChangeText={setRecs} multiline placeholder="As documented by the specialist" />
        )}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', gap: 4 },
  stepCol: { flex: 1, gap: 6 },
  bar: { height: 5, borderRadius: 3 },
});
