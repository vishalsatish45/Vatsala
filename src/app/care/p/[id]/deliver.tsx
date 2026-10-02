import { useMemo } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { gestationalAge, formatGA } from '@domain/gestation';

import { asPregnancyId } from '@/data/ids';
import { motherOf } from '@/data/selectors';
import { useDb, type DeliveryInput } from '@/data/store';
import type { PregnancyId } from '@/data/types';
import { BIRTH_TIMES, birthTime, blankBaby, makeDeliverySchema, type DeliveryForm } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const MODES = ['Normal vaginal', 'Assisted (vacuum/forceps)', 'LSCS (elective)', 'LSCS (emergency)'];
const COMPLICATIONS = ['PPH', 'Eclampsia', 'Retained placenta', 'Perineal tear', 'Other'];
const MEDICINES = ['Oxytocin', 'MgSO4', 'Antibiotics', 'Blood transfusion', 'Steroids (antenatal)'];

/** CT-56/57 Admission & delivery record (PRD F-18) → creates linked baby record(s) (F-19). */
export default function RecordDelivery() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  return <DeliveryFormScreen key={id} id={id} />;
}

function DeliveryFormScreen({ id }: { id: PregnancyId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const schema = useMemo(() => makeDeliverySchema(now), [now]);
  const { control, handleSubmit } = useZodForm(schema, {
    defaultValues: { when: 'Now', mode: undefined, indication: '', loss: '', complications: [], medicines: ['Oxytocin'], count: '1', babies: [blankBaby(), blankBaby()] },
  });
  const { busy, once } = useSubmitOnce();
  const admit = useSubmitOnce(p.status);
  const values = useWatch({ control }) as DeliveryForm;

  const ga = gestationalAge(p.edd, birthTime(values.when, now));
  const n = Number(values.count);

  const save = handleSubmit(
    once((input: DeliveryInput) => {
      db.recordDelivery(p.id, input, by);
      router.replace({ pathname: '/care/delivered/[id]', params: { id: p.id } });
    }),
    (errors) => Alert.alert(errors.mode ? 'Mode of delivery' : 'Baby details', firstError(errors) ?? ''),
  );

  return (
    <Screen blob="none" header={<TopBar back title="Record delivery" />} footer={<Button label="Save delivery" disabled={busy} onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · GA at delivery {formatGA(ga)} weeks
        </AppText>
      </View>

      {p.status === 'active' && <Button variant="secondary" label="Mark admitted (labour room)" disabled={admit.busy} onPress={admit.once(() => db.admit(p.id, by, now))} />}

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Delivery</AppText>
        <Controller control={control} name="when" render={({ field }) => <OptionChips label="Time of birth" options={Object.keys(BIRTH_TIMES)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
        <Controller control={control} name="mode" render={({ field }) => <OptionChips label="Mode" options={MODES} value={field.value} onChange={field.onChange} />} />
        {values.mode?.startsWith('LSCS') && (
          <Controller control={control} name="indication" render={({ field }) => <Field label="Indication (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        )}
        <Controller control={control} name="loss" render={({ field }) => <Field label="Estimated blood loss" unit="ml" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        <Controller control={control} name="complications" render={({ field }) => <OptionChips multi label="Complications (documented)" options={COMPLICATIONS} value={field.value} onChange={field.onChange} />} />
        <Controller control={control} name="medicines" render={({ field }) => <OptionChips multi label="Medicines given" options={MEDICINES} value={field.value} onChange={field.onChange} />} />
        <Controller control={control} name="count" render={({ field }) => <OptionChips label="Number of babies" options={['1', '2']} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
      </Card>

      {values.babies.slice(0, n).map((b, i) => (
        <Card key={i} style={{ gap: space.md }}>
          <AppText variant="title">Baby {i + 1}</AppText>
          <Controller
            control={control}
            name={`babies.${i}.outcome`}
            render={({ field }) => <OptionChips label="Outcome" options={['Liveborn', 'Stillborn']} value={field.value === 'live' ? 'Liveborn' : 'Stillborn'} onChange={(v) => field.onChange(v === 'Stillborn' ? 'stillbirth' : 'live')} />}
          />
          <Controller
            control={control}
            name={`babies.${i}.sex`}
            render={({ field }) => (
              <OptionChips label="Sex" options={['Girl', 'Boy']} value={field.value === 'F' ? 'Girl' : field.value === 'M' ? 'Boy' : undefined} onChange={(v) => field.onChange(v === 'Girl' ? 'F' : v === 'Boy' ? 'M' : undefined)} />
            )}
          />
          <Controller control={control} name={`babies.${i}.weight`} render={({ field }) => <Field label="Birth weight" unit="g" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          {b.outcome === 'live' && (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Controller control={control} name={`babies.${i}.apgar1`} render={({ field }) => <Field flex label="Apgar 1 min" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
                <Controller control={control} name={`babies.${i}.apgar5`} render={({ field }) => <Field flex label="Apgar 5 min" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
              </View>
              <Controller
                control={control}
                name={`babies.${i}.birthDoses`}
                render={({ field }) => (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <AppText variant="bodyMedium">Birth doses given (BCG, OPV-0, Hep B)</AppText>
                    <Switch value={field.value} onValueChange={field.onChange} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={field.value ? palette.rose500 : palette.white} />
                  </View>
                )}
              />
            </>
          )}
        </Card>
      ))}
      <AppText variant="caption" tone="faint">
        Saving creates each baby’s record ({p.mchId}-B1…), links it to the mother, generates the vaccine schedule and opens the discharge checklists.
      </AppText>
    </Screen>
  );
}
