import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';

import { asBabyId } from '@/data/ids';
import { babyAgeLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Baby } from '@/data/types';
import { NOTHING_RECORDED, makeObserveSchema, whenDefaults, type ObserveForm } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { WhenFields } from '@/features/care/WhenFields';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

/** CT-92 Newborn observation (PRD F-20) — at its documented time, stored exactly as recorded; never interpreted. */
export default function ObserveNewborn() {
  const id = asBabyId(useLocalSearchParams<{ id: string }>().id);
  const b = useDb((s) => s.babies.find((x) => x.id === id));
  if (!b) return <Screen header={<TopBar back title="Newborn observation" />}><AppText>Not found.</AppText></Screen>;
  return <ObserveFormScreen key={b.id} baby={b} />;
}

type NumberName = 'weight' | 'length' | 'head' | 'temp' | 'rr';

function ObserveFormScreen({ baby: b }: { baby: Baby }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit, setValue, formState } = useZodForm(makeObserveSchema(now, b.dob), {
    defaultValues: { ...whenDefaults(now), weight: '', length: '', head: '', temp: '', rr: '', feeding: undefined, jaundice: undefined, note: '' } satisfies ObserveForm,
  });
  const { busy, once } = useSubmitOnce();

  const save = handleSubmit(
    once(({ at, ...obs }) => {
      db.addNewbornObs({ babyId: b.id, at, by, ...obs });
      router.back();
    }),
    // An impossible number or time is flagged; an empty form simply is not saved.
    (errors) => {
      const msg = firstError(errors);
      if (msg && msg !== NOTHING_RECORDED) Alert.alert('Check values', msg);
    },
  );

  const reading = (name: NumberName, label: string, unit: string, keyboardType: 'number-pad' | 'decimal-pad', flex?: boolean) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => <Field flex={flex} label={label} unit={unit} keyboardType={keyboardType} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />}
    />
  );

  return (
    <Screen blob="none" header={<TopBar back title="Newborn observation" />} footer={<Button label="Save observation" disabled={busy} onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{b.childId}</AppText>
        <AppText tone="secondary">{babyAgeLabel(b, now)}</AppText>
      </View>
      <Card style={{ gap: space.md }}>
        <WhenFields control={control} setValue={setValue} label="Time of observation" error={formState.errors.time?.message} />
        {reading('weight', 'Weight', 'g', 'number-pad')}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {reading('length', 'Length', 'cm', 'decimal-pad', true)}
          {reading('head', 'Head circumference', 'cm', 'decimal-pad', true)}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {reading('temp', 'Temperature', '°C', 'decimal-pad', true)}
          {reading('rr', 'Respiratory rate', '/min', 'number-pad', true)}
        </View>
        <Controller
          control={control}
          name="feeding"
          render={({ field }) => <OptionChips label="Feeding (as observed)" options={['Breastfeeding', 'Formula', 'Mixed', 'Difficulty feeding']} value={field.value} onChange={field.onChange} />}
        />
        <Controller
          control={control}
          name="jaundice"
          render={({ field }) => <OptionChips label="Jaundice assessment (as recorded)" options={['None seen', 'Face', 'Chest', 'Abdomen', 'Palms/soles']} value={field.value} onChange={field.onChange} />}
        />
        <Controller control={control} name="note" render={({ field }) => <Field label="Note (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline />} />
        <AppText variant="caption" tone="faint">
          Values are stored exactly as entered. The app does not interpret them.
        </AppText>
      </Card>
    </Screen>
  );
}
