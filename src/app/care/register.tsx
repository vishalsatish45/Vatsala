import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { formatGA, gestationalAge } from '@domain/gestation';

import { TAGS } from '@/data/catalogue';
import { fmtDay } from '@/data/selectors';
import { useDb, type RegisterInput } from '@/data/store';
import { LANGUAGES, REGISTER_STEPS, eddOptions, makeRegisterSchema, type RegisterForm } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { isRemote } from '@/lib/supabase';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, OptionChips, ProgressBar, Screen, SegmentedPills, TopBar, space } from '@/ui';

const PREV = ['Normal delivery', 'LSCS', 'Stillbirth', 'Miscarriage', 'MTP'];
const CONDITIONS = ['Hypertension', 'Diabetes', 'Heart disease', 'Kidney disease', 'Thyroid disorder', 'Epilepsy', 'Asthma', 'TB'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown'];

const DEFAULTS: RegisterForm = {
  name: '',
  age: '',
  phone: '',
  village: '',
  lang: 'Kannada',
  ecName: '',
  ecPhone: '',
  lmpText: '',
  scanWeeks: '',
  eddSource: 'lmp',
  g: '1',
  p: '0',
  l: '0',
  a: '0',
  previous: [],
  conditions: [],
  allergies: '',
  blood: undefined,
  tags: [],
  intensity: 'routine',
};

/** CT-61…66 Pregnancy registration — creates MCH ID, schedules and tasks (PRD F-11). */
export default function Register() {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [step, setStep] = useState(0);
  const schema = useMemo(() => makeRegisterSchema(now), [now]);
  const { control, handleSubmit } = useZodForm(schema, { defaultValues: DEFAULTS });
  const { busy, once } = useSubmitOnce();

  const values = useWatch({ control }) as RegisterForm;
  const { lmp, eddLmp, eddScan, edd } = eddOptions(values, now);
  // "Next" is enabled when the fields this step owns have no issue (the schema is the only rulebook).
  const issues = schema.safeParse(values).error?.issues ?? [];
  const issueIn = (fields: readonly string[]) => issues.find((i) => fields.includes(String(i.path[0])));
  const gplaError = issues.find((i) => i.path[0] === 'g')?.message;
  const steps = ['Identity', 'Pregnancy', 'History & tags'];
  const valid = REGISTER_STEPS.map((fields) => !issueIn(fields));

  const create = once((input: RegisterInput) => {
    const id = db.registerPregnancy(input, by, now);
    const p = useDb.getState().pregnancies.find((x) => x.id === id);
    // In Supabase mode the MCH id is assigned by the server and appears on her record once saved.
    Alert.alert('Pregnancy registered', `${isRemote ? 'MCH id is being assigned.' : p?.mchId}\nANC visits and test windows have been scheduled.`);
    router.replace({ pathname: '/care/p/[id]', params: { id } });
  });

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Register pregnancy" />}
      footer={
        <View style={styles.footer}>
          {step > 0 && (
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Back" onPress={() => setStep((s) => s - 1)} />
            </View>
          )}
          <View style={{ flex: 2 }}>
            {step < 2 ? (
              <Button label="Next" disabled={!valid[step]} onPress={() => setStep((s) => s + 1)} />
            ) : (
              <Button label="Create & schedule" disabled={busy} onPress={handleSubmit(create)} />
            )}
          </View>
        </View>
      }
    >
      <ProgressBar progress={(step + 1) / 3} leftCaption={`Step ${step + 1} of 3 · ${steps[step]}`} />

      {step === 0 && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">Mother</AppText>
          <Controller control={control} name="name" render={({ field }) => <Field label="Full name" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Asha R" />} />
          <View style={styles.row}>
            <Controller control={control} name="age" render={({ field }) => <Field flex label="Age" unit="yrs" keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name="village" render={({ field }) => <Field flex label="Village / area" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
          </View>
          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <Field label="Mobile (used for her login)" keyboardType="number-pad" maxLength={10} value={field.value} onChangeText={(v) => field.onChange(v.replace(/\D/g, ''))} onBlur={field.onBlur} hint="She logs in with this number and an OTP." />
            )}
          />
          <Controller control={control} name="lang" render={({ field }) => <OptionChips label="Preferred language" options={Object.keys(LANGUAGES)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
          <View style={styles.row}>
            <Controller control={control} name="ecName" render={({ field }) => <Field flex label="Emergency contact" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller
              control={control}
              name="ecPhone"
              render={({ field }) => <Field flex label="Their phone" keyboardType="number-pad" maxLength={10} value={field.value} onChangeText={(v) => field.onChange(v.replace(/\D/g, ''))} onBlur={field.onBlur} />}
            />
          </View>
        </Card>
      )}

      {step === 1 && (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Dating</AppText>
            <Controller
              control={control}
              name="lmpText"
              render={({ field }) => (
                <Field label="LMP (DD-MM-YYYY)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="07-02-2026" keyboardType="numbers-and-punctuation" error={field.value && !lmp ? 'Use DD-MM-YYYY' : undefined} />
              )}
            />
            <Controller control={control} name="scanWeeks" render={({ field }) => <Field label="Or GA by dating scan today" unit="weeks" keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            {(eddLmp || eddScan) && (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="secondary">
                  EDD source — you choose
                </AppText>
                <Controller
                  control={control}
                  name="eddSource"
                  render={({ field }) => (
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {eddLmp && <Chip label={`LMP → ${fmtDay(eddLmp)}`} variant={field.value === 'lmp' ? 'selected' : 'soft'} onPress={() => field.onChange('lmp')} />}
                      {eddScan && <Chip label={`Scan → ${fmtDay(eddScan)}`} variant={field.value === 'scan' ? 'selected' : 'soft'} onPress={() => field.onChange('scan')} />}
                    </View>
                  )}
                />
                {edd && (
                  <AppText variant="bodyMedium">
                    GA today {formatGA(gestationalAge(edd, now))} · EDD {fmtDay(edd)}
                  </AppText>
                )}
              </View>
            )}
          </Card>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Obstetric summary</AppText>
            <View style={styles.row}>
              {(['g', 'p', 'l', 'a'] as const).map((k) => (
                <Controller key={k} control={control} name={k} render={({ field }) => <Field flex label={k.toUpperCase()} keyboardType="number-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
              ))}
            </View>
            {!!gplaError && (
              <AppText variant="caption" tone="overdue">
                {gplaError}
              </AppText>
            )}
            <Controller control={control} name="previous" render={({ field }) => <OptionChips multi label="Previous pregnancies (documented)" options={PREV} value={field.value} onChange={field.onChange} />} />
          </Card>
        </>
      )}

      {step === 2 && (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">History</AppText>
            <Controller control={control} name="conditions" render={({ field }) => <OptionChips multi label="Documented conditions" options={CONDITIONS} value={field.value} onChange={field.onChange} />} />
            <Controller control={control} name="allergies" render={({ field }) => <Field label="Allergies (comma separated)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name="blood" render={({ field }) => <OptionChips label="Blood group (if known)" options={BLOOD} value={field.value} onChange={field.onChange} />} />
          </Card>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Tags (optional)</AppText>
            <AppText variant="caption" tone="secondary">
              Your choice — nothing is pre-selected.
            </AppText>
            <Controller
              control={control}
              name="tags"
              render={({ field }) => (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TAGS.filter((t) => t.group !== 'Newborn').map((t) => {
                    const on = field.value.includes(t.code);
                    return <Chip key={t.code} label={t.label} variant={on ? 'selected' : 'soft'} onPress={() => field.onChange(on ? field.value.filter((x) => x !== t.code) : [...field.value, t.code])} />;
                  })}
                </View>
              )}
            />
            <AppText variant="label" tone="secondary">
              Follow-up intensity
            </AppText>
            <Controller
              control={control}
              name="intensity"
              render={({ field }) => (
                <SegmentedPills
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'routine', label: 'Routine' },
                    { value: 'enhanced', label: 'Enhanced' },
                    { value: 'close', label: 'Close' },
                  ]}
                />
              )}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  footer: { flexDirection: 'row', gap: space.sm },
});
