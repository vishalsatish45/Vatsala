import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';

import { dischargePlan } from '@/data/discharge';
import { asSubjectId } from '@/data/ids';
import { fmtDay, fmtTime, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { DischargeItem, SubjectId } from '@/data/types';
import { DISCHARGE_REASONS, birthTime, dischargeItemResolved, dischargeReasonSchema, makeDischargeTimeSchema, whenDefaults } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { WhenFields } from '@/features/care/WhenFields';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, ChecklistRow, Chip, Field, ListRow, OptionChips, ProgressBar, Screen, Sheet, TopBar, space } from '@/ui';

type Asking = { key: string; label: string; state: 'na' | 'deferred' };

/**
 * CT-95 Discharge checklist (PRD F-21). "Complete" stays disabled until every item is done or marked N/A / deferred
 * WITH a reason (N/A and Defer are saved only together with their reason). Completion is recorded at its documented
 * time and creates the follow-up plan (F-22), previewed here first — a visit whose window has already closed is said
 * plainly, not dropped silently.
 */
export default function DischargeChecklist() {
  const id = asSubjectId(useLocalSearchParams<{ id: string }>().id);
  return <Checklist key={id} id={id} />;
}

function Checklist({ id }: { id: SubjectId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [asking, setAsking] = useState<Asking>();
  const d = db.discharges.find((x) => x.subjectId === id);
  const baby = d?.subject === 'baby' ? db.babies.find((b) => b.id === id) : undefined;
  const p = d ? db.pregnancies.find((x) => x.id === (baby ? baby.pregnancyId : id)) : undefined;
  const delivery = p ? db.deliveries.find((x) => x.pregnancyId === p.id) : undefined;
  const born = baby?.dob ?? delivery?.at;
  const notBefore = [born, baby ? undefined : p?.admittedAt].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0];
  const { control, handleSubmit, setValue, formState } = useZodForm(makeDischargeTimeSchema(now, notBefore), { defaultValues: whenDefaults(now) });
  const when = useWatch({ control });
  // Locked until the write lands: completed, or (Supabase mode) the server's discharge id arrives for a retry.
  const { busy, once } = useSubmitOnce(`${d?.id ?? ''}:${d?.completedAt ? 'completed' : 'open'}`);
  if (!d || !p) return <Screen header={<TopBar back title="Discharge" />}><AppText>No discharge checklist for this record.</AppText></Screen>;

  const m = motherOf(db, p.motherId);
  // Each tap on Done, or a reason for N/A / Defer, is saved at once; "Complete" checks every item with the schema.
  const resolved = d.items.filter((i) => dischargeItemResolved.safeParse(i).success);
  const ready = resolved.length === d.items.length;
  const at = birthTime(when.date ?? '', when.time ?? '') ?? now;
  const plan = d.completedAt ? [] : dischargePlan(db, id, at);
  const followUps = db.tasks.filter((t) => t.subjectId === id && (t.kind === 'pn_visit' || t.kind === 'nb_visit' || t.kind === 'template'));

  const complete = handleSubmit(
    once((v) => {
      db.completeDischarge(id, by, v.at);
      const n = useDb.getState().tasks.filter((t) => t.subjectId === id && (t.kind === 'pn_visit' || t.kind === 'nb_visit' || t.kind === 'template')).length;
      Alert.alert('Discharge complete', `${n} follow-up visit${n === 1 ? '' : 's'} scheduled. The family sees them in their app.`);
    }),
    (errors) => Alert.alert('Check the time of discharge', firstError(errors) ?? ''),
  );

  const tap = (i: DischargeItem, state: 'na' | 'deferred') => {
    // tapping the chosen state again clears it; otherwise ask for the reason first — nothing is saved without one
    if (i.state === state) db.setDischargeItem(id, i.key, undefined, undefined);
    else setAsking({ key: i.key, label: i.label, state });
  };

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Discharge checklist" />}
      footer={!d.completedAt ? <Button label={ready ? 'Complete discharge' : `Complete discharge (${d.items.length - resolved.length} open)`} disabled={!ready || busy} onPress={complete} /> : undefined}
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{baby ? `Baby ${baby.childId}` : m.name}</AppText>
        <AppText tone="secondary">
          {baby ? `Baby of ${m.name}` : `${p.mchId} · mother`}
          {born ? ` · born ${fmtDay(born)} ${fmtTime(born)}` : ''}
        </AppText>
      </View>

      <Card>
        <ProgressBar
          progress={resolved.length / d.items.length}
          leftCaption={`${resolved.length} of ${d.items.length} resolved`}
          rightCaption={d.completedAt ? `Completed ${fmtDay(d.completedAt)} ${fmtTime(d.completedAt)}` : ready ? 'Ready' : 'Open'}
        />
      </Card>

      <Card style={{ gap: 2 }}>
        {d.items.map((i) => (
          <ChecklistRow
            key={i.key}
            label={i.label}
            state={i.state === 'deferred' ? 'deferred' : i.state}
            detail={i.state && i.state !== 'done' ? `${i.state === 'na' ? 'N/A' : 'Deferred'}${i.reason ? ` · ${i.reason}` : ' · reason needed'}` : undefined}
            actions={
              d.completedAt ? undefined : (
                <>
                  <Chip label="Done" variant={i.state === 'done' ? 'selected' : 'soft'} onPress={() => db.setDischargeItem(id, i.key, i.state === 'done' ? undefined : 'done', undefined)} />
                  <Chip label="N/A" variant={i.state === 'na' ? 'selected' : 'soft'} onPress={() => tap(i, 'na')} />
                  <Chip label="Defer" variant={i.state === 'deferred' ? 'selected' : 'soft'} onPress={() => tap(i, 'deferred')} />
                </>
              )
            }
          />
        ))}
      </Card>

      {!d.completedAt && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title">Completing the discharge</AppText>
          <WhenFields control={control} setValue={setValue} label="Time of discharge" error={formState.errors.time?.message} />
          {!baby && <AppText variant="caption" tone="secondary">Completing the mother’s discharge also ends her admission.</AppText>}
          <AppText variant="headline">Follow-up visits this will schedule</AppText>
          {plan.length === 0 && <AppText tone="secondary">No follow-up visits in the protocol for this record.</AppText>}
          {plan.map((f) => (
            <ListRow
              key={f.key}
              title={f.title}
              subtitle={
                f.closed
                  ? `Window ended ${fmtDay(f.dueBy)} — before the day of discharge, so it will not be scheduled. Book a visit from the record if one is needed.`
                  : `${fmtDay(f.dueFrom)} – ${fmtDay(f.dueBy)}${f.templateKey ? ' · from tag template' : ''}`
              }
            />
          ))}
        </Card>
      )}

      {d.completedAt && (
        <View style={{ gap: space.sm }}>
          <AppText variant="title">Follow-up plan</AppText>
          {followUps.length === 0 && <AppText tone="secondary">No follow-up visits were scheduled.</AppText>}
          {followUps.map((t) => (
            <ListRow key={t.id} title={t.title} subtitle={`${fmtDay(t.dueFrom ?? t.dueBy)} – ${fmtDay(t.dueBy)}${t.generatedBy === 'template' ? ' · from tag template' : ''}`} />
          ))}
          <Button variant="secondary" label="Back" onPress={() => router.back()} />
        </View>
      )}

      {asking && <ReasonSheet key={`${asking.key}:${asking.state}`} asking={asking} onClose={() => setAsking(undefined)} onSave={(reason) => db.setDischargeItem(id, asking.key, asking.state, reason)} />}
    </Screen>
  );
}

/** The reason for N/A / Defer: discharge reasons, or "Other" with free text. Saved together with the state. */
function ReasonSheet({ asking, onClose, onSave }: { asking: Asking; onClose: () => void; onSave: (reason: string) => void }) {
  const { control, handleSubmit } = useZodForm(dischargeReasonSchema, { defaultValues: { reason: undefined, other: '' } });
  const reason = useWatch({ control, name: 'reason' });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((v) => {
      onSave(v.reason);
      onClose();
    }),
    (errors) => Alert.alert('Reason needed', firstError(errors) ?? ''),
  );
  return (
    <Sheet
      visible
      onClose={onClose}
      title={asking.state === 'na' ? 'Why is this not applicable?' : 'Why is this deferred?'}
      subtitle={asking.label}
      footer={
        <>
          <Button label={asking.state === 'na' ? 'Mark N/A' : 'Defer'} disabled={busy} onPress={save} />
          <Button variant="secondary" label="Cancel" onPress={onClose} />
        </>
      }
    >
      <Controller control={control} name="reason" render={({ field }) => <OptionChips label="Reason" options={DISCHARGE_REASONS[asking.state]} value={field.value} onChange={field.onChange} />} />
      {reason === 'Other' && (
        <Controller control={control} name="other" render={({ field }) => <Field label="Reason (recorded)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
      )}
    </Sheet>
  );
}
