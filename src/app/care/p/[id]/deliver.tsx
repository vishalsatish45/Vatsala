import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { gestationalAge, formatGA } from '@domain/gestation';

import { motherOf } from '@/data/selectors';
import { useDb, type BabyInput } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const MODES = ['Normal vaginal', 'Assisted (vacuum/forceps)', 'LSCS (elective)', 'LSCS (emergency)'];
const COMPLICATIONS = ['PPH', 'Eclampsia', 'Retained placenta', 'Perineal tear', 'Other'];
const MEDICINES = ['Oxytocin', 'MgSO4', 'Antibiotics', 'Blood transfusion', 'Steroids (antenatal)'];
const WHEN = { Now: 0, '1 h ago': 1, '3 h ago': 3, '6 h ago': 6 } as const;

type BabyForm = { sex?: 'F' | 'M'; weight: string; apgar1: string; apgar5: string; outcome: 'live' | 'stillbirth'; birthDoses: boolean };
const blank = (): BabyForm => ({ weight: '', apgar1: '', apgar5: '', outcome: 'live', birthDoses: true });

/** CT-56/57 Admission & delivery record (PRD F-18) → creates linked baby record(s) (F-19). */
export default function RecordDelivery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const [when, setWhen] = useState<keyof typeof WHEN>('Now');
  const [mode, setMode] = useState<string>();
  const [indication, setIndication] = useState('');
  const [loss, setLoss] = useState('');
  const [complications, setComplications] = useState<string[]>([]);
  const [medicines, setMedicines] = useState<string[]>(['Oxytocin']);
  const [count, setCount] = useState('1');
  const [babies, setBabies] = useState<BabyForm[]>([blank(), blank()]);

  const at = new Date(now.getTime() - WHEN[when] * 3_600_000);
  const ga = gestationalAge(p.edd, at);
  const n = Number(count);
  const upd = (i: number, patch: Partial<BabyForm>) => setBabies((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function save() {
    const chosen = babies.slice(0, n);
    if (!mode) return Alert.alert('Mode of delivery', 'Please choose the mode of delivery.');
    const bad = chosen.find((b) => !b.sex || !(Number(b.weight) >= 300 && Number(b.weight) <= 6000));
    if (bad) return Alert.alert('Baby details', 'Each baby needs sex and a birth weight between 300 and 6000 g.');
    const input: BabyInput[] = chosen.map((b) => ({
      sex: b.sex!,
      birthWeightG: Number(b.weight),
      apgar1: b.apgar1 ? Number(b.apgar1) : undefined,
      apgar5: b.apgar5 ? Number(b.apgar5) : undefined,
      outcome: b.outcome,
      birthDoses: b.outcome === 'live' && b.birthDoses,
    }));
    db.recordDelivery(p.id, { at, mode, indication: indication.trim() || undefined, bloodLossMl: loss ? Number(loss) : undefined, complications, medicines, babies: input }, by);
    router.replace({ pathname: '/care/delivered/[id]', params: { id: p.id } });
  }

  return (
    <Screen blob="none" header={<TopBar back title="Record delivery" />} footer={<Button label="Save delivery" onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · GA at delivery {formatGA(ga)} weeks
        </AppText>
      </View>

      {p.status === 'active' && <Button variant="secondary" label="Mark admitted (labour room)" onPress={() => db.admit(p.id, by, now)} />}

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Delivery</AppText>
        <OptionChips label="Time of birth" options={Object.keys(WHEN)} value={when} onChange={(v) => v && setWhen(v as keyof typeof WHEN)} />
        <OptionChips label="Mode" options={MODES} value={mode} onChange={setMode} />
        {mode?.startsWith('LSCS') && <Field label="Indication (as documented)" value={indication} onChangeText={setIndication} />}
        <Field label="Estimated blood loss" unit="ml" keyboardType="number-pad" value={loss} onChangeText={setLoss} />
        <OptionChips multi label="Complications (documented)" options={COMPLICATIONS} value={complications} onChange={setComplications} />
        <OptionChips multi label="Medicines given" options={MEDICINES} value={medicines} onChange={setMedicines} />
        <OptionChips label="Number of babies" options={['1', '2']} value={count} onChange={(v) => v && setCount(v)} />
      </Card>

      {babies.slice(0, n).map((b, i) => (
        <Card key={i} style={{ gap: space.md }}>
          <AppText variant="title">Baby {i + 1}</AppText>
          <OptionChips label="Outcome" options={['Liveborn', 'Stillborn']} value={b.outcome === 'live' ? 'Liveborn' : 'Stillborn'} onChange={(v) => upd(i, { outcome: v === 'Stillborn' ? 'stillbirth' : 'live' })} />
          <OptionChips label="Sex" options={['Girl', 'Boy']} value={b.sex === 'F' ? 'Girl' : b.sex === 'M' ? 'Boy' : undefined} onChange={(v) => upd(i, { sex: v === 'Girl' ? 'F' : v === 'Boy' ? 'M' : undefined })} />
          <Field label="Birth weight" unit="g" keyboardType="number-pad" value={b.weight} onChangeText={(v) => upd(i, { weight: v })} />
          {b.outcome === 'live' && (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Field flex label="Apgar 1 min" keyboardType="number-pad" value={b.apgar1} onChangeText={(v) => upd(i, { apgar1: v })} />
                <Field flex label="Apgar 5 min" keyboardType="number-pad" value={b.apgar5} onChangeText={(v) => upd(i, { apgar5: v })} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="bodyMedium">Birth doses given (BCG, OPV-0, Hep B)</AppText>
                <Switch value={b.birthDoses} onValueChange={(v) => upd(i, { birthDoses: v })} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={b.birthDoses ? palette.rose500 : palette.white} />
              </View>
            </>
          )}
        </Card>
      ))}
      <AppText variant="caption" tone="faint">
        Saving creates each baby's record ({p.mchId}-B1…), links it to the mother, generates the vaccine schedule and opens the discharge checklists.
      </AppText>
    </Screen>
  );
}
