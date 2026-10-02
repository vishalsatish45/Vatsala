import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { formatGA, gestationalAge } from '@domain/gestation';

import { asPregnancyId } from '@/data/ids';
import { eddFor } from '@/data/payloads';
import { fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { DATING_METHODS, LMP_CERTAINTY, blankDating, calendarDay, makeDatingSchema, registerDating, type DatingForm } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, DatePicker, Field, OptionChips, Screen, TopBar, space } from '@/ui';

const SOURCE: Record<string, string> = { lmp: 'LMP', scan: 'scan', clinician: 'clinician' };

/**
 * Record dating / re-date a pregnancy (PRD F-11). The clinician enters a dating — LMP, a scan (date + gestational age
 * at the scan) or an EDD she decides — and sees the EDD and today's gestational age it gives before saving. The app
 * never picks a dating.
 *  - First dating (registered without one): saving schedules the ANC visits and test windows and, from 34 weeks,
 *    the paediatric team's access.
 *  - Re-dating: both EDDs side by side; choosing the new one re-plans the future ANC visits (version-checked).
 */
export default function Redate() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  const p = useDb((s) => s.pregnancies.find((x) => x.id === id));
  if (!p) return <Screen header={<TopBar back title="Dating" />}><AppText>Not found.</AppText></Screen>;
  return <DatingScreen key={p.id} pregnancyId={p.id} />;
}

function DatingScreen({ pregnancyId }: { pregnancyId: ReturnType<typeof asPregnancyId> }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === pregnancyId)!;
  const m = motherOf(db, p.motherId);
  const first = !p.edd;
  const ongoing = p.status === 'active' || p.status === 'admitted';
  const schema = useMemo(() => makeDatingSchema(now), [now]);
  const { control, handleSubmit, formState } = useZodForm(schema, { defaultValues: { ...blankDating(now), method: first ? 'LMP' : 'Scan' } });
  const values = useWatch({ control }) as DatingForm;
  const { busy, once } = useSubmitOnce();

  const method = DATING_METHODS[values.method];
  const parsed = schema.safeParse(values);
  const problem = parsed.error?.issues[0]?.message;
  const entered = registerDating(values);
  const newEdd = parsed.success && entered ? eddFor(entered) : undefined;
  const openVisits = db.tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() > now.getTime()).length;
  const title = first ? 'Record dating' : 'Re-date pregnancy';

  const save = handleSubmit(
    once((dating) => {
      db.redatePregnancy(p.id, dating, by, now);
      router.back();
    }),
  );

  return (
    <Screen blob="none" header={<TopBar back title={title} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">{p.mchId}</AppText>
      </View>
      {!ongoing && <AppText tone="secondary">Only an ongoing pregnancy can be dated.</AppText>}
      {first && (
        <AppText tone="secondary">
          Dating not recorded yet. Enter how you date her pregnancy; the EDD it gives schedules her ANC visits and test windows.
        </AppText>
      )}

      <Card style={{ gap: space.md }}>
        <Controller control={control} name="method" render={({ field }) => <OptionChips label="Date by — you choose" options={Object.keys(DATING_METHODS)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
        {method === 'lmp' && (
          <>
            <AppText variant="label" tone="secondary">
              First day of the last menstrual period{values.lmp ? `: ${fmtDay(calendarDay(values.lmp))}` : ' — tap a day'}
            </AppText>
            <Controller control={control} name="lmp" render={({ field }) => <DatePicker value={field.value} initial={now} onChange={field.onChange} />} />
            <Controller control={control} name="lmpCertain" render={({ field }) => <OptionChips label="LMP (as documented)" options={[...LMP_CERTAINTY]} value={field.value} onChange={field.onChange} />} />
          </>
        )}
        {method === 'scan' && (
          <>
            <AppText variant="label" tone="secondary">
              Scan date: {fmtDay(calendarDay(values.scanOn))}
            </AppText>
            <Controller control={control} name="scanOn" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Controller control={control} name="scanWeeks" render={({ field }) => <Field flex label="GA at scan · weeks" keyboardType="number-pad" maxLength={2} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
              <Controller control={control} name="scanDays" render={({ field }) => <Field flex label="+ days" keyboardType="number-pad" maxLength={1} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            </View>
          </>
        )}
        {method === 'clinician' && (
          <>
            <AppText variant="label" tone="secondary">
              EDD decided by the clinician{values.eddDecided ? `: ${fmtDay(calendarDay(values.eddDecided))}` : ' — tap a day'}
            </AppText>
            <Controller control={control} name="eddDecided" render={({ field }) => <DatePicker value={field.value} initial={now} minDate={now} onChange={field.onChange} />} />
          </>
        )}
        <Controller control={control} name="datingNote" render={({ field }) => <Field label="Note (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Dating scan report from district hospital" />} />
        {!!problem && formState.isDirty && <AppText variant="caption" tone="secondary">To continue: {problem}</AppText>}
      </Card>

      <View style={styles.compare}>
        {!first && p.edd && (
          <Card style={styles.col}>
            <AppText variant="label" tone="secondary">Current EDD ({SOURCE[p.eddSource ?? 'lmp']})</AppText>
            <AppText variant="title">{fmtDay(p.edd)}</AppText>
            <AppText variant="caption" tone="secondary">
              GA today {formatGA(gestationalAge(p.edd, now))}
            </AppText>
          </Card>
        )}
        <Card style={styles.col}>
          <AppText variant="label" tone="secondary">{first ? 'EDD' : 'New EDD'} ({SOURCE[method]})</AppText>
          <AppText variant="title">{newEdd ? fmtDay(newEdd) : '—'}</AppText>
          <AppText variant="caption" tone="secondary">
            {newEdd ? `GA today ${formatGA(gestationalAge(newEdd, now))}` : 'Enter the dating'}
          </AppText>
        </Card>
      </View>
      <AppText variant="caption" tone="faint">
        {first
          ? 'Saving schedules her ANC visits and the test windows from this EDD.'
          : `You choose which EDD the record uses. Choosing the new one re-plans the ${openVisits} future ANC visit${openVisits === 1 ? '' : 's'} from it; completed visits and results are kept.`}
      </AppText>

      <Button label={first ? 'Save dating' : 'Use the new EDD'} disabled={!newEdd || !ongoing || busy} onPress={save} />
      <Button variant="secondary" label={first ? 'Not now' : 'Keep the current EDD'} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  compare: { flexDirection: 'row', gap: space.sm },
  col: { flex: 1, gap: 4 },
});
