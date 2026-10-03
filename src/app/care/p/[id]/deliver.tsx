import { useMemo, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { gestationalAge, formatGAWords } from '@domain/gestation';

import { asPregnancyId } from '@/data/ids';
import { DATING_NOT_RECORDED, fmtDay, fmtTime, motherOf } from '@/data/selectors';
import { useDb, type DeliveryInput } from '@/data/store';
import type { PregnancyId } from '@/data/types';
import {
  BIRTH_PLACES,
  LABOUR_ONSETS,
  MAX_BABIES,
  PERINEUM,
  birthTime,
  blankBaby,
  dateText,
  makeDeliverySchema,
  timeText,
  type DeliveryForm,
} from '@/features/care/forms';
import { AdmitSheet } from '@/features/care/AdmissionSheets';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const MODES = ['Normal vaginal', 'Assisted (vacuum/forceps)', 'LSCS (elective)', 'LSCS (emergency)'];
const COMPLICATIONS = ['PPH', 'Eclampsia', 'Retained placenta', 'Perineal tear', 'Other'];
const MEDICINES = ['Oxytocin', 'MgSO4', 'Antibiotics', 'Blood transfusion', 'Steroids (antenatal)', 'Other'];
const SEXES = { Girl: 'F', Boy: 'M', Undetermined: 'U' } as const;

/** CT-56/57 Admission & delivery record (PRD F-18) → creates linked baby record(s) (F-19). Values as documented. */
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
  const schema = useMemo(() => makeDeliverySchema(now, p.edd), [now, p.edd]);
  const { control, handleSubmit, setValue } = useZodForm(schema, {
    defaultValues: {
      date: dateText(now),
      time: timeText(now),
      place: 'This facility',
      onset: undefined,
      mode: undefined,
      indication: '',
      loss: '',
      perineum: undefined,
      perineumOther: '',
      complications: [],
      complicationsNote: '',
      medicines: ['Oxytocin'],
      medicinesNote: '',
      maternalCondition: '',
      attendedBy: by,
      count: '1',
      babies: Array.from({ length: MAX_BABIES }, blankBaby),
    },
  });
  const { busy, once } = useSubmitOnce();
  const [admitting, setAdmitting] = useState(false);
  const values = useWatch({ control }) as DeliveryForm;

  const at = birthTime(values.date, values.time);
  const n = Number(values.count);
  const setNow = () => {
    const t = new Date();
    setValue('date', dateText(t), { shouldValidate: true });
    setValue('time', timeText(t), { shouldValidate: true });
  };

  const save = handleSubmit(
    once((input: DeliveryInput) => {
      db.recordDelivery(p.id, input, by);
      router.replace({ pathname: '/care/delivered/[id]', params: { id: p.id } });
    }),
    (errors) => Alert.alert('Check the delivery record', firstError(errors) ?? ''),
  );

  return (
    <Screen blob="none" header={<TopBar back title="Record delivery" />} footer={<Button label="Save delivery" disabled={busy} onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · {!p.edd ? DATING_NOT_RECORDED : at ? `GA at birth ${formatGAWords(gestationalAge(p.edd, at))}` : 'Enter the time of birth'}
        </AppText>
      </View>

      {p.status === 'active' && <Button variant="secondary" label="Admit to the labour room…" onPress={() => setAdmitting(true)} />}
      {p.status === 'admitted' && (
        <AppText variant="caption" tone="secondary">
          Admitted{p.admittedAt ? ` ${fmtDay(p.admittedAt)} ${fmtTime(p.admittedAt)}` : ''}{m.ipNo ? ` · IP ${m.ipNo}` : ''}{p.admissionReason ? ` · ${p.admissionReason}` : ''}
        </AppText>
      )}
      <AdmitSheet pregnancy={p} visible={admitting} onClose={() => setAdmitting(false)} />

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Time and place of birth</AppText>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <Controller control={control} name="date" render={({ field }) => <Field flex label="Date (DD-MM-YYYY)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="numbers-and-punctuation" />} />
          <Controller control={control} name="time" render={({ field }) => <Field flex label="Time (24-hour)" placeholder="HH:MM" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="numbers-and-punctuation" />} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          <Chip label="Set to now" onPress={setNow} />
        </View>
        <Controller control={control} name="place" render={({ field }) => <OptionChips label="Place of birth" options={Object.keys(BIRTH_PLACES)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
        <Controller control={control} name="attendedBy" render={({ field }) => <Field label="Attended by (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Labour and delivery</AppText>
        <Controller control={control} name="onset" render={({ field }) => <OptionChips label="Onset of labour" options={Object.keys(LABOUR_ONSETS)} value={field.value} onChange={field.onChange} />} />
        <Controller control={control} name="mode" render={({ field }) => <OptionChips label="Mode" options={MODES} value={field.value} onChange={field.onChange} />} />
        {(values.mode?.startsWith('LSCS') || values.mode?.startsWith('Assisted')) && (
          <Controller control={control} name="indication" render={({ field }) => <Field label="Indication (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        )}
        <Controller control={control} name="loss" render={({ field }) => <Field label="Estimated blood loss" unit="ml" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        <Controller control={control} name="perineum" render={({ field }) => <OptionChips label="Perineum (as documented)" options={[...PERINEUM]} value={field.value} onChange={field.onChange} />} />
        {values.perineum === 'Other' && (
          <Controller control={control} name="perineumOther" render={({ field }) => <Field label="Perineum (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        )}
        <Controller control={control} name="complications" render={({ field }) => <OptionChips multi label="Complications (documented)" options={COMPLICATIONS} value={field.value} onChange={field.onChange} />} />
        {values.complications?.includes('Other') && (
          <Controller control={control} name="complicationsNote" render={({ field }) => <Field label="Other complication (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        )}
        <Controller control={control} name="medicines" render={({ field }) => <OptionChips multi label="Medicines given" options={MEDICINES} value={field.value} onChange={field.onChange} />} />
        {values.medicines?.includes('Other') && (
          <Controller control={control} name="medicinesNote" render={({ field }) => <Field label="Other medicine (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        )}
        <Controller control={control} name="maternalCondition" render={({ field }) => <Field label="Mother's condition after delivery (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline />} />
        <Controller
          control={control}
          name="count"
          render={({ field }) => <OptionChips label="Number of babies" options={Array.from({ length: MAX_BABIES }, (_, i) => String(i + 1))} value={field.value} onChange={(v) => v && field.onChange(v)} />}
        />
      </Card>

      {values.babies.slice(0, n).map((b, i) => (
        <Card key={i} style={{ gap: space.md }}>
          <AppText variant="title">Baby {i + 1}</AppText>
          <Controller
            control={control}
            name={`babies.${i}.outcome`}
            render={({ field }) => <OptionChips label="Outcome" options={['Liveborn', 'Stillborn']} value={field.value === 'live' ? 'Liveborn' : 'Stillborn'} onChange={(v) => field.onChange(v === 'Stillborn' ? 'stillbirth' : 'live')} />}
          />
          {b.outcome === 'stillbirth' && (
            <Controller
              control={control}
              name={`babies.${i}.stillbirthType`}
              render={({ field }) => (
                <OptionChips label="Stillbirth (as documented)" options={['Fresh', 'Macerated']} value={field.value === 'fresh' ? 'Fresh' : field.value === 'macerated' ? 'Macerated' : undefined} onChange={(v) => field.onChange(v === 'Fresh' ? 'fresh' : v === 'Macerated' ? 'macerated' : undefined)} />
              )}
            />
          )}
          <Controller
            control={control}
            name={`babies.${i}.sex`}
            render={({ field }) => (
              <OptionChips
                label="Sex"
                options={Object.keys(SEXES)}
                value={(Object.keys(SEXES) as (keyof typeof SEXES)[]).find((k) => SEXES[k] === field.value)}
                onChange={(v) => field.onChange(v ? SEXES[v as keyof typeof SEXES] : undefined)}
              />
            )}
          />
          <Controller control={control} name={`babies.${i}.weight`} render={({ field }) => <Field label={b.outcome === 'stillbirth' ? 'Birth weight (if recorded)' : 'Birth weight'} unit="g" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Controller control={control} name={`babies.${i}.length`} render={({ field }) => <Field flex label="Length" unit="cm" keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name={`babies.${i}.head`} render={({ field }) => <Field flex label="Head circ." unit="cm" keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Controller control={control} name={`babies.${i}.apgar1`} render={({ field }) => <Field flex label="Apgar 1 min" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name={`babies.${i}.apgar5`} render={({ field }) => <Field flex label="Apgar 5 min" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          </View>
          <Toggle control={control} name={`babies.${i}.resuscitation`} label="Resuscitation given" />
          <Controller control={control} name={`babies.${i}.defects`} render={({ field }) => <Field label="Birth defects (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          {b.outcome === 'live' && (
            <>
              <Toggle control={control} name={`babies.${i}.breastfed`} label="Breastfed within 1 hour" />
              <Toggle control={control} name={`babies.${i}.vitaminK`} label="Vitamin K given" />
              <Toggle control={control} name={`babies.${i}.birthDoses`} label="Birth doses given (BCG, OPV-0, Hep B)" />
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

type ToggleName = `babies.${number}.${'resuscitation' | 'breastfed' | 'vitaminK' | 'birthDoses'}`;

function Toggle({ control, name, label }: { control: Control<DeliveryForm, unknown, DeliveryInput>; name: ToggleName; label: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
          <AppText variant="bodyMedium" style={{ flex: 1 }}>
            {label}
          </AppText>
          <Switch
            value={!!field.value}
            onValueChange={field.onChange}
            accessibilityLabel={label}
            trackColor={{ true: palette.rose300, false: palette.divider }}
            thumbColor={field.value ? palette.rose500 : palette.white}
          />
        </View>
      )}
    />
  );
}
