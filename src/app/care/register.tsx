import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { addDays, eddFromLmp, formatGA, gestationalAge } from '@domain/gestation';

import { TAGS } from '@/data/catalogue';
import { fmtDay } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Intensity, Pregnancy } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, Field, OptionChips, ProgressBar, Screen, SegmentedPills, TopBar, space } from '@/ui';

/** Parses DD-MM-YYYY or DD/MM/YYYY into a UTC date. */
function parseDate(s: string): Date | undefined {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const LANG = { English: 'en', Kannada: 'kn', Hindi: 'hi' } as const;
const PREV = ['Normal delivery', 'LSCS', 'Stillbirth', 'Miscarriage', 'MTP'];
const CONDITIONS = ['Hypertension', 'Diabetes', 'Heart disease', 'Kidney disease', 'Thyroid disorder', 'Epilepsy', 'Asthma', 'TB'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown'];

/** CT-61…66 Pregnancy registration — creates MCH ID, schedules and tasks (PRD F-11). */
export default function Register() {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [step, setStep] = useState(0);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [village, setVillage] = useState('');
  const [lang, setLang] = useState<string>('Kannada');
  const [ecName, setEcName] = useState('');
  const [ecPhone, setEcPhone] = useState('');

  const [lmpText, setLmpText] = useState('');
  const [scanWeeks, setScanWeeks] = useState('');
  const [eddSource, setEddSource] = useState<Pregnancy['eddSource']>('lmp');
  const [g, setG] = useState('1');
  const [pp, setP] = useState('0');
  const [l, setL] = useState('0');
  const [a, setA] = useState('0');
  const [previous, setPrevious] = useState<string[]>([]);

  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState('');
  const [blood, setBlood] = useState<string>();
  const [tags, setTags] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<Intensity>('routine');

  const lmp = parseDate(lmpText);
  const eddLmp = lmp ? eddFromLmp(lmp) : undefined;
  const scanW = Number(scanWeeks);
  const eddScan = scanWeeks && scanW > 0 && scanW < 42 ? addDays(now, 280 - Math.round(scanW * 7)) : undefined;
  const edd = eddSource === 'scan' ? eddScan : (eddLmp ?? eddScan);

  const gpla = { g: Number(g) || 0, p: Number(pp) || 0, l: Number(l) || 0, a: Number(a) || 0 };
  const gplaError = gpla.p + gpla.a > Math.max(0, gpla.g - 1) ? 'P + A must be ≤ G − 1 for a current pregnancy' : undefined;

  const steps = ['Identity', 'Pregnancy', 'History & tags'];
  const valid = [
    name.trim().length > 1 && Number(age) > 10 && /^[6-9]\d{9}$/.test(phone),
    !!edd && !gplaError,
    true,
  ];

  function create() {
    if (!edd) return;
    const id = db.registerPregnancy(
      {
        mother: {
          name: name.trim(),
          age: Number(age),
          phone,
          village: village.trim() || '—',
          lang: LANG[lang as keyof typeof LANG] ?? 'kn',
          emergencyContact: { name: ecName.trim() || '—', relation: 'Family', phone: ecPhone || '—' },
        },
        lmp,
        edd,
        eddSource: eddSource === 'scan' && eddScan ? 'scan' : 'lmp',
        gpla,
        history: { conditions, allergies: allergies.split(',').map((x) => x.trim()).filter(Boolean), medicines: [], bloodGroup: blood === 'Unknown' ? undefined : blood },
        previous: previous.map((p) => ({ year: now.getFullYear() - 2, outcome: p === 'LSCS' || p === 'Normal delivery' ? 'Live birth' : p, mode: p === 'LSCS' ? 'LSCS' : p === 'Normal delivery' ? 'Normal' : undefined })),
        tagCodes: tags,
        intensity,
      },
      by,
      now,
    );
    const p = db.pregnancies.find((x) => x.id === id) ?? useDb.getState().pregnancies.find((x) => x.id === id);
    Alert.alert('Pregnancy registered', `${p?.mchId}\nANC visits and test windows have been scheduled.`);
    router.replace({ pathname: '/care/p/[id]', params: { id } });
  }

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
            {step < 2 ? <Button label="Next" disabled={!valid[step]} onPress={() => setStep((s) => s + 1)} /> : <Button label="Create & schedule" onPress={create} />}
          </View>
        </View>
      }
    >
      <ProgressBar progress={(step + 1) / 3} leftCaption={`Step ${step + 1} of 3 · ${steps[step]}`} />

      {step === 0 && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">Mother</AppText>
          <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Asha R" />
          <View style={styles.row}>
            <Field flex label="Age" unit="yrs" keyboardType="number-pad" value={age} onChangeText={setAge} />
            <Field flex label="Village / area" value={village} onChangeText={setVillage} />
          </View>
          <Field label="Mobile (used for her login)" keyboardType="number-pad" maxLength={10} value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, ''))} hint="She logs in with this number and an OTP." />
          <OptionChips label="Preferred language" options={Object.keys(LANG)} value={lang} onChange={(v) => v && setLang(v)} />
          <View style={styles.row}>
            <Field flex label="Emergency contact" value={ecName} onChangeText={setEcName} />
            <Field flex label="Their phone" keyboardType="number-pad" maxLength={10} value={ecPhone} onChangeText={(v) => setEcPhone(v.replace(/\D/g, ''))} />
          </View>
        </Card>
      )}

      {step === 1 && (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Dating</AppText>
            <Field label="LMP (DD-MM-YYYY)" value={lmpText} onChangeText={setLmpText} placeholder="07-02-2026" keyboardType="numbers-and-punctuation" error={lmpText && !lmp ? 'Use DD-MM-YYYY' : undefined} />
            <Field label="Or GA by dating scan today" unit="weeks" keyboardType="decimal-pad" value={scanWeeks} onChangeText={setScanWeeks} />
            {(eddLmp || eddScan) && (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="secondary">
                  EDD source — you choose
                </AppText>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {eddLmp && <Chip label={`LMP → ${fmtDay(eddLmp)}`} variant={eddSource === 'lmp' ? 'selected' : 'soft'} onPress={() => setEddSource('lmp')} />}
                  {eddScan && <Chip label={`Scan → ${fmtDay(eddScan)}`} variant={eddSource === 'scan' ? 'selected' : 'soft'} onPress={() => setEddSource('scan')} />}
                </View>
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
              <Field flex label="G" keyboardType="number-pad" value={g} onChangeText={setG} />
              <Field flex label="P" keyboardType="number-pad" value={pp} onChangeText={setP} />
              <Field flex label="L" keyboardType="number-pad" value={l} onChangeText={setL} />
              <Field flex label="A" keyboardType="number-pad" value={a} onChangeText={setA} />
            </View>
            {!!gplaError && (
              <AppText variant="caption" tone="overdue">
                {gplaError}
              </AppText>
            )}
            <OptionChips multi label="Previous pregnancies (documented)" options={PREV} value={previous} onChange={setPrevious} />
          </Card>
        </>
      )}

      {step === 2 && (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">History</AppText>
            <OptionChips multi label="Documented conditions" options={CONDITIONS} value={conditions} onChange={setConditions} />
            <Field label="Allergies (comma separated)" value={allergies} onChangeText={setAllergies} />
            <OptionChips label="Blood group (if known)" options={BLOOD} value={blood} onChange={setBlood} />
          </Card>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Tags (optional)</AppText>
            <AppText variant="caption" tone="secondary">
              Your choice — nothing is pre-selected.
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TAGS.filter((t) => t.group !== 'Newborn').map((t) => {
                const on = tags.includes(t.code);
                return <Chip key={t.code} label={t.label} variant={on ? 'selected' : 'soft'} onPress={() => setTags((c) => (on ? c.filter((x) => x !== t.code) : [...c, t.code]))} />;
              })}
            </View>
            <AppText variant="label" tone="secondary">
              Follow-up intensity
            </AppText>
            <SegmentedPills
              value={intensity}
              onChange={setIntensity}
              options={[
                { value: 'routine', label: 'Routine' },
                { value: 'enhanced', label: 'Enhanced' },
                { value: 'close', label: 'Close' },
              ]}
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
