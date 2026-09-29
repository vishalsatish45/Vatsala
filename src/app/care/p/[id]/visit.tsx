import { useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { addDays, gestationalAge } from '@domain/gestation';
import { ancIntervalWeeks, completeness, expectedComponents, type ComponentState } from '@domain/schedules';

import { COMPLAINTS, NOT_DONE_REASONS } from '@/data/catalogue';
import { fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { ChecklistState } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, ChecklistRow, Chip, Field, OptionChips, ProgressBar, Screen, Sheet, TopBar, palette, space } from '@/ui';

const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
const range = (v: number | undefined, lo: number, hi: number) => (v === undefined || (v >= lo && v <= hi) ? undefined : 'Check value');

/** CT-30 Record ANC visit with the completeness checklist (PRD F-13). Values are stored as entered — never interpreted. */
export default function RecordVisit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const ga = gestationalAge(p.edd, now);

  const [weight, setWeight] = useState('');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [fundal, setFundal] = useState('');
  const [fhr, setFhr] = useState('');
  const [albumin, setAlbumin] = useState<string>();
  const [sugar, setSugar] = useState<string>();
  const [oedema, setOedema] = useState<string>();
  const [presentation, setPresentation] = useState<string>();
  const [movements, setMovements] = useState<string>();
  const [ifa, setIfa] = useState(false);
  const [counselling, setCounselling] = useState<string[]>([]);
  const [complaints, setComplaints] = useState<string[]>([]);
  const defaultWeeks = ancIntervalWeeks(p.intensity, ga.weeks);
  const [nextWeeks, setNextWeeks] = useState(String(defaultWeeks));
  const [gaps, setGaps] = useState<Record<string, { state: ChecklistState; reason?: string }>>({});
  const [review, setReview] = useState(false);

  const recorded: Record<string, ComponentState | undefined> = {
    bp: sys && dia ? 'done' : undefined,
    weight: weight ? 'done' : undefined,
    urine_albumin: albumin ? 'done' : undefined,
    fundal_height: fundal ? 'done' : undefined,
    fhr: fhr ? 'done' : undefined,
    fetal_movements: movements ? 'done' : undefined,
    presentation: presentation ? 'done' : undefined,
    ifa: ifa ? 'done' : undefined,
    counselling: counselling.length ? 'done' : undefined,
    next_visit: 'done',
  };
  const merged = Object.fromEntries(expectedComponents(ga.weeks).map((c) => [c.key, recorded[c.key] ?? gaps[c.key]?.state]));
  const comp = completeness(ga.weeks, merged);
  const nextOn = addDays(now, Number(nextWeeks) * 7);

  const errors = {
    weight: range(num(weight), 25, 200),
    sys: range(num(sys), 60, 250),
    dia: range(num(dia), 30, 160),
    fhr: range(num(fhr), 60, 220),
  };
  const hasErrors = Object.values(errors).some(Boolean);

  function save() {
    const checklist = Object.fromEntries(
      expectedComponents(ga.weeks).map((c) => [c.key, recorded[c.key] === 'done' ? { state: 'done' as const } : (gaps[c.key] ?? { state: 'not_done' as const, reason: 'Not recorded' })]),
    );
    db.recordVisit(
      p.id,
      {
        vitals: {
          weightKg: num(weight),
          bpSys: num(sys),
          bpDia: num(dia),
          pulse: num(pulse),
          fundalHeightCm: num(fundal),
          fhr: num(fhr),
          presentation,
          urineAlbumin: albumin,
          urineSugar: sugar,
          oedema,
        },
        checklist,
        complaints,
        nextVisitOn: nextOn,
      },
      by,
      now,
    );
    setReview(false);
    Alert.alert('Visit saved', `${comp.done}/${comp.expected} components recorded · next visit ${fmtDay(nextOn)}`);
    router.back();
  }

  function trySave() {
    if (hasErrors) return Alert.alert('Check values', 'Some numbers look impossible — please re-check the highlighted fields.');
    if (comp.missing.length) setReview(true);
    else save();
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Record visit" />}
      footer={<Button label={`Save visit · ${comp.done}/${comp.expected}`} onPress={trySave} />}
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · {ga.weeks}+{ga.days} wks · {fmtDay(now)}
        </AppText>
      </View>

      <Card style={{ gap: space.xs }}>
        <ProgressBar progress={comp.expected ? comp.done / comp.expected : 1} label="Visit completeness" leftCaption={`${comp.done} of ${comp.expected} expected components`} rightCaption={comp.missing.length ? `${comp.missing.length} open` : 'Complete'} />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Vitals</AppText>
        <View style={styles.row}>
          <Field flex label="Weight" unit="kg" keyboardType="decimal-pad" value={weight} onChangeText={setWeight} error={errors.weight} />
          <Field flex label="Pulse" unit="/min" keyboardType="number-pad" value={pulse} onChangeText={setPulse} />
        </View>
        <View style={styles.row}>
          <Field flex label="BP systolic" unit="mmHg" keyboardType="number-pad" value={sys} onChangeText={setSys} error={errors.sys} />
          <Field flex label="BP diastolic" unit="mmHg" keyboardType="number-pad" value={dia} onChangeText={setDia} error={errors.dia} />
        </View>
        {ga.weeks >= 20 && (
          <View style={styles.row}>
            <Field flex label="Fundal height" unit="cm" keyboardType="number-pad" value={fundal} onChangeText={setFundal} />
            <Field flex label="Fetal heart rate" unit="bpm" keyboardType="number-pad" value={fhr} onChangeText={setFhr} error={errors.fhr} />
          </View>
        )}
        <AppText variant="caption" tone="faint">
          Values are stored exactly as entered. The app does not interpret them.
        </AppText>
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Examination</AppText>
        <OptionChips label="Urine albumin" options={['Nil', 'Trace', '1+', '2+', '3+']} value={albumin} onChange={setAlbumin} />
        <OptionChips label="Urine sugar" options={['Nil', 'Trace', '1+', '2+', '3+']} value={sugar} onChange={setSugar} />
        <OptionChips label="Oedema" options={['None', 'Pedal', 'Generalised']} value={oedema} onChange={setOedema} />
        {ga.weeks >= 28 && <OptionChips label="Fetal movements (as reported)" options={['Normal', 'Reduced', 'Not asked']} value={movements} onChange={(v) => setMovements(v === 'Not asked' ? undefined : v)} />}
        {ga.weeks >= 32 && <OptionChips label="Presentation" options={['Cephalic', 'Breech', 'Transverse', 'Unsure']} value={presentation} onChange={setPresentation} />}
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Care given</AppText>
        <View style={styles.switchRow}>
          <AppText variant="bodyMedium">IFA / calcium dispensed</AppText>
          <Switch value={ifa} onValueChange={setIfa} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={ifa ? palette.rose500 : palette.white} />
        </View>
        <OptionChips multi label="Counselling given" options={['Nutrition', 'Warning signs', 'Birth preparedness', 'Breastfeeding', 'Family planning']} value={counselling} onChange={setCounselling} />
        <OptionChips multi label="Complaints (as reported)" options={COMPLAINTS} value={complaints} onChange={setComplaints} variant="soft" />
      </Card>

      <Card style={{ gap: space.sm }}>
        <AppText variant="title">Next visit</AppText>
        <OptionChips label={`Suggested by ${p.intensity} schedule: ${defaultWeeks} wk`} options={['1', '2', '3', '4']} value={nextWeeks} onChange={(v) => v && setNextWeeks(v)} />
        <AppText variant="bodyMedium">
          In {nextWeeks} week{nextWeeks === '1' ? '' : 's'} · {fmtDay(nextOn)}
        </AppText>
      </Card>

      <Sheet
        visible={review}
        onClose={() => setReview(false)}
        title="Before you save"
        subtitle="These expected components weren't recorded. Record them, or mark each one."
        footer={<Button label={comp.missing.length ? `Save anyway (${comp.missing.length} unmarked)` : 'Save visit'} onPress={save} />}
      >
        {expectedComponents(ga.weeks)
          .filter((c) => recorded[c.key] !== 'done')
          .map((c) => (
            <ChecklistRow
              key={c.key}
              label={c.label}
              state={gaps[c.key]?.state}
              detail={gaps[c.key]?.reason}
              actions={
                <>
                  <Chip label="Record now" onPress={() => setReview(false)} />
                  <Chip label="N/A" variant={gaps[c.key]?.state === 'na' ? 'selected' : 'soft'} onPress={() => setGaps((g) => ({ ...g, [c.key]: { state: 'na' } }))} />
                  {NOT_DONE_REASONS.slice(0, 3).map((r) => (
                    <Chip key={r} label={r} variant={gaps[c.key]?.reason === r ? 'selected' : 'soft'} onPress={() => setGaps((g) => ({ ...g, [c.key]: { state: 'not_done', reason: r } }))} />
                  ))}
                </>
              }
            />
          ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
