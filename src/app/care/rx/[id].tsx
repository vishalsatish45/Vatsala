import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { SLOTS, prescriptionProblem, type PrescriptionInput } from '@/data/payloads';
import { motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { DoseSlot } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { slotsLabel } from '@/features/care/PrescriptionsCard';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

const SLOT_OPTIONS = SLOTS.map((s) => slotsLabel([s]));

/**
 * Prescribe (PRD F-21): the clinician types the medicine, dose and instructions exactly as prescribed and picks the
 * times of day. The app never suggests a medicine, dose or schedule. Obstetrician for a pregnancy, paediatrician
 * for a baby — the server enforces who may write.
 */
export default function Prescribe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [instructions, setInstructions] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const preg = db.pregnancies.find((p) => p.id === id);
  const baby = db.babies.find((b) => b.id === id);
  if (!preg && !baby) return <Screen header={<TopBar back title="Prescribe" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, (preg ?? baby)!.motherId);

  function save() {
    const input: PrescriptionInput = {
      name,
      dose,
      instructions,
      slots: SLOTS.filter((s) => slots.includes(slotsLabel([s]))) as DoseSlot[],
    };
    const problem = prescriptionProblem(input);
    if (problem) return setError(problem);
    db.prescribe(baby ? { babyId: baby.id } : { pregnancyId: preg!.id }, input, by, now);
    router.back();
  }

  return (
    <Screen blob="none" header={<TopBar back title="Prescribe" />} footer={<Button label="Save prescription" onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{baby ? baby.childId : m.name}</AppText>
        <AppText tone="secondary">{baby ? `Baby of ${m.name}` : preg!.mchId}</AppText>
      </View>
      <Card style={{ gap: space.md }}>
        <Field label="Medicine (as prescribed)" value={name} onChangeText={(v) => (setName(v), setError(undefined))} placeholder="Type the medicine name" autoCapitalize="words" />
        <Field label="Dose (optional)" value={dose} onChangeText={setDose} placeholder="As prescribed" />
        <OptionChips multi label="Times of day" options={SLOT_OPTIONS} value={slots} onChange={(v) => (setSlots(v), setError(undefined))} />
        <Field label="Instructions (optional)" value={instructions} onChangeText={setInstructions} multiline placeholder="As prescribed" />
        {!!error && <AppText tone="overdue">{error}</AppText>}
      </Card>
      <AppText variant="caption" tone="faint">
        The family sees this medicine with reminders at the chosen times of day. The app does not suggest medicines or doses.
      </AppText>
    </Screen>
  );
}
