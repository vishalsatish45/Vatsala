import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useWatch } from 'react-hook-form';
import { ancVisitDates } from '@domain/schedules';

import { TAGS } from '@/data/catalogue';
import { asSubjectId } from '@/data/ids';
import { activeTags, motherOf } from '@/data/selectors';
import { isOngoing, useDb } from '@/data/store';
import type { SubjectId } from '@/data/types';
import { useCareMe } from '@/features/care/CareTeam';
import { makeTagsSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { canWriteSubject } from '@/features/care/permissions';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, Screen, SegmentedPills, TopBar, space } from '@/ui';

/**
 * CT-27 Tags & follow-up intensity (PRD F-14). Only a clinician sets these; the system
 * never assigns, suggests or pre-ticks a tag. Intensity changes the visit cadence.
 */
export default function TagsScreen() {
  const id = asSubjectId(useLocalSearchParams<{ id: string }>().id);
  return <TagsForm key={id} id={id} />;
}

function TagsForm({ id }: { id: SubjectId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const me = useCareMe();
  const p = db.pregnancies.find((x) => x.id === id);
  const b = db.babies.find((x) => x.id === id);
  const subjectName = p ? motherOf(db, p.motherId).name : b ? `Baby ${b.childId}` : '';
  // The tags active when the screen opened: the form edits these (remounted per record).
  const [current] = useState(() => activeTags(db, id).map((t) => t.code));
  const schema = useMemo(() => makeTagsSchema(current), [current]);
  const { control, handleSubmit } = useZodForm(schema, { defaultValues: { codes: current, intensity: p?.intensity ?? b?.intensity ?? 'routine', note: '' } });
  const { busy, once } = useSubmitOnce();
  const [codes, intensity] = useWatch({ control, name: ['codes', 'intensity'] });

  const groups: readonly ('Newborn' | 'Obstetric' | 'Medical' | 'Social')[] = b ? ['Newborn'] : ['Obstetric', 'Medical', 'Social'];
  const removed = current.filter((c) => !codes.includes(c));
  const intensityChanged = intensity !== (p?.intensity ?? b?.intensity);
  // ANC visits are re-planned only for an ongoing pregnancy (delivered / closed: the intensity is recorded only).
  const replans = !!p && isOngoing(p);
  const preview = p?.edd && replans ? ancVisitDates(p.edd, intensity, now).length : 0;
  // app.require_writer: obstetrician for a pregnancy, paediatrician for a baby.
  const canWrite = canWriteSubject(me, b ? 'baby' : 'pregnancy') && p?.status !== 'closed';

  const save = handleSubmit(
    once((v) => {
      db.setTags(id, { add: v.add, remove: v.remove }, v.note, by, now);
      if (v.intensity !== (p?.intensity ?? b?.intensity)) db.setIntensity(id, v.intensity, by, now);
      router.back();
    }),
    (errors) => Alert.alert('Reason needed', firstError(errors) ?? ''),
  );

  if (!canWrite) {
    return (
      <Screen blob="none" header={<TopBar back title="Tags & follow-up" />}>
        <AppText tone="secondary">{p?.status === 'closed' ? 'This episode is closed.' : b ? 'Only the paediatric team sets a baby’s tags and follow-up.' : 'Only the obstetric team sets a pregnancy’s tags and follow-up.'}</AppText>
      </Screen>
    );
  }

  return (
    <Screen blob="none" header={<TopBar back title="Tags & follow-up" />} footer={<Button label="Save" disabled={busy} onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{subjectName}</AppText>
        <AppText tone="secondary">Tags are documentation labels you choose. They make your judgement visible to the whole team.</AppText>
      </View>

      <Controller
        control={control}
        name="codes"
        render={({ field }) => (
          <>
            {groups.map((g) => (
              <Card key={g} style={{ gap: space.sm }}>
                <AppText variant="headline">{g}</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {TAGS.filter((t) => t.group === g).map((t) => {
                    const on = field.value.includes(t.code);
                    return <Chip key={t.code} label={t.label} variant={on ? 'selected' : 'soft'} onPress={() => field.onChange(on ? field.value.filter((x) => x !== t.code) : [...field.value, t.code])} />;
                  })}
                </View>
              </Card>
            ))}
          </>
        )}
      />

      <Card style={{ gap: space.sm }}>
        <AppText variant="headline">Follow-up intensity</AppText>
        <Controller
          control={control}
          name="intensity"
          render={({ field }) => (
            <SegmentedPills
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'routine', label: 'Routine' },
                { value: 'enhanced', label: 'Enhanced' },
                { value: 'close', label: 'Close' },
              ]}
            />
          )}
        />
        <AppText variant="caption" tone="secondary">
          {intensity === 'close' ? 'Visits every 2 weeks (weekly from 36), missed-visit follow-up after 2 days.' : intensity === 'enhanced' ? 'Visits every 3 weeks (2 from 28, weekly from 36), follow-up after 4 days.' : 'Visits every 4 weeks (2 from 28, weekly from 36), follow-up after 7 days.'}
          {p && intensityChanged ? (replans ? `  ·  ${preview} future visits will be scheduled.` : '  ·  No ANC visits are planned after delivery; this changes how soon a missed follow-up is flagged.') : ''}
        </AppText>
      </Card>

      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <Field label={removed.length ? 'Note (required — tag removed)' : 'Note (optional)'} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Documented in cardiology review" multiline />
        )}
      />
    </Screen>
  );
}
