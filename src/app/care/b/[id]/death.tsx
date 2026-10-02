import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';

import { asBabyId } from '@/data/ids';
import { fmtDay, fmtTime, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Baby } from '@/data/types';
import { makeDeathSchema, whenDefaults } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { WhenFields } from '@/features/care/WhenFields';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

/**
 * Record a baby's death (server `record_baby_death`, paediatric team). Gentle and deliberate: the date and time as
 * documented (never before the time of birth), a confirmation step, then every visit, vaccine reminder and baby
 * message for the family stops.
 */
export default function RecordBabyDeath() {
  const id = asBabyId(useLocalSearchParams<{ id: string }>().id);
  const b = useDb((s) => s.babies.find((x) => x.id === id));
  if (!b) return <Screen header={<TopBar back title="Baby" />}><AppText>Not found.</AppText></Screen>;
  return <DeathForm key={b.id} baby={b} />;
}

function DeathForm({ baby: b }: { baby: Baby }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [confirming, setConfirming] = useState<{ at: Date; note?: string }>();
  const { control, handleSubmit, setValue, formState } = useZodForm(makeDeathSchema(now, b.dob), { defaultValues: { ...whenDefaults(now), note: '' } });
  const { busy, once } = useSubmitOnce();
  const m = motherOf(db, b.motherId);
  const done = !!b.deceasedAt || b.outcome !== 'live';

  const next = handleSubmit(
    (v) => setConfirming(v),
    (errors) => Alert.alert('Check the date and time', firstError(errors) ?? ''),
  );

  return (
    <Screen blob="none" header={<TopBar back title="Record a baby’s death" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{b.childId}</AppText>
        <AppText tone="secondary">
          Baby of {m.name} · born {fmtDay(b.dob)} {fmtTime(b.dob)}
        </AppText>
      </View>

      {done ? (
        <AppText tone="secondary">This has already been recorded.</AppText>
      ) : (
        <>
          {/* While confirming, the form is hidden: "Go back" returns to it, so what is confirmed is what was typed. */}
          {!confirming && (
            <Card style={{ gap: space.md }}>
              <AppText tone="secondary">Recording this stops every planned visit, vaccine reminder and baby message for the family. The baby’s record is kept.</AppText>
              <WhenFields control={control} setValue={setValue} label="Date and time (as documented)" error={formState.errors.time?.message} />
              <Controller control={control} name="note" render={({ field }) => <Field label="Note (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline placeholder="For the care team" />} />
            </Card>
          )}

          {confirming ? (
            <GlassSurface strong radius={20} style={{ padding: space.lg, gap: space.sm, borderWidth: 1.5, borderColor: palette.lav400 }}>
              <AppText variant="headline">Please confirm</AppText>
              <AppText tone="secondary">
                Record the death of {b.childId} on {fmtDay(confirming.at)} at {fmtTime(confirming.at)}. This cannot be undone from the app. Please make sure the family is supported.
              </AppText>
              <Button
                label="Confirm"
                disabled={busy}
                onPress={once(() => {
                  db.recordBabyDeath(b.id, confirming.at, confirming.note, by);
                  router.back();
                })}
              />
              <Button variant="secondary" label="Go back" onPress={() => setConfirming(undefined)} />
            </GlassSurface>
          ) : (
            <Button label="Continue" onPress={next} />
          )}
        </>
      )}
    </Screen>
  );
}
