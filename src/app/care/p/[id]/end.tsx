import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { daysBetween } from '@domain/gestation';

import { END_REASONS, endReasonCodes } from '@/data/codes';
import { fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, DatePicker, Field, GlassSurface, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const OUTCOMES = END_REASONS.map(([, label]) => label);

/**
 * End an ongoing pregnancy with its outcome, or close a delivered episode once postnatal care is done
 * (server `end_pregnancy`). The clinician states the outcome; the app infers nothing. A confirmation step comes
 * first, because closing stops every open visit, test and reminder for this episode.
 */
export default function EndPregnancy() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [outcome, setOutcome] = useState<string>();
  const [on, setOn] = useState(now);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const p = db.pregnancies.find((x) => x.id === id);
  if (!p) return <Screen header={<TopBar back title="End of care" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  const delivered = p.status === 'delivered';
  const reason = delivered ? 'delivered' : outcome && endReasonCodes.code(outcome);
  const future = daysBetween(now, on) > 0;
  const ready = !!reason && !future && p.status !== 'admitted' && p.status !== 'closed';

  function confirm() {
    if (!ready || !reason) return;
    db.endPregnancy(p!.id, reason, note, delivered ? undefined : on, by, now);
    // Closing ends the care assignments: the record leaves the active lists, so return to them.
    router.replace('/care/patients');
  }

  return (
    <Screen blob="none" header={<TopBar back title={delivered ? 'Close this episode' : 'End of pregnancy care'} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">{p.mchId}</AppText>
      </View>

      {p.status === 'closed' && <AppText tone="secondary">This episode is already closed{p.endReason ? ` (${endReasonCodes.label(p.endReason)})` : ''}.</AppText>}

      {p.status === 'admitted' && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">She is admitted</AppText>
          <AppText tone="secondary">End the admission first, then record how this pregnancy ended.</AppText>
          <Button variant="secondary" label="End admission (no delivery)" onPress={() => db.endAdmission(p.id, by, now)} />
        </Card>
      )}

      {delivered ? (
        <Card style={{ gap: space.sm }}>
          <AppText tone="secondary">
            Use this when postnatal care for this episode is complete. Closing ends the care assignments and any open follow-ups and reminders for the mother. The baby’s own record is not affected.
          </AppText>
        </Card>
      ) : (
        p.status === 'active' && (
          <Card style={{ gap: space.md }}>
            <OptionChips label="How the pregnancy ended (as documented)" options={OUTCOMES} value={outcome} onChange={(v) => (setOutcome(v), setConfirming(false))} />
            <AppText variant="label" tone="secondary">Date</AppText>
            <DatePicker value={on} onChange={(d) => (setOn(d), setConfirming(false))} />
            {future && <AppText tone="overdue">The date cannot be in the future.</AppText>}
            <Field label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="Anything the team should know" />
          </Card>
        )
      )}

      {confirming ? (
        <GlassSurface strong radius={20} style={{ padding: space.lg, gap: space.sm, borderWidth: 1.5, borderColor: palette.lav400 }}>
          <AppText variant="headline">Please confirm</AppText>
          <AppText tone="secondary">
            {delivered
              ? `Close the episode for ${m.name}.`
              : `Record that this pregnancy ended on ${fmtDay(on)} · ${outcome}.`}{' '}
            Open visits, due tests and medicine reminders for this episode will stop, and the family stops receiving pregnancy content. This cannot be undone from the app.
          </AppText>
          <Button label="Confirm" onPress={confirm} />
          <Button variant="secondary" label="Go back" onPress={() => setConfirming(false)} />
        </GlassSurface>
      ) : (
        <Button label="Continue" disabled={!ready} onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}
