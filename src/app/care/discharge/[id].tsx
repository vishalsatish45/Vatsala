import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { NOT_DONE_REASONS, TAGS } from '@/data/catalogue';
import { activeTags, fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, ChecklistRow, Chip, ListRow, ProgressBar, Screen, TopBar, space } from '@/ui';

/**
 * CT-95 Discharge checklist (PRD F-21). "Complete" stays disabled until every item is done
 * or marked N/A / deferred WITH a reason. Completion generates the follow-up plan (F-22).
 */
export default function DischargeChecklist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [reasonFor, setReasonFor] = useState<string>();
  const d = db.discharges.find((x) => x.subjectId === id);
  if (!d) return <Screen header={<TopBar back title="Discharge" />}><AppText>No discharge checklist for this record.</AppText></Screen>;

  const baby = d.subject === 'baby' ? db.babies.find((b) => b.id === id) : undefined;
  const p = db.pregnancies.find((x) => x.id === (baby ? baby.pregnancyId : id))!;
  const m = motherOf(db, p.motherId);
  const resolved = d.items.filter((i) => i.state === 'done' || ((i.state === 'na' || i.state === 'deferred') && !!i.reason));
  const ready = resolved.length === d.items.length;
  const templated = activeTags(db, id)
    .map((t) => TAGS.find((x) => x.code === t.code))
    .filter((t) => t?.template);
  const followUps = db.tasks.filter((t) => t.subjectId === id && (t.kind === 'pn_visit' || t.kind === 'nb_visit' || t.kind === 'template'));

  function complete() {
    db.completeDischarge(id, by, now);
    const n = useDb.getState().tasks.filter((t) => t.subjectId === id && (t.kind === 'pn_visit' || t.kind === 'nb_visit' || t.kind === 'template')).length;
    Alert.alert('Discharge complete', `${n} follow-up visit${n === 1 ? '' : 's'} scheduled. The family sees them in their app.`);
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Discharge checklist" />}
      footer={!d.completedAt ? <Button label={ready ? 'Complete discharge' : `Complete discharge (${d.items.length - resolved.length} open)`} disabled={!ready} onPress={complete} /> : undefined}
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{baby ? `Baby ${baby.childId}` : m.name}</AppText>
        <AppText tone="secondary">{baby ? `Baby of ${m.name}` : `${p.mchId} · mother`}</AppText>
      </View>

      <Card>
        <ProgressBar progress={resolved.length / d.items.length} leftCaption={`${resolved.length} of ${d.items.length} resolved`} rightCaption={d.completedAt ? `Completed ${fmtDay(d.completedAt)}` : ready ? 'Ready' : 'Open'} />
      </Card>

      <Card style={{ gap: 2 }}>
        {d.items.map((i) => (
          <ChecklistRow
            key={i.key}
            label={i.label}
            state={i.state === 'deferred' ? 'deferred' : i.state}
            detail={i.state && i.state !== 'done' ? `${i.state === 'na' ? 'N/A' : 'Deferred'}${i.reason ? ` · ${i.reason}` : ' · reason needed'}` : undefined}
            actions={
              d.completedAt ? undefined : (
                <>
                  <Chip label="Done" variant={i.state === 'done' ? 'selected' : 'soft'} onPress={() => db.setDischargeItem(id, i.key, i.state === 'done' ? undefined : 'done', undefined)} />
                  <Chip label="N/A" variant={i.state === 'na' ? 'selected' : 'soft'} onPress={() => { db.setDischargeItem(id, i.key, 'na', undefined); setReasonFor(i.key); }} />
                  <Chip label="Defer" variant={i.state === 'deferred' ? 'selected' : 'soft'} onPress={() => { db.setDischargeItem(id, i.key, 'deferred', undefined); setReasonFor(i.key); }} />
                  {reasonFor === i.key &&
                    (i.state === 'na' || i.state === 'deferred') &&
                    NOT_DONE_REASONS.map((r) => <Chip key={r} label={r} variant={i.reason === r ? 'selected' : 'soft'} onPress={() => { db.setDischargeItem(id, i.key, i.state as 'na' | 'deferred', r); setReasonFor(undefined); }} />)}
                </>
              )
            }
          />
        ))}
      </Card>

      {!d.completedAt && templated.length > 0 && (
        <AppText variant="caption" tone="secondary">
          Tag-linked follow-ups will be added from hospital templates: {templated.map((t) => t!.label).join(', ')}.
        </AppText>
      )}

      {d.completedAt && (
        <View style={{ gap: space.sm }}>
          <AppText variant="title">Follow-up plan</AppText>
          {followUps.map((t) => (
            <ListRow key={t.id} title={t.title} subtitle={`${fmtDay(t.dueFrom ?? t.dueBy)} – ${fmtDay(t.dueBy)}${t.generatedBy === 'template' ? ' · from tag template' : ''}`} />
          ))}
          <Button variant="secondary" label="Back" onPress={() => router.back()} />
        </View>
      )}
    </Screen>
  );
}
