import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { FileSpreadsheet, FileUp } from 'lucide-react-native';

import { importRows, type ImportOutcome } from '@/data/registration';
import { useDb } from '@/data/store';
import { refresh } from '@/data/sync';
import { IMPORT_FIELDS, autoMap, parseCsv, sampleRegisterCsv, validate, type FieldKey, type KnownMother, type Mapping } from '@/features/care/registerImport';
import { useActor } from '@/features/care/nav';
import { pickTextFile } from '@/lib/device';
import { useNow } from '@/lib/clock';
import { isRemote } from '@/lib/supabase';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, ListRow, ProgressBar, Screen, SegmentedPills, StatusBadge, TopBar, space } from '@/ui';

type Step = 'source' | 'mapping' | 'preview' | 'result';

/** CT-70…73 Import a register (PRD F-30): pick CSV → map columns → validate → confirm → what the server did. */
export default function ImportRegister() {
  const role = useSession((s) => s.account?.care?.role);
  if (role !== 'obstetrician') {
    return (
      <Screen header={<TopBar back title="Import register" />}>
        <AppText tone="secondary">The ANC register is imported by an obstetrician of the hospital.</AppText>
      </Screen>
    );
  }
  return <ImportScreen />;
}

function ImportScreen() {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [step, setStep] = useState<Step>('source');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [editing, setEditing] = useState<FieldKey>();
  const [filter, setFilter] = useState<'valid' | 'warning' | 'rejected'>('valid');
  const [outcome, setOutcome] = useState<Extract<ImportOutcome, { ok: true }>>();
  const [sending, setSending] = useState(false);
  const { busy, once } = useSubmitOnce();
  const teams = useSession((s) => s.account?.care?.teams);
  const units = useMemo(() => (teams ?? []).filter((t) => t.kind === 'unit' && t.specialty === 'obstetrics'), [teams]);
  const [teamId, setTeamId] = useState<string | undefined>(units.length === 1 ? units[0]!.id : undefined);

  const headers = table[0] ?? [];
  const rows = useMemo(() => table.slice(1), [table]);
  const known = useMemo<KnownMother[]>(
    () => db.mothers.map((m) => ({ id: m.id, name: m.name, phone: m.phone, activePregnancy: db.pregnancies.some((p) => p.motherId === m.id && (p.status === 'active' || p.status === 'admitted')) })),
    [db.mothers, db.pregnancies],
  );
  const unitIds = useMemo(() => (isRemote || units.length > 1 ? units.map((u) => u.id as string) : undefined), [units]);
  const results = useMemo(() => (step === 'preview' ? validate(rows, mapping, known, now, { units: unitIds, teamId }) : []), [step, rows, mapping, known, now, unitIds, teamId]);
  const count = (s: string) => results.filter((r) => r.status === s).length;
  const importable = results.filter((r) => r.input);
  const label = (index: number) => {
    const r = rows[index];
    return `Row ${index + 2} · ${(r && mapping.name !== undefined ? r[mapping.name] : '') || 'unnamed'}`;
  };

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

  const confirm = once(async () => {
    setSending(true);
    const r = await importRows(importable.map((x) => x.input!), fileName, by, now);
    setSending(false);
    if (!r.ok) return Alert.alert('Not imported', r.message);
    // The server's answer is the truth: created rows (with their MCH ids) and refused rows with the reason.
    setOutcome({ ...r, created: r.created.map((c) => ({ ...c, index: importable[c.index]!.index })), rejected: r.rejected.map((x) => ({ ...x, index: importable[x.index]!.index })) });
    setStep('result');
    if (isRemote) void refresh();
  });

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Import register" />}
      footer={
        step === 'mapping' ? (
          <Button label="Check rows" disabled={IMPORT_FIELDS.some((f) => 'required' in f && f.required && mapping[f.key] === undefined)} onPress={() => setStep('preview')} />
        ) : step === 'preview' ? (
          <Button label={sending ? 'Importing…' : `Import ${importable.length} pregnancies`} disabled={!importable.length || busy || (!!unitIds?.length && !teamId)} onPress={confirm} />
        ) : step === 'result' ? (
          <Button label="Done" onPress={() => router.back()} />
        ) : undefined
      }
    >
      <ProgressBar
        progress={step === 'source' ? 1 / 4 : step === 'mapping' ? 2 / 4 : step === 'preview' ? 3 / 4 : 1}
        leftCaption={step === 'source' ? 'Step 1 · choose file' : step === 'mapping' ? `Step 2 · map columns · ${fileName}` : step === 'preview' ? 'Step 3 · check & confirm' : 'Step 4 · result'}
      />

      {step === 'source' && (
        <>
          <AppText variant="display">Start from your existing register</AppText>
          <AppText tone="secondary">
            Export the ANC register as CSV (Excel → Save as → CSV) with name, age, mobile, LMP and G, P, L, A. Each row becomes a pregnancy with its schedule. Excel files are read by the backend.
          </AppText>
          <Button label="Choose CSV file" icon={FileUp} onPress={pick} />
          <Button variant="secondary" label="Use sample register (10 rows)" icon={FileSpreadsheet} onPress={() => load('sample-register.csv', sampleRegisterCsv(now))} />
        </>
      )}

      {step === 'mapping' && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title">Match columns</AppText>
          <AppText variant="caption" tone="secondary">
            Guessed from the header row. Tap a field to change its column. Fields marked * are required — nothing is filled in for a row.
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
          {units.length > 1 && (
            <Card style={{ gap: space.sm }}>
              <AppText variant="title">Obstetric unit for these pregnancies</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {units.map((u) => (
                  <Chip key={u.id} label={u.name} variant={teamId === u.id ? 'selected' : 'soft'} onPress={() => setTeamId(u.id)} />
                ))}
              </View>
            </Card>
          )}
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

      {step === 'result' && outcome && (
        <>
          <AppText variant="display">
            {outcome.created.length} created{outcome.rejected.length ? ` · ${outcome.rejected.length} not imported` : ''}
          </AppText>
          <AppText tone="secondary">Each created pregnancy has its visit schedule and test windows. Past test windows are listed as &quot;due now&quot; for you to confirm.</AppText>
          {outcome.rejected.length > 0 && (
            <Card style={{ gap: space.sm }}>
              <AppText variant="title">Not imported (the server&apos;s reason)</AppText>
              {outcome.rejected.map((x) => (
                <ListRow key={x.index} title={label(x.index)} meta={<StatusBadge status="overdue" label={x.reason} />} />
              ))}
            </Card>
          )}
          <Card style={{ gap: space.sm }}>
            <AppText variant="title">Created</AppText>
            {outcome.created.map((c) => (
              <ListRow key={c.index} title={label(c.index)} subtitle={c.mchId} />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
