import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ancVisitDates } from '@domain/schedules';

import { TAGS } from '@/data/catalogue';
import { activeTags, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Intensity } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, Field, Screen, SegmentedPills, TopBar, space } from '@/ui';

/**
 * CT-27 Tags & follow-up intensity (PRD F-14). Only a clinician sets these; the system
 * never assigns, suggests or pre-ticks a tag. Intensity changes the visit cadence.
 */
export default function TagsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id);
  const b = db.babies.find((x) => x.id === id);
  const subjectName = p ? motherOf(db, p.motherId).name : b ? `Baby ${b.childId}` : '';
  const current = activeTags(db, id).map((t) => t.code);
  const [codes, setCodes] = useState<string[]>(current);
  const [intensity, setIntensity] = useState<Intensity>(p?.intensity ?? b?.intensity ?? 'routine');
  const [note, setNote] = useState('');

  const groups: readonly ('Newborn' | 'Obstetric' | 'Medical' | 'Social')[] = b ? ['Newborn'] : ['Obstetric', 'Medical', 'Social'];
  const removed = current.filter((c) => !codes.includes(c));
  const intensityChanged = intensity !== (p?.intensity ?? b?.intensity);
  const preview = p ? ancVisitDates(p.edd, intensity, now).length : 0;

  function save() {
    if (removed.length && !note.trim()) return Alert.alert('Reason needed', 'Please add a note explaining why a tag was removed.');
    db.setTags(id, codes, note.trim() || undefined, by, now);
    if (intensityChanged) db.setIntensity(id, intensity, by, now);
    router.back();
  }

  return (
    <Screen blob="none" header={<TopBar back title="Tags & follow-up" />} footer={<Button label="Save" onPress={save} />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{subjectName}</AppText>
        <AppText tone="secondary">Tags are documentation labels you choose. They make your judgement visible to the whole team.</AppText>
      </View>

      {groups.map((g) => (
        <Card key={g} style={{ gap: space.sm }}>
          <AppText variant="headline">{g}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TAGS.filter((t) => t.group === g).map((t) => {
              const on = codes.includes(t.code);
              return <Chip key={t.code} label={t.label} variant={on ? 'selected' : 'soft'} onPress={() => setCodes((c) => (on ? c.filter((x) => x !== t.code) : [...c, t.code]))} />;
            })}
          </View>
        </Card>
      ))}

      <Card style={{ gap: space.sm }}>
        <AppText variant="headline">Follow-up intensity</AppText>
        <SegmentedPills
          value={intensity}
          onChange={setIntensity}
          options={[
            { value: 'routine', label: 'Routine' },
            { value: 'enhanced', label: 'Enhanced' },
            { value: 'close', label: 'Close' },
          ]}
        />
        <AppText variant="caption" tone="secondary">
          {intensity === 'close' ? 'Visits every 2 weeks (weekly from 36), missed-visit follow-up after 2 days.' : intensity === 'enhanced' ? 'Visits every 3 weeks (2 from 28, weekly from 36), follow-up after 4 days.' : 'Visits every 4 weeks (2 from 28, weekly from 36), follow-up after 7 days.'}
          {p && intensityChanged ? `  ·  ${preview} future visits will be scheduled.` : ''}
        </AppText>
      </Card>

      <Field label={removed.length ? 'Note (required — tag removed)' : 'Note (optional)'} value={note} onChangeText={setNote} placeholder="e.g. Documented in cardiology review" multiline />
    </Screen>
  );
}
