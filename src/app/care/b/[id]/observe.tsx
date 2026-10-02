import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';

import { asBabyId } from '@/data/ids';
import { babyAgeLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { BabyId } from '@/data/types';
import { observeSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

/** CT-92 Newborn observation (PRD F-20) — stored exactly as recorded; never interpreted. */
export default function ObserveNewborn() {
  const id = asBabyId(useLocalSearchParams<{ id: string }>().id);
  return <ObserveForm key={id} id={id} />;
}

function ObserveForm({ id }: { id: BabyId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const b = db.babies.find((x) => x.id === id)!;
  const { control, handleSubmit } = useZodForm(observeSchema, { defaultValues: { weight: '', temp: '', rr: '', feeding: undefined, jaundice: undefined } });
  const { busy, once } = useSubmitOnce();

  const save = handleSubmit(
    once((obs) => {
      db.addNewbornObs({ babyId: b.id, at: now, by, ...obs });
      router.back();
    }),
    // An impossible number is flagged; an empty form simply is not saved.
    (errors) => (errors.weight || errors.temp || errors.rr) && Alert.alert('Check values', 'Some numbers look impossible — please re-check.'),
  );

  const reading = (name: 'weight' | 'temp' | 'rr', label: string, unit: string, keyboardType: 'number-pad' | 'decimal-pad', flex?: boolean) => (
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
        {reading('weight', 'Weight', 'g', 'number-pad')}
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
        <AppText variant="caption" tone="faint">
          Values are stored exactly as entered. The app does not interpret them.
        </AppText>
      </Card>
    </Screen>
  );
}
