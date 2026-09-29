import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { FileSpreadsheet, FileUp } from 'lucide-react-native';

import { useDb } from '@/data/store';
import { IMPORT_FIELDS, autoMap, parseCsv, sampleRegisterCsv, validate, type FieldKey, type Mapping } from '@/features/care/registerImport';
import { useActor } from '@/features/care/nav';
import { pickTextFile } from '@/lib/device';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, ListRow, ProgressBar, Screen, SegmentedPills, StatusBadge, TopBar, space } from '@/ui';

type Step = 'source' | 'mapping' | 'preview';

/** CT-70…73 Import a register (PRD F-30): pick CSV → map columns → validate → confirm. */
export default function ImportRegister() {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [step, setStep] = useState<Step>('source');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [editing, setEditing] = useState<FieldKey>();
  const [filter, setFilter] = useState<'valid' | 'warning' | 'rejected'>('valid');

  const headers = table[0] ?? [];
  const rows = table.slice(1);
  const phones = useMemo(() => new Set(db.mothers.map((m) => m.phone)), [db.mothers]);
  const results = useMemo(() => (step === 'preview' ? validate(rows, mapping, phones, now) : []), [step, rows, mapping, phones, now]);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const importable = results.filter((r) => r.input);

  function load(name: string, text: string) {
    const t = parseCsv(text);
    if (t.length < 2) return Alert.alert('Empty file', 'The file needs a header row and at least one patient row.');
    setFileName(name);
    setTable(t);
    setMapping(autoMap(t[0]!));
    setStep('mapping');
  }

  async function pick() {
    try {
      const f = await pickTextFile();
      if (f) load(f.name, f.text);
    } catch {
      /* alert already shown */
    }
  }

  function confirm() {
    const ids = db.importRegister(importable.map((r) => r.input!), by, now);
    Alert.alert('Import complete', `${ids.length} pregnancies created with visit schedules and test windows. Past test windows are listed as "due now" for you to confirm.`);
    router.back();
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Import register" />}
      footer={
        step === 'mapping' ? (
          <Button label="Check rows" disabled={IMPORT_FIELDS.some((f) => 'required' in f && f.required && mapping[f.key] === undefined)} onPress={() => setStep('preview')} />
        ) : step === 'preview' ? (
          <Button label={`Import ${importable.length} pregnancies`} disabled={!importable.length} onPress={confirm} />
        ) : undefined
      }
    >
      <ProgressBar progress={step === 'source' ? 1 / 3 : step === 'mapping' ? 2 / 3 : 1} leftCaption={step === 'source' ? 'Step 1 · choose file' : step === 'mapping' ? `Step 2 · map columns · ${fileName}` : 'Step 3 · check & confirm'} />

      {step === 'source' && (
        <>
          <AppText variant="display">Start from your existing register</AppText>
          <AppText tone="secondary">Export the ANC register as CSV (Excel → Save as → CSV). Each row becomes a pregnancy with its schedule. Excel files are read by the backend.</AppText>
          <Button label="Choose CSV file" icon={FileUp} onPress={pick} />
          <Button variant="secondary" label="Use sample register (10 rows)" icon={FileSpreadsheet} onPress={() => load('sample-register.csv', sampleRegisterCsv(now))} />
        </>
      )}

      {step === 'mapping' && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title">Match columns</AppText>
          <AppText variant="caption" tone="secondary">
            Guessed from the header row. Tap a field to change its column.
          </AppText>
          {IMPORT_FIELDS.map((f) => (
            <View key={f.key} style={{ gap: 6 }}>
              <ListRow
                title={`${f.label}${'required' in f && f.required ? ' *' : ''}`}
                subtitle={mapping[f.key] !== undefined ? `← "${headers[mapping[f.key]!]}"  e.g. ${rows[0]?.[mapping[f.key]!] ?? ''}` : 'Not mapped'}
                onPress={() => setEditing(editing === f.key ? undefined : f.key)}
              />
              {editing === f.key && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {headers.map((h, i) => (
                    <Chip key={i} label={h} variant={mapping[f.key] === i ? 'selected' : 'soft'} onPress={() => { setMapping((m) => ({ ...m, [f.key]: i })); setEditing(undefined); }} />
                  ))}
                  <Chip label="(none)" onPress={() => { setMapping((m) => ({ ...m, [f.key]: undefined })); setEditing(undefined); }} />
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {step === 'preview' && (
        <>
          <SegmentedPills
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'valid', label: 'Valid', count: count('valid') },
              { value: 'warning', label: 'Warnings', count: count('warning') },
              { value: 'rejected', label: 'Rejected', count: count('rejected') },
            ]}
          />
          <View style={{ gap: space.sm }}>
            {results
              .filter((r) => r.status === filter)
              .map((r) => (
                <ListRow
                  key={r.index}
                  title={r.cells[mapping.name ?? 0] || `Row ${r.index + 2}`}
                  subtitle={`Row ${r.index + 2} · ${r.cells.join(' · ')}`}
                  meta={<StatusBadge status={r.status === 'valid' ? 'done' : r.status === 'warning' ? 'due' : 'overdue'} label={r.reasons.join(' · ') || 'Ready'} />}
                />
              ))}
          </View>
          <Button variant="secondary" label="Back to mapping" onPress={() => setStep('mapping')} />
        </>
      )}
    </Screen>
  );
}
