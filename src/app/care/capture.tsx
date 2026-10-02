import { useState } from 'react';
import { Alert, Image, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { Camera, Check, FileImage, Pencil, ScanText } from 'lucide-react-native';

import { asPregnancyId } from '@/data/ids';
import { gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { CaptureField, Pregnancy, PregnancyId } from '@/data/types';
import { captureSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { pickPhoto } from '@/lib/device';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, GlassSurface, ProgressBar, Screen, TopBar, families, palette, radius, space } from '@/ui';

/** Demo transcription — the LLM vision gateway (ai-gateway) replaces this with the backend. */
function demoTranscribe(): CaptureField[] {
  return [
    { key: 'visit_date', label: 'Visit date', value: 'as on card', confidence: 0.71, confirmed: false },
    { key: 'weight', label: 'Weight', value: '61 kg', confidence: 0.93, confirmed: false },
    { key: 'bp', label: 'BP', value: '128/82', confidence: 0.88, confirmed: false },
    { key: 'albumin', label: 'Urine albumin', value: 'Nil', confidence: 0.79, confirmed: false },
    { key: 'fhr', label: 'FHR', value: '144', confidence: 0.64, confirmed: false },
  ];
}

function SamplePaper() {
  const line = (a: string, b: string) => (
    <View style={styles.paperLine}>
      <AppText variant="caption" style={styles.hand}>
        {a}
      </AppText>
      <AppText variant="bodyMedium" style={styles.hand}>
        {b}
      </AppText>
    </View>
  );
  return (
    <View style={styles.paper}>
      <AppText variant="label" style={styles.hand}>
        MOTHER & CHILD PROTECTION CARD — ANC
      </AppText>
      {line('Wt', '61 kg')}
      {line('BP', '128/82')}
      {line('Urine Alb', 'Nil')}
      {line('FHS', '144/min')}
      <AppText variant="caption" tone="faint">
        (sample card · synthetic)
      </AppText>
    </View>
  );
}

/**
 * CT-74/75 Capture paper record (PRD F-31). AI only TRANSCRIBES visible text into a draft;
 * the clinician confirms each field. Nothing enters the record unconfirmed.
 */
export default function Capture() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const db = useDb();
  const [patientId, setPatientId] = useState<PregnancyId | undefined>(id ? asPregnancyId(id) : undefined);
  const p = db.pregnancies.find((x) => x.id === patientId);

  if (!p) {
    const active = db.pregnancies.filter((x) => x.status === 'active');
    return (
      <Screen blob="none" header={<TopBar back title="Capture paper record" />}>
        <AppText variant="display">Whose record?</AppText>
        {active.map((x) => (
          <Chip key={x.id} label={`${motherOf(db, x.motherId).name} · ${x.mchId}`} onPress={() => setPatientId(x.id)} />
        ))}
      </Screen>
    );
  }

  return <CaptureForm key={p.id} p={p} />;
}

/** The photo (or sample card), its transcribed draft, and the clinician's per-field confirmation. */
function CaptureForm({ p }: { p: Pregnancy }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [uri, setUri] = useState<string>();
  const [sample, setSample] = useState(false);
  const [editing, setEditing] = useState<string>();
  const { control, handleSubmit, reset } = useZodForm(captureSchema, { defaultValues: { fields: [] } });
  const { busy, once } = useSubmitOnce();
  const fields = useWatch({ control, name: 'fields' }) as CaptureField[];
  const confirmed = fields.filter((f) => f.confirmed).length;

  async function shoot(source: 'camera' | 'library') {
    try {
      const u = await pickPhoto(source);
      if (u) {
        setUri(u);
        setSample(false);
        reset({ fields: demoTranscribe() });
      }
    } catch {
      /* alert already shown */
    }
  }

  const save = handleSubmit(
    once((v) => {
      db.saveCapture({ subjectId: p.id, uri, fields: v.fields, at: now, by }, now);
      Alert.alert('Saved', `${confirmed} confirmed field${confirmed === 1 ? '' : 's'} added to ${motherOf(db, p.motherId).name}'s record as a visit (from paper). Unconfirmed fields were discarded.`);
      router.back();
    }),
  );

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Capture paper record" />}
      footer={fields.length ? <Button label={`Save ${confirmed} confirmed field${confirmed === 1 ? '' : 's'}`} disabled={confirmed === 0 || busy} onPress={save} /> : undefined}
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{motherOf(db, p.motherId).name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · {gaLabel(p, now)}
        </AppText>
      </View>

      {!fields.length && (
        <>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button label="Take photo" icon={Camera} onPress={() => shoot('camera')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Gallery" icon={FileImage} onPress={() => shoot('library')} />
            </View>
          </View>
          <Button
            variant="secondary"
            label="Use sample ANC card"
            icon={ScanText}
            onPress={() => {
              setSample(true);
              setUri(undefined);
              reset({ fields: demoTranscribe() });
            }}
          />
          <AppText variant="caption" tone="faint">
            AI copies the visible text into a draft form. It does not interpret values. You confirm every field.
          </AppText>
        </>
      )}

      {fields.length > 0 && (
        <>
          <GlassSurface strong style={{ padding: space.sm }}>{uri ? <Image source={{ uri }} style={styles.photo} resizeMode="cover" /> : sample ? <SamplePaper /> : null}</GlassSurface>
          <Card style={{ gap: space.sm }}>
            <ProgressBar progress={confirmed / fields.length} leftCaption={`${confirmed} of ${fields.length} confirmed`} rightCaption="Transcription · demo" />
            {fields.map((f, i) => (
              <View key={f.key} style={styles.field}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="label" tone="secondary">
                    {f.label} · {Math.round(f.confidence * 100)}% sure
                  </AppText>
                  {editing === f.key ? (
                    <Controller
                      control={control}
                      name={`fields.${i}.value`}
                      render={({ field }) => (
                        <TextInput
                          autoFocus
                          value={field.value}
                          onChangeText={field.onChange}
                          onBlur={() => {
                            field.onBlur();
                            setEditing(undefined);
                          }}
                          style={styles.input}
                        />
                      )}
                    />
                  ) : (
                    <AppText variant="headline">{f.value}</AppText>
                  )}
                </View>
                <Chip label="Edit" icon={Pencil} onPress={() => setEditing(f.key)} />
                <Controller
                  control={control}
                  name={`fields.${i}.confirmed`}
                  render={({ field }) => <Chip label={field.value ? 'Confirmed' : 'Confirm'} icon={Check} variant={field.value ? 'selected' : 'soft'} onPress={() => field.onChange(!field.value)} />}
                />
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 260, borderRadius: radius.md },
  paper: { backgroundColor: '#FFFDF6', borderRadius: radius.md, padding: space.lg, gap: 8, borderWidth: 1, borderColor: '#EFE6CF', transform: [{ rotate: '-1.2deg' }] },
  paperLine: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#E8DEC4', paddingBottom: 4 },
  hand: { color: '#35507A' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: palette.divider },
  input: { fontFamily: families.latin.semibold, fontSize: 17, color: palette.ink, borderBottomWidth: 1.5, borderBottomColor: palette.rose300, paddingVertical: 2 },
});
