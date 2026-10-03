import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { CalendarClock, Phone, MessageCircle } from 'lucide-react-native';
import { addDays } from '@domain/gestation';

import { MISSED_OUTCOMES } from '@/data/catalogue';
import { asTaskId } from '@/data/ids';
import { ago, fmtDay, motherOf, taskState } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Task } from '@/data/types';
import { calendarDay, taskOutcomeSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { comingSoon } from '@/lib/comingSoon';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, DatePicker, Field, InfoRow, IntensityPill, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

/** CT-96 Task / missed-visit recovery: call, remind, reschedule, log outcome (PRD F-23). */
export default function TaskDetail() {
  const id = asTaskId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return <Screen header={<TopBar back title="Task" />}><AppText>Not found.</AppText></Screen>;

  const baby = t.subjectType === 'baby' ? db.babies.find((b) => b.id === t.subjectId) : undefined;
  const p = baby ? db.pregnancies.find((x) => x.id === baby.pregnancyId) : db.pregnancies.find((x) => x.id === t.subjectId);
  const m = p ? motherOf(db, p.motherId) : undefined;
  const st = taskState(db, t, now);
  const intensity = baby?.intensity ?? p?.intensity ?? 'routine';

  return (
    <Screen blob="none" header={<TopBar back title={st === 'missed' ? 'Missed visit' : 'Task'} />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{baby ? `Baby of ${m?.name}` : m?.name}</AppText>
        <AppText tone="secondary">{t.title}</AppText>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={st} label={st === 'missed' ? `Missed · due ${fmtDay(t.dueBy)}` : `Due ${fmtDay(t.dueBy)}`} />
          <IntensityPill value={intensity} />
        </View>
      </View>

      <Card>
        <InfoRow label="Phone" value={m?.phone} />
        <InfoRow label="Language" value={m?.lang === 'kn' ? 'Kannada' : m?.lang === 'hi' ? 'Hindi' : 'English'} />
        <InfoRow label="Village" value={m?.village} />
        <InfoRow label="Contact attempts" value={String(t.contactAttempts.length)} />
        {t.overrideReason && <InfoRow label="Last change" value={t.overrideReason} />}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Call" icon={Phone} onPress={() => m && Linking.openURL(`tel:${m.phone}`)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="WhatsApp" icon={MessageCircle} onPress={() => comingSoon('WhatsApp reminder (F-49) — sent from an approved template in her language')} />
        </View>
      </View>

      {!t.completedAt && !t.cancelledAt && <ChangeDate key={`date_${t.id}`} task={t} />}

      <OutcomeForm key={t.id} task={t} />

      {t.contactAttempts.length > 0 && (
        <Card style={{ gap: 6 }}>
          <AppText variant="headline">Attempts</AppText>
          {[...t.contactAttempts].reverse().map((a, i) => (
            <AppText key={i} variant="caption" tone="secondary">
              {a.outcome} · {a.by} · {ago(a.at, now)} ago
            </AppText>
          ))}
        </Card>
      )}

      {p && <Chip label={`Open ${m?.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />}
    </Screen>
  );
}

/** The doctor moves a planned visit to another day, with the reason the server records (override_task "reschedule"). */
function ChangeDate({ task }: { task: Task }) {
  const reschedule = useDb((s) => s.rescheduleTask);
  const now = useNow();
  const by = useActor();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date>();
  const [reason, setReason] = useState('');
  const { busy, once } = useSubmitOnce();
  const ready = !!day && reason.trim().length > 0;
  const save = once(() => {
    if (!day || !reason.trim()) return;
    // The day tapped on the calendar, as the UTC-midnight day the server is sent
    reschedule(task.id, calendarDay(day), reason.trim(), by, now);
    router.back();
  });

  if (!open) return <Button variant="secondary" label={`Change visit date · now ${fmtDay(task.dueBy)}`} icon={CalendarClock} onPress={() => setOpen(true)} />;
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Change visit date</AppText>
      <AppText variant="caption" tone="secondary">
        Now due {fmtDay(task.dueBy)}. Pick the new day (today or later).
      </AppText>
      <DatePicker value={day} initial={task.dueBy} minDate={now} onChange={setDay} />
      {day && <AppText variant="bodyMedium">New date: {fmtDay(calendarDay(day))}</AppText>}
      <Field label="Reason (recorded)" value={reason} onChangeText={setReason} placeholder="e.g. Mother travelling that week" />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="Cancel" onPress={() => setOpen(false)} />
        </View>
        <View style={{ flex: 2 }}>
          <Button label="Save new date" disabled={busy || !ready} onPress={save} />
        </View>
      </View>
    </Card>
  );
}

/** CT-96 "Log outcome": one contact attempt, plus the reschedule / cancel it implies. */
function OutcomeForm({ task }: { task: Task }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(taskOutcomeSchema, { defaultValues: { outcome: undefined, inDays: undefined } });
  const { busy, once } = useSubmitOnce();
  const outcome = useWatch({ control, name: 'outcome' });
  const save = handleSubmit(
    once((v) => {
      if (!v.outcome) return;
      db.logContact(task.id, v.outcome, by, now);
      if (v.outcome === 'Rescheduled' && v.inDays) db.rescheduleTask(task.id, addDays(now, Number(v.inDays)), 'Rescheduled after contact', by, now);
      if (['Delivered elsewhere', 'Moved away', 'Declined'].includes(v.outcome)) db.cancelTask(task.id, v.outcome, by, now);
      router.back();
    }),
  );
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Log outcome</AppText>
      <Controller control={control} name="outcome" render={({ field }) => <OptionChips options={MISSED_OUTCOMES} value={field.value} onChange={field.onChange} />} />
      {outcome === 'Rescheduled' && (
        <Controller control={control} name="inDays" render={({ field }) => <OptionChips label="New date in (days)" options={['1', '2', '3', '7']} value={field.value} onChange={field.onChange} />} />
      )}
      <Button label="Save outcome" disabled={busy} onPress={save} />
    </Card>
  );
}
