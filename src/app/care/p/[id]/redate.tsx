import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatGA, gestationalAge } from '@domain/gestation';

import { eddFor, redateProblem, type RedateInput } from '@/data/payloads';
import { fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, DatePicker, Field, OptionChips, Screen, TopBar, space } from '@/ui';

const METHODS = { 'LMP': 'lmp', 'Scan': 'scan', 'Clinician EDD': 'clinician' } as const;
type MethodLabel = keyof typeof METHODS;
const SOURCE: Record<string, string> = { lmp: 'LMP', scan: 'scan', clinician: 'clinician' };

/**
 * Re-date a pregnancy (PRD F-11): the clinician enters a dating — LMP, a scan (date + gestational age at the scan)
 * or an EDD she decides — and sees both EDDs side by side. The app never picks one. Choosing the new EDD re-plans
 * the future ANC visits from it; the change is version-checked on the server.
 */
export default function Redate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [method, setMethod] = useState<MethodLabel>('Scan');
  const [lmp, setLmp] = useState(now);
  const [scanOn, setScanOn] = useState(now);
  const [gaWeeks, setGaWeeks] = useState('');
  const [gaDays, setGaDays] = useState('0');
  const [edd, setEdd] = useState(now);
  const [note, setNote] = useState('');
  const { busy, once } = useSubmitOnce();

  const p = db.pregnancies.find((x) => x.id === id);
  if (!p) return <Screen header={<TopBar back title="Re-date" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  const ongoing = p.status === 'active' || p.status === 'admitted';

  const m0 = METHODS[method];
  const input: RedateInput =
    m0 === 'lmp'
      ? { method: 'lmp', lmp, note }
      : m0 === 'scan'
        ? { method: 'scan', scanOn, gaAtScanDays: Number(gaWeeks) * 7 + Number(gaDays || 0), note }
        : { method: 'clinician', edd, note };
  const incomplete = m0 === 'scan' && !gaWeeks.trim();
  const problem = incomplete ? undefined : redateProblem(input, now);
  const newEdd = incomplete || problem ? undefined : eddFor(input);
  const openVisits = db.tasks.filter((t) => t.subjectId === p.id && t.kind === 'anc_visit' && !t.completedAt && !t.cancelledAt && t.dueBy.getTime() > now.getTime()).length;

  return (
    <Screen blob="none" header={<TopBar back title="Re-date pregnancy" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">{p.mchId}</AppText>
      </View>
      {!ongoing && <AppText tone="secondary">Only an ongoing pregnancy can be re-dated.</AppText>}

      <Card style={{ gap: space.md }}>
        <OptionChips label="Date by" options={Object.keys(METHODS)} value={method} onChange={(v) => v && setMethod(v as MethodLabel)} />
        {m0 === 'lmp' && (
          <>
            <AppText variant="label" tone="secondary">First day of the last menstrual period</AppText>
            <DatePicker value={lmp} onChange={setLmp} />
          </>
        )}
        {m0 === 'scan' && (
          <>
            <AppText variant="label" tone="secondary">Scan date</AppText>
            <DatePicker value={scanOn} onChange={setScanOn} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Field flex label="GA at scan · weeks" keyboardType="number-pad" value={gaWeeks} onChangeText={setGaWeeks} />
              <Field flex label="+ days" keyboardType="number-pad" value={gaDays} onChangeText={setGaDays} />
            </View>
          </>
        )}
        {m0 === 'clinician' && (
          <>
            <AppText variant="label" tone="secondary">EDD decided by the clinician</AppText>
            <DatePicker value={edd} onChange={setEdd} minDate={now} />
          </>
        )}
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Dating scan report from district hospital" />
        {!!problem && <AppText tone="overdue">{problem}</AppText>}
      </Card>

      <View style={styles.compare}>
        <Card style={styles.col}>
          <AppText variant="label" tone="secondary">Current EDD ({SOURCE[p.eddSource]})</AppText>
          <AppText variant="title">{fmtDay(p.edd)}</AppText>
          <AppText variant="caption" tone="secondary">
            GA today {formatGA(gestationalAge(p.edd, now))}
          </AppText>
        </Card>
        <Card style={styles.col}>
          <AppText variant="label" tone="secondary">New EDD ({SOURCE[m0]})</AppText>
          <AppText variant="title">{newEdd ? fmtDay(newEdd) : '—'}</AppText>
          <AppText variant="caption" tone="secondary">
            {newEdd ? `GA today ${formatGA(gestationalAge(newEdd, now))}` : 'Enter the dating'}
          </AppText>
        </Card>
      </View>
      <AppText variant="caption" tone="faint">
        You choose which EDD the record uses. Choosing the new one re-plans the {openVisits} future ANC visit{openVisits === 1 ? '' : 's'} from it; completed visits and results are kept.
      </AppText>

      <Button
        label="Use the new EDD"
        disabled={!newEdd || !ongoing || busy}
        onPress={() => {
          if (!newEdd || !ongoing) return;
          once(() => {
            db.redatePregnancy(p.id, input, by, now);
            router.back();
          })();
        }}
      />
      <Button variant="secondary" label="Keep the current EDD" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  compare: { flexDirection: 'row', gap: space.sm },
  col: { flex: 1, gap: 4 },
});
