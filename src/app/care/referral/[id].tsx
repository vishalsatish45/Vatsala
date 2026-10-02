import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { addDays } from '@domain/gestation';

import { asReferralId } from '@/data/ids';
import { ago, fmtDay, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS, type ReferralStatus } from '@/data/types';
import { referralStepSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
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
  const id = asReferralId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const r = db.referrals.find((x) => x.id === id);
  const [sheet, setSheet] = useState(false);
  const { control, handleSubmit } = useZodForm(referralStepSchema, { defaultValues: { inDays: '3', recs: '' } });
  const inDays = useWatch({ control, name: 'inDays' });
  // Each step is one intent: the lock lifts when the referral's status moves on.
  const { busy, once } = useSubmitOnce(r?.status);
  if (!r) return <Screen header={<TopBar back title="Referral" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === r.pregnancyId)!;
  const m = motherOf(db, p.motherId);
  const next = NEXT[r.status];
  const stepIndex = REFERRAL_STEPS.indexOf(r.status);

  function advance() {
    if (!next) return;
    if (next.to === 'scheduled' || next.to === 'recommendations') return setSheet(true);
    once(() => db.advanceReferral(r!.id, next.to, {}, by, now))();
  }

  const confirmSheet = handleSubmit(
    once((v) => {
      if (next?.to === 'scheduled') db.advanceReferral(r!.id, 'scheduled', { scheduledAt: addDays(now, Number(v.inDays)), place: `Block C · ${r!.department} OPD` }, by, now);
      if (next?.to === 'recommendations') db.advanceReferral(r!.id, 'recommendations', { recommendations: v.recs.trim() || 'Documented in notes' }, by, now);
      setSheet(false);
    }),
  );

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Referral" />}
      footer={
        next ? (
          <View style={{ gap: 8 }}>
            <Button label={next.label} disabled={busy} onPress={advance} />
            {r.status === 'requested' && <Button variant="secondary" label="Decline" disabled={busy} onPress={once(() => db.advanceReferral(r.id, 'declined', { note: 'Declined' }, by, now))} />}
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

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={next?.to === 'scheduled' ? 'Schedule appointment' : 'Recommendations'} footer={<Button label="Confirm" disabled={busy} onPress={confirmSheet} />}>
        {next?.to === 'scheduled' ? (
          <>
            <Controller control={control} name="inDays" render={({ field }) => <OptionChips label="Appointment in (days)" options={['1', '2', '3', '5', '7']} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
            <AppText variant="bodyMedium">{fmtDay(addDays(now, Number(inDays)))} · Block C · {r.department} OPD</AppText>
            <AppText variant="caption" tone="secondary">The mother sees this in her app with place and date.</AppText>
          </>
        ) : (
          <Controller
            control={control}
            name="recs"
            render={({ field }) => <Field label="Assessment & recommendations (specialist)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline placeholder="As documented by the specialist" />}
          />
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
