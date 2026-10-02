import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';

import { asReferralId } from '@/data/ids';
import { ago, fmtDay, fmtTime, gaLabel, motherOf, referralStatusLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import { REFERRAL_STEPS, type Referral, type ReferralStatus } from '@/data/types';
import { useCareMe } from '@/features/care/CareTeam';
import { dateText, makeScheduleReferralSchema, referralReasonSchema, referralRecsSchema, timeText } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { canWriteSubject, referralMoves, referralSide } from '@/features/care/permissions';
import { WhenFields } from '@/features/care/WhenFields';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, InfoRow, Screen, Sheet, TopBar, palette, space } from '@/ui';

/** A move that needs details first (a sheet); the others are one tap. */
type SheetMove = 'scheduled' | 'recommendations' | 'declined' | 'cancelled';

const SHEET_TITLE: Record<SheetMove, string> = {
  scheduled: 'Appointment',
  recommendations: 'Recommendations',
  declined: 'Decline referral',
  cancelled: 'Cancel referral',
};

/**
 * CT-52 Referral detail — full lifecycle between departments (PRD F-17). Each side sees only the moves the server
 * allows it (advance_referral): the receiving department accepts or declines, schedules, sees and answers; the
 * referring team closes the answered referral or cancels it. Everything the family or the referrer reads (time,
 * place, recommendations, reasons) is what the clinician typed — nothing is filled in.
 */
export default function ReferralDetail() {
  const id = asReferralId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const me = useCareMe();
  const r = db.referrals.find((x) => x.id === id);
  const [sheet, setSheet] = useState<SheetMove>();
  // Each one-tap step is one intent: the lock lifts when the referral's status moves on.
  const { busy, once } = useSubmitOnce(r?.status);
  if (!r) return <Screen header={<TopBar back title="Referral" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === r.pregnancyId);
  if (!p) return <Screen header={<TopBar back title="Referral" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  const side = referralSide(db, me, r);
  const moves = referralMoves(r.status, side);
  const stepIndex = REFERRAL_STEPS.indexOf(r.status);
  // share_result: only a clinician who may write the referred record shares results (app.require_writer).
  const canShare = canWriteSubject(me, r.babyId ? 'baby' : 'pregnancy') && !side.receiving;
  const shared = new Set(db.sharedResults.filter((x) => x.referralId === r.id).map((x) => x.investigationId));
  const results = db.investigations
    .filter((i) => i.subjectId === r.pregnancyId && i.result && (canShare || shared.has(i.id)))
    .sort((a, b) => Number(b.sensitive) - Number(a.sensitive) || a.label.localeCompare(b.label));

  const step = (to: ReferralStatus) => once(() => db.advanceReferral(r.id, to, {}, by, now));
  const buttons = moves.map((to) => {
    switch (to) {
      case 'accepted':
        return <Button key={to} label="Accept referral" disabled={busy} onPress={step('accepted')} />;
      case 'seen':
        return <Button key={to} label="Mark patient seen" disabled={busy} onPress={step('seen')} />;
      case 'closed':
        return <Button key={to} label="Close referral" disabled={busy} onPress={step('closed')} />;
      case 'scheduled':
        return <Button key={to} variant={r.status === 'scheduled' ? 'secondary' : 'primary'} label={r.status === 'scheduled' ? 'Reschedule…' : 'Schedule appointment…'} disabled={busy} onPress={() => setSheet('scheduled')} />;
      case 'recommendations':
        return <Button key={to} label="Document recommendations…" disabled={busy} onPress={() => setSheet('recommendations')} />;
      case 'declined':
        return <Button key={to} variant="secondary" label="Decline…" disabled={busy} onPress={() => setSheet('declined')} />;
      case 'cancelled':
        return <Button key={to} variant="secondary" label="Cancel referral…" disabled={busy} onPress={() => setSheet('cancelled')} />;
      default:
        return null;
    }
  });

  return (
    <Screen blob="none" header={<TopBar back title="Referral" />} footer={buttons.length ? <View style={{ gap: 8 }}>{buttons}</View> : undefined}>
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
                {referralStatusLabel(s)}
              </AppText>
            </View>
          ))}
        </View>
        {(r.status === 'declined' || r.status === 'cancelled') && <Chip label={referralStatusLabel(r.status)} variant="selected" />}
      </Card>

      <Card>
        <InfoRow label="Reason" value={r.reason} />
        <InfoRow label="Question" value={r.question} />
        <InfoRow label="Urgency" value={r.urgency === '24h' ? 'Within 24 h' : r.urgency} />
        <InfoRow label="Appointment" value={r.scheduledAt ? [`${fmtDay(r.scheduledAt)} ${fmtTime(r.scheduledAt)}`, r.place].filter(Boolean).join(' · ') : undefined} />
        <InfoRow label="Recommendations" value={r.recommendations} />
        <InfoRow label="Referred by" value={r.createdBy} />
      </Card>

      <Card style={{ gap: 8 }}>
        <AppText variant="headline">History</AppText>
        {[...r.events].reverse().map((e, i) => (
          <AppText key={i} variant="caption" tone="secondary">
            {referralStatusLabel(e.status)} · {e.by} · {ago(e.at, now)} ago{e.note ? ` · ${e.note}` : ''}
          </AppText>
        ))}
      </Card>

      <Card style={{ gap: 8 }}>
        <AppText variant="headline">{canShare ? 'Share results with this department' : 'Results shared with this referral'}</AppText>
        {canShare ? (
          <AppText variant="caption" tone="secondary">
            While the referral is open, and for 30 days after it ends, the department can open this pregnancy’s record: visits, notes, plans and tests,
            and only the referrals addressed to it — not the family’s call-backs, home readings or caregivers. Private tests (HIV, syphilis, HBsAg) reach
            it only if you share them here.
          </AppText>
        ) : (
          <AppText variant="caption" tone="secondary">
            Private tests (HIV, syphilis, HBsAg) reach the department only when the referring team shares them.
          </AppText>
        )}
        {results.length === 0 && <AppText tone="secondary">{canShare ? 'No results recorded yet.' : 'None shared.'}</AppText>}
        {results.map((i) => {
          const isShared = shared.has(i.id);
          return (
            <View key={i.id} style={styles.result}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyMedium">
                  {i.label}
                  {i.sensitive ? ' · private' : ''}
                </AppText>
                <AppText variant="caption" tone="secondary">
                  {`${i.result!.value}${i.result!.unit ? ` ${i.result!.unit}` : ''} · ${fmtDay(i.result!.at)} (as entered)`}
                </AppText>
              </View>
              {canShare && (isShared ? <Chip label="Shared" variant="selected" /> : <Chip label="Share" onPress={() => db.shareResult(r.id, i.id, by, now)} />)}
            </View>
          );
        })}
      </Card>

      <Button variant="secondary" label={`Open ${m.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />

      <Sheet visible={!!sheet} onClose={() => setSheet(undefined)} title={sheet ? SHEET_TITLE[sheet] : ''}>
        {sheet === 'scheduled' && <ScheduleForm key={`${r.id}:${r.status}`} referral={r} onDone={() => setSheet(undefined)} />}
        {sheet === 'recommendations' && <RecommendationsForm key={`${r.id}:${r.status}`} referral={r} onDone={() => setSheet(undefined)} />}
        {(sheet === 'declined' || sheet === 'cancelled') && <ReasonForm key={`${r.id}:${sheet}`} referral={r} to={sheet} onDone={() => setSheet(undefined)} />}
      </Sheet>
    </Screen>
  );
}

/** The appointment as the department books it: exact date and time, and where she should come. */
function ScheduleForm({ referral: r, onDone }: { referral: Referral; onDone: () => void }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { busy, once } = useSubmitOnce();
  const { control, handleSubmit, setValue, formState } = useZodForm(makeScheduleReferralSchema(now), {
    defaultValues: r.scheduledAt ? { date: dateText(r.scheduledAt), time: timeText(r.scheduledAt), place: r.place ?? '' } : { date: '', time: '', place: r.place ?? '' },
  });
  const save = handleSubmit(
    once((v) => {
      db.advanceReferral(r.id, 'scheduled', { scheduledAt: v.scheduledAt, place: v.place }, by, now);
      onDone();
    }),
  );
  return (
    <View style={{ gap: space.md }}>
      <WhenFields control={control} setValue={setValue} label="Date and time of the appointment" error={formState.errors.time?.message} />
      <Controller
        control={control}
        name="place"
        render={({ field, fieldState }) => (
          <Field label="Place" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Cardiology OPD, room 4" error={fieldState.error?.message} />
        )}
      />
      <AppText variant="caption" tone="secondary">
        The mother sees this date, time and place in her app.
      </AppText>
      <Button label="Save appointment" disabled={busy} onPress={save} />
    </View>
  );
}

/** The department's assessment and recommendations, exactly as the specialist writes them. */
function RecommendationsForm({ referral: r, onDone }: { referral: Referral; onDone: () => void }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { busy, once } = useSubmitOnce();
  const { control, handleSubmit } = useZodForm(referralRecsSchema, { defaultValues: { recs: '' } });
  const save = handleSubmit(
    once((v) => {
      db.advanceReferral(r.id, 'recommendations', { recommendations: v.recommendations }, by, now);
      onDone();
    }),
  );
  return (
    <View style={{ gap: space.md }}>
      <Controller
        control={control}
        name="recs"
        render={({ field, fieldState }) => (
          <Field label="Assessment & recommendations (specialist)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline placeholder="As documented by the specialist" error={fieldState.error?.message} />
        )}
      />
      <Button label="Save recommendations" disabled={busy} onPress={save} />
    </View>
  );
}

/** Why the department declines, or the referring team cancels — required, and kept on the referral's timeline. */
function ReasonForm({ referral: r, to, onDone }: { referral: Referral; to: 'declined' | 'cancelled'; onDone: () => void }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { busy, once } = useSubmitOnce();
  const { control, handleSubmit } = useZodForm(referralReasonSchema, { defaultValues: { reason: '' } });
  const save = handleSubmit(
    once((v) => {
      db.advanceReferral(r.id, to, { note: v.note }, by, now);
      onDone();
    }),
  );
  return (
    <View style={{ gap: space.md }}>
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <Field
            label={to === 'declined' ? 'Why the department declines (recorded)' : 'Why the referral is cancelled (recorded)'}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
            error={fieldState.error?.message}
          />
        )}
      />
      <AppText variant="caption" tone="secondary">
        {r.status === 'scheduled' ? 'The booked appointment is cancelled too; the mother no longer sees it.' : 'The referring team sees this reason.'}
      </AppText>
      <Button label={to === 'declined' ? 'Decline referral' : 'Cancel referral'} disabled={busy} onPress={save} />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', gap: 4 },
  stepCol: { flex: 1, gap: 6 },
  bar: { height: 5, borderRadius: 3 },
  result: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
});
