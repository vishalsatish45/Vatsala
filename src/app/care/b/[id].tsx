import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Baby, ClipboardCheck, NotebookPen, Scale, Syringe, Tags, Timer } from 'lucide-react-native';
import { daysBetween, formatGA } from '@domain/gestation';

import { asBabyId } from '@/data/ids';
import { tagLabel } from '@/data/catalogue';
import { activeTags, babyAgeLabel, continuityEvents, fmtDate, fmtDay, motherOf, taskState } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import {
  AppText,
  Button,
  Card,
  Chip,
  ContinuityTimeline,
  GlassSurface,
  InfoRow,
  IntensityPill,
  ListRow,
  PressableScale,
  Screen,
  Section,
  Sheet,
  StatTile,
  StatusBadge,
  TopBar,
  TrendLine,
  UnderlineTabs,
  palette,
  space,
} from '@/ui';

type Tab = 'overview' | 'vaccines' | 'timeline';

/** CT-90 Newborn view with the mother's documented history panel (PRD F-19, F-20). */
export default function NewbornView() {
  const id = asBabyId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [tab, setTab] = useState<Tab>('overview');
  const [dose, setDose] = useState<string>();
  const record = useSubmitOnce(dose);

  const b = db.babies.find((x) => x.id === id);
  if (!b) return <Screen header={<TopBar back title="Newborn" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === b.pregnancyId)!;
  const m = motherOf(db, b.motherId);
  const d = db.deliveries.find((x) => x.pregnancyId === p.id);
  const tags = activeTags(db, b.id);
  const motherTags = activeTags(db, p.id);
  const results = db.investigations.filter((i) => i.subjectId === p.id && i.result && ['bg', 'hiv', 'vdrl', 'hbsag', 'ogtt', 'hb3', 'hb2', 'ict'].includes(i.code));
  const vax = db.immunizations.filter((i) => i.babyId === b.id);
  const groups = [...new Set(vax.map((v) => v.group))];
  const tasks = db.tasks.filter((t) => t.subjectId === b.id && !t.cancelledAt).sort((a, z) => a.dueBy.getTime() - z.dueBy.getTime());
  const discharge = db.discharges.find((x) => x.subjectId === b.id);
  const ageDays = daysBetween(b.dob, now);
  const doseItem = vax.find((v) => v.id === dose);
  const obs = db.newbornObs.filter((o) => o.babyId === b.id).sort((a, z) => z.at.getTime() - a.at.getTime());
  const latest = obs[0];
  const weights = [{ at: b.dob, value: b.birthWeightG }, ...obs.filter((o) => o.weightG).map((o) => ({ at: o.at, value: o.weightG! }))];
  const events = continuityEvents(db, p.id, now, 'care').map((e) => ({ ...e, title: e.kind === 'tag' ? `Tagged: ${tagLabel(e.sub ?? '')}` : e.label, sub: e.kind === 'tag' ? undefined : e.sub, anc: e.kind === 'visit' || e.kind === 'planned_visit' }));

  return (
    <Screen blobCenterY={140} header={<TopBar back title={b.childId} />}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <AppText variant="caption" tone="secondary">
          Baby of {m.name} · {b.sex === 'F' ? 'Girl' : 'Boy'}
        </AppText>
        <AppText variant="hero">{babyAgeLabel(b, now)}</AppText>
        <View style={styles.chips}>
          <Chip label={`Born ${fmtDay(b.dob)}`} variant="glass" />
          <Chip label={`GA at birth ${formatGA({ weeks: Math.floor(b.gaAtBirthDays / 7), days: b.gaAtBirthDays % 7, totalDays: b.gaAtBirthDays })}`} variant="glass" />
        </View>
        <View style={styles.chips}>
          {tags.map((t) => (
            <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
          ))}
          <IntensityPill value={b.intensity} />
          <Chip label="Edit tags" icon={Tags} onPress={() => router.push({ pathname: '/care/p/[id]/tags', params: { id: b.id } })} />
        </View>
      </View>

      {/* Mother's history panel — documented facts only; informs the handoff, prescribes nothing. */}
      <PressableScale onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} accessibilityRole="button" accessibilityLabel="Open mother's record">
        <GlassSurface strong style={styles.panel}>
          <View style={styles.panelHead}>
            <AppText variant="title">Mother’s history</AppText>
            <AppText variant="label" tone="accent">
              {m.name} ›
            </AppText>
          </View>
          <View style={styles.chipsLeft}>
            {motherTags.length === 0 && <AppText tone="secondary">No tags</AppText>}
            {motherTags.map((t) => (
              <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
            ))}
          </View>
          <InfoRow label="Conditions" value={p.history.conditions.join(', ') || 'None documented'} />
          <InfoRow label="Blood group" value={p.history.bloodGroup} />
          {results.map((i) => (
            <InfoRow key={i.id} label={i.label} value={`${i.result!.value} (as entered)`} />
          ))}
          <InfoRow label="Delivery" value={d ? `${d.mode}${d.indication ? ` · ${d.indication}` : ''}` : undefined} />
          <InfoRow label="Medicines in labour" value={d?.medicines.join(', ')} />
          <InfoRow label="Complications" value={d?.complications.join(', ') || 'None documented'} />
          <AppText variant="caption" tone="faint">
            Documented facts from the mother’s record. The app makes no statement about what the baby needs.
          </AppText>
        </GlassSurface>
      </PressableScale>

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'vaccines', label: 'Vaccines' },
          { value: 'timeline', label: 'Timeline' },
        ]}
      />

      {tab === 'overview' && (
        <>
          <View style={styles.tiles}>
            <StatTile icon={Scale} label="Birth weight" value={String(b.birthWeightG)} unit="g" caption={fmtDate(b.dob)} />
            <StatTile icon={Timer} label="Apgar 1 / 5" value={`${b.apgar1 ?? '–'}/${b.apgar5 ?? '–'}`} caption={fmtDate(b.dob)} />
          </View>
          <Button icon={NotebookPen} label="Record observation" onPress={() => router.push({ pathname: '/care/b/[id]/observe', params: { id: b.id } })} />
          {latest && (
            <Card>
              <AppText variant="headline">Latest observation · {fmtDay(latest.at)}</AppText>
              {latest.weightG != null && <InfoRow label="Weight" value={`${latest.weightG} g`} />}
              {latest.tempC != null && <InfoRow label="Temperature" value={`${latest.tempC} °C`} />}
              {latest.respRate != null && <InfoRow label="Respiratory rate" value={`${latest.respRate} /min`} />}
              {latest.feeding && <InfoRow label="Feeding" value={latest.feeding} />}
              {latest.jaundice && <InfoRow label="Jaundice (as recorded)" value={latest.jaundice} />}
              <AppText variant="caption" tone="faint">
                {latest.by}
              </AppText>
            </Card>
          )}
          {weights.length > 1 && (
            <Card style={{ gap: 6 }}>
              <AppText variant="headline">Weight as documented</AppText>
              <TrendLine points={weights} fmt={fmtDate} unit=" g" />
            </Card>
          )}
          <Section title="Follow-up">
            {tasks.length === 0 && <AppText tone="secondary">Follow-up visits are created when discharge is completed.</AppText>}
            {tasks.map((t) => {
              const st = taskState(db, t, now);
              return <ListRow key={t.id} leading={<Baby size={20} color={palette.lav600} />} title={t.title} subtitle={fmtDay(t.dueBy)} meta={<StatusBadge status={st} label={st === 'done' ? 'Done' : st} />} onPress={t.completedAt ? undefined : () => router.push({ pathname: '/care/task/[id]', params: { id: t.id } })} />;
            })}
          </Section>
          <Card>
            <InfoRow label="Discharge" value={discharge?.completedAt ? `Completed ${fmtDay(discharge.completedAt)}` : discharge ? `${discharge.items.filter((i) => !i.state).length} items open` : '—'} />
          </Card>
          {discharge && !discharge.completedAt && <Button icon={ClipboardCheck} label="Discharge checklist" onPress={() => router.push({ pathname: '/care/discharge/[id]', params: { id: b.id } })} />}
        </>
      )}

      {tab === 'vaccines' &&
        groups.map((g) => (
          <Card key={g} style={{ gap: 6 }}>
            <AppText variant="headline">{g}</AppText>
            {vax
              .filter((v) => v.group === g)
              .map((v) => {
                const overdue = !v.givenOn && daysBetween(v.dueOn, now) > 7;
                const due = !v.givenOn && daysBetween(v.dueOn, now) >= 0;
                return (
                  <View key={v.id} style={styles.dose}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyMedium">{v.label}</AppText>
                      <StatusBadge status={v.givenOn ? 'done' : overdue ? 'overdue' : due ? 'due' : 'upcoming'} label={v.givenOn ? `Given ${fmtDate(v.givenOn)}` : `${overdue ? 'Overdue' : due ? 'Due' : 'Due'} ${fmtDate(v.dueOn)}`} />
                    </View>
                    {!v.givenOn && ageDays >= 0 && due && <Chip label="Record" icon={Syringe} onPress={() => setDose(v.id)} />}
                  </View>
                );
              })}
          </Card>
        ))}

      {tab === 'timeline' && (
        <ContinuityTimeline events={events} now={now} fmt={fmtDay} motherLabel="Mother" babyLabel="Baby" todayLabel="Today" />
      )}

      <Sheet visible={!!doseItem} onClose={() => setDose(undefined)} title={`Record ${doseItem?.label ?? ''}`} subtitle="Given today at this facility" footer={<Button label="Record dose" disabled={record.busy} onPress={record.once(() => { if (doseItem) db.recordVaccine(doseItem.id, now, by); setDose(undefined); })} />}>
        <AppText tone="secondary">Due {doseItem ? fmtDay(doseItem.dueOn) : ''}. Recording closes the reminder in the family’s app.</AppText>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  chipsLeft: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  panel: { padding: space.lg, gap: 4 },
  panelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  tiles: { flexDirection: 'row', gap: space.sm },
  dose: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
});
