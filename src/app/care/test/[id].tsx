import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';

import { NOT_DONE_REASONS } from '@/data/catalogue';
import { asInvestigationId } from '@/data/ids';
import { fmtDay, invState, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Investigation, PregnancyId } from '@/data/types';
import { useCareMe } from '@/features/care/CareTeam';
import { EnteredInErrorSheet, type EieTarget } from '@/features/care/EnteredInErrorSheet';
import { FOLLOW_UPS, notDoneSchema, resultSchema, reviewSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { canWriteSubject } from '@/features/care/permissions';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, InfoRow, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

/** CT-23/24 Investigation: order → enter result → clinician review (PRD F-16). No auto "abnormal". */
export default function TestDetail() {
  const id = asInvestigationId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const order = useSubmitOnce(db.investigations.find((x) => x.id === id)?.status);
  const inv = db.investigations.find((x) => x.id === id);
  const [eie, setEie] = useState<EieTarget>();
  const me = useCareMe();
  if (!inv) return <Screen header={<TopBar back title="Test" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === inv.subjectId);
  const m = p ? motherOf(db, p.motherId) : undefined;
  const s = invState(inv, now);
  // app.require_writer: a pregnancy's tests are the obstetrician's, a baby's the paediatrician's (order, result,
  // not done, review, entered in error). Others read only.
  const treating = canWriteSubject(me, db.babies.some((b) => b.id === inv.subjectId) ? 'baby' : 'pregnancy');

  return (
    <Screen blob="none" header={<TopBar back title="Investigation" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{inv.label}</AppText>
        <AppText tone="secondary">
          {m?.name} · {p?.mchId}
        </AppText>
        <StatusBadge status={s.status} label={s.label} />
      </View>

      <Card>
        <InfoRow label="Window" value={`${fmtDay(inv.dueFrom)} – ${fmtDay(inv.dueBy)}`} />
        <InfoRow label="Type" value={inv.kind === 'scan' ? 'Ultrasound' : 'Lab'} />
        {inv.orderedAt && <InfoRow label="Ordered" value={fmtDay(inv.orderedAt)} />}
        {inv.result && <InfoRow label="Tested" value={fmtDay(inv.result.at)} />}
        {inv.result && <InfoRow label="Result (as entered)" value={`${inv.result.value}${inv.result.unit ? ` ${inv.result.unit}` : ''}`} />}
        {inv.result?.note && <InfoRow label="Note" value={inv.result.note} />}
        {inv.review && <InfoRow label="Reviewed" value={`${inv.review.by} · ${fmtDay(inv.review.at)} · ${inv.review.followUp}`} />}
        {inv.sensitive && <InfoRow label="Privacy" value="Never shown in the Family app" />}
        {inv.result && inv.resultId && treating && (
          <View style={{ flexDirection: 'row', paddingTop: space.sm }}>
            <Chip label="Result entered in error" onPress={() => setEie({ kind: 'investigation_result', id: inv.resultId!, label: `${inv.label} · ${inv.result!.value}${inv.result!.unit ? ` ${inv.result!.unit}` : ''}` })} />
          </View>
        )}
      </Card>
      <EnteredInErrorSheet target={eie} onClose={() => setEie(undefined)} />

      {treating && (inv.status === 'due' || inv.status === 'ordered') && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">{inv.status === 'due' ? 'Order or enter result' : 'Enter result'}</AppText>
          {inv.status === 'due' && <Button variant="secondary" label="Mark as ordered" disabled={order.busy} onPress={order.once(() => db.orderInvestigation(inv.id, by, now))} />}
          <ResultForm key={inv.id} inv={inv} />
          <NotDoneForm key={`nd-${inv.id}`} inv={inv} />
        </Card>
      )}

      {treating && inv.status === 'resulted' && <ReviewForm key={inv.id} inv={inv} pregnancyId={p?.id} />}
    </Screen>
  );
}

function ResultForm({ inv }: { inv: Investigation }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(resultSchema, { defaultValues: { value: '', note: '' } });
  const { busy, once } = useSubmitOnce(inv.status);
  const save = handleSubmit(once((r) => db.enterResult(inv.id, r.value, undefined, r.note, by, now)));
  return (
    <>
      <Controller
        control={control}
        name="value"
        render={({ field }) => <Field label="Result" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder={inv.kind === 'scan' ? 'e.g. Report documented' : 'e.g. 11.2 g/dL'} />}
      />
      <Controller control={control} name="note" render={({ field }) => <Field label="Note (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline />} />
      <Button label="Save result" disabled={busy} onPress={save} />
    </>
  );
}

function NotDoneForm({ inv }: { inv: Investigation }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(notDoneSchema, { defaultValues: { reason: undefined } });
  const { busy, once } = useSubmitOnce();
  const reason = useWatch({ control, name: 'reason' });
  const save = handleSubmit(
    once((v) => {
      db.markNotDone(inv.id, v.reason ?? '', by, now);
      router.back();
    }),
  );
  return (
    <>
      <Controller control={control} name="reason" render={({ field }) => <OptionChips label="Or mark not done" options={NOT_DONE_REASONS} value={field.value} onChange={field.onChange} />} />
      {reason && <Button variant="secondary" label={`Not done · ${reason}`} disabled={busy} onPress={save} />}
    </>
  );
}

function ReviewForm({ inv, pregnancyId }: { inv: Investigation; pregnancyId?: PregnancyId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(reviewSchema, { defaultValues: { followUp: undefined } });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once(({ followUp }) => {
      if (!followUp) return;
      db.reviewResult(inv.id, followUp, by, now);
      if (followUp === 'Refer' && pregnancyId) router.replace({ pathname: '/care/p/[id]/refer', params: { id: pregnancyId } });
      else router.back();
    }),
  );
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Your review</AppText>
      <AppText variant="caption" tone="secondary">
        The app never marks results normal or abnormal. Choose what happens next.
      </AppText>
      <Controller control={control} name="followUp" render={({ field }) => <OptionChips label="Follow-up" options={FOLLOW_UPS} value={field.value} onChange={field.onChange} />} />
      <Button label="Mark reviewed" disabled={busy} onPress={save} />
    </Card>
  );
}
