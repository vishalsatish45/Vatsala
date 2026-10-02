import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { daysBetween } from '@domain/gestation';

import { fmtDay, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, DatePicker, Field, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

/**
 * Record a baby's death (server `record_baby_death`, paediatric team). Gentle and deliberate: a confirmation step,
 * then every visit, vaccine reminder and baby message for the family stops.
 */
export default function RecordBabyDeath() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [on, setOn] = useState(now);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const b = db.babies.find((x) => x.id === id);
  if (!b) return <Screen header={<TopBar back title="Baby" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, b.motherId);
  const invalid = daysBetween(now, on) > 0 || daysBetween(b.dob, on) < 0;
  const done = !!b.deceasedAt || b.outcome !== 'live';
  // A date in the past keeps the time it was picked at; today means now.
  const at = daysBetween(on, now) === 0 ? now : on;

  return (
    <Screen blob="none" header={<TopBar back title="Record a baby’s death" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{b.childId}</AppText>
        <AppText tone="secondary">Baby of {m.name}</AppText>
      </View>

      {done ? (
        <AppText tone="secondary">This has already been recorded.</AppText>
      ) : (
        <>
          <Card style={{ gap: space.md }}>
            <AppText tone="secondary">Recording this stops every planned visit, vaccine reminder and baby message for the family. The baby’s record is kept.</AppText>
            <AppText variant="label" tone="secondary">Date</AppText>
            <DatePicker value={on} onChange={(d) => (setOn(d), setConfirming(false))} minDate={b.dob} />
            {invalid && <AppText tone="overdue">Choose a date between birth and today.</AppText>}
            <Field label="Note (optional)" value={note} onChangeText={setNote} multiline placeholder="For the care team" />
          </Card>

          {confirming ? (
            <GlassSurface strong radius={20} style={{ padding: space.lg, gap: space.sm, borderWidth: 1.5, borderColor: palette.lav400 }}>
              <AppText variant="headline">Please confirm</AppText>
              <AppText tone="secondary">Record the death of {b.childId} on {fmtDay(at)}. This cannot be undone from the app. Please make sure the family is supported.</AppText>
              <Button
                label="Confirm"
                onPress={() => {
                  db.recordBabyDeath(b.id, at, note, by);
                  router.back();
                }}
              />
              <Button variant="secondary" label="Go back" onPress={() => setConfirming(false)} />
            </GlassSurface>
          ) : (
            <Button label="Continue" disabled={invalid} onPress={() => setConfirming(true)} />
          )}
        </>
      )}
    </Screen>
  );
}
