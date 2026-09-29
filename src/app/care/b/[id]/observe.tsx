import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { babyAgeLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

const num = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : undefined);

/** CT-92 Newborn observation (PRD F-20) — stored exactly as recorded; never interpreted. */
export default function ObserveNewborn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const b = db.babies.find((x) => x.id === id)!;
  const [weight, setWeight] = useState('');
  const [temp, setTemp] = useState('');
  const [rr, setRr] = useState('');
  const [feeding, setFeeding] = useState<string>();
  const [jaundice, setJaundice] = useState<string>();

  const bad = (v: number | undefined, lo: number, hi: number) => (v !== undefined && (v < lo || v > hi) ? 'Check value' : undefined);
  const errors = { weight: bad(num(weight), 300, 8000), temp: bad(num(temp), 30, 43), rr: bad(num(rr), 5, 150) };

  function save() {
    if (Object.values(errors).some(Boolean)) return Alert.alert('Check values', 'Some numbers look impossible — please re-check.');
    if (!weight && !temp && !rr && !feeding && !jaundice) return;
    db.addNewbornObs({ babyId: b.id, at: now, by, weightG: num(weight), tempC: num(temp), respRate: num(rr), feeding, jaundice });
    router.back();
  }

  return (
    <Screen blob="none" header={<TopBar back title="Newborn observation" />} footer={<Button label="Save observation" onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{b.childId}</AppText>
        <AppText tone="secondary">{babyAgeLabel(b, now)}</AppText>
      </View>
      <Card style={{ gap: space.md }}>
        <Field label="Weight" unit="g" keyboardType="number-pad" value={weight} onChangeText={setWeight} error={errors.weight} />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Field flex label="Temperature" unit="°C" keyboardType="decimal-pad" value={temp} onChangeText={setTemp} error={errors.temp} />
          <Field flex label="Respiratory rate" unit="/min" keyboardType="number-pad" value={rr} onChangeText={setRr} error={errors.rr} />
        </View>
        <OptionChips label="Feeding (as observed)" options={['Breastfeeding', 'Formula', 'Mixed', 'Difficulty feeding']} value={feeding} onChange={setFeeding} />
        <OptionChips label="Jaundice assessment (as recorded)" options={['None seen', 'Face', 'Chest', 'Abdomen', 'Palms/soles']} value={jaundice} onChange={setJaundice} />
        <AppText variant="caption" tone="faint">
          Values are stored exactly as entered. The app does not interpret them.
        </AppText>
      </Card>
    </Screen>
  );
}
