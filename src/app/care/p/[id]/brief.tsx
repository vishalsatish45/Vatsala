import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles } from 'lucide-react-native';

import { motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { buildBrief, type Source } from '@/features/ai/brief';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, GlassSurface, Screen, TopBar, palette, space } from '@/ui';

function openSource(src: Source, pregnancyId: string) {
  switch (src.kind) {
    case 'test':
      return router.push({ pathname: '/care/test/[id]', params: { id: src.id } });
    case 'referral':
      return router.push({ pathname: '/care/referral/[id]', params: { id: src.id } });
    case 'callback':
      return router.push({ pathname: '/care/callback/[id]', params: { id: src.id } });
    case 'task':
      return router.push({ pathname: '/care/task/[id]', params: { id: src.id } });
    default:
      return router.push({ pathname: '/care/p/[id]', params: { id: pregnancyId } });
  }
}

/**
 * CT-28 Consultation brief (PRD F-27). Every sentence cites its source records; nothing is
 * saved until a clinician taps Verify. Never offered on critical-alert screens.
 */
export default function ConsultationBrief() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const brief = useMemo(() => buildBrief(db, p.id, now), [db, p.id, now]);
  const [excluded, setExcluded] = useState<number[]>([]);

  function verify() {
    const text = brief.sentences.filter((_, i) => !excluded.includes(i)).map((s) => s.text).join(' ');
    db.addNote(p.id, `Consultation brief (verified): ${text}`, by, 'ai_verified', now);
    router.back();
  }

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Consultation brief" />}
      footer={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="Discard" onPress={() => router.back()} />
          </View>
          <View style={{ flex: 2 }}>
            <Button label="Verify & save to notes" onPress={verify} />
          </View>
        </View>
      }
    >
      <GlassSurface strong radius={20} style={styles.banner}>
        <Sparkles size={22} color={palette.lav600} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline" style={{ color: palette.lav600 }}>
            AI draft · unverified
          </AppText>
          <AppText variant="caption" tone="secondary">
            Summarises documented facts only — no interpretation or advice. Check each line; tap a source to open it. {brief.engine === 'on-device demo' ? 'Demo: generated on-device; the LLM gateway connects with the backend.' : ''}
          </AppText>
        </View>
      </GlassSurface>

      <AppText variant="display">{m.name}</AppText>

      <Card style={{ gap: space.md }}>
        {brief.sentences.map((s, i) => {
          const off = excluded.includes(i);
          return (
            <View key={i} style={{ gap: 6, opacity: off ? 0.35 : 1 }}>
              <AppText variant="body">{s.text}</AppText>
              <View style={styles.sources}>
                {s.sources.slice(0, 4).map((src) => (
                  <Chip key={src.id + src.label} label={`↗ ${src.label}`} variant="tag" onPress={() => openSource(src, p.id)} />
                ))}
                <Chip label={off ? 'Include' : 'Exclude'} onPress={() => setExcluded((x) => (off ? x.filter((y) => y !== i) : [...x, i]))} />
              </View>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: space.sm, padding: space.md, alignItems: 'flex-start', borderWidth: 1.5, borderColor: palette.lav400 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
