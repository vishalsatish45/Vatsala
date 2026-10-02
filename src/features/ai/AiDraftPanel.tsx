import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Sparkles } from 'lucide-react-native';

import { tagLabel } from '@/data/catalogue';
import { fmtDate } from '@/data/selectors';
import { refresh } from '@/data/sync';
import type { DbState } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Button, Chip, GlassSurface, palette, space } from '@/ui';

import { AiError, requestBrief, verifyDraft, type AiSubject, type Draft, type DraftKind, type DraftSentence } from './remote';

type Src = DraftSentence['sources'][number];

const KIND_TITLE: Record<DraftKind, string> = { brief: 'Consultation brief', handoff: 'Handoff summary', discharge: 'Discharge summary' };

/** A short chip label for a cited record, from what this clinician's app already holds. */
function sourceLabel(db: DbState, s: Src): string {
  switch (s.kind) {
    case 'visit': {
      const v = db.visits.find((x) => x.id === s.id);
      return v ? `Visit ${fmtDate(v.at)}` : 'Visit';
    }
    case 'test':
      return db.investigations.find((x) => x.id === s.id)?.label ?? 'Test';
    case 'referral':
      return db.referrals.find((x) => x.id === s.id)?.department ?? 'Referral';
    case 'tag': {
      const t = db.tags.find((x) => x.id === s.id);
      return t ? tagLabel(t.code) : 'Tag';
    }
    case 'task':
      return db.tasks.find((x) => x.id === s.id)?.title ?? 'Scheduled';
    case 'callback': {
      const c = db.callbacks.find((x) => x.id === s.id);
      return c ? `Call-back ${fmtDate(c.at)}` : 'Call-back';
    }
    case 'selflog':
      return 'Home reading';
    case 'registration':
      return 'Registration';
    default:
      return s.kind.charAt(0).toUpperCase() + s.kind.slice(1);
  }
}

function openSource(s: Src): (() => void) | undefined {
  switch (s.kind) {
    case 'test':
      return () => router.push({ pathname: '/care/test/[id]', params: { id: s.id } });
    case 'referral':
      return () => router.push({ pathname: '/care/referral/[id]', params: { id: s.id } });
    case 'callback':
      return () => router.push({ pathname: '/care/callback/[id]', params: { id: s.id } });
    case 'task':
      return () => router.push({ pathname: '/care/task/[id]', params: { id: s.id } });
    default:
      return undefined;
  }
}

/**
 * CT-28 server AI draft (PRD F-27), Supabase mode. Drafted by the `ai-brief` Edge Function from the de-identified
 * record; every sentence shows the records it cites. "AI draft · unverified" until the clinician verifies — only
 * then is it saved, as an 'ai_verified' note. Tap a sentence to leave it out of the note.
 */
export function AiDraftPanel({ db, subject, kind }: { db: DbState; subject: AiSubject; kind: DraftKind }) {
  const now = useNow();
  const [draft, setDraft] = useState<Draft>();
  const [dropped, setDropped] = useState(0);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [busy, setBusy] = useState<'draft' | 'verify' | 'discard'>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  // One idempotency key per draft decision, so a retried tap is applied once.
  const [decisionKey, setDecisionKey] = useState(randomUUID);

  async function generate() {
    if (busy) return;
    setBusy('draft');
    setError(undefined);
    setSaved(false);
    try {
      const res = await requestBrief(subject, kind, now);
      setDraft(res.draft);
      setDropped(res.dropped);
      setExcluded([]);
      setDecisionKey(randomUUID());
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'The AI draft could not be made. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  async function decide(discard: boolean) {
    if (!draft || busy) return;
    setBusy(discard ? 'discard' : 'verify');
    setError(undefined);
    try {
      await verifyDraft(draft.id, { discard, exclude: excluded, idempotencyKey: decisionKey, at: now });
      setDraft(undefined);
      setSaved(!discard);
      if (!discard) void refresh();
    } catch (e) {
      const msg = e instanceof AiError ? e.message : 'Could not save. Try again.';
      setError(msg);
      if (!(e instanceof AiError)) Alert.alert('Not saved', msg);
    } finally {
      setBusy(undefined);
    }
  }

  const toggle = (i: number) => setExcluded((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]));
  const kept = draft ? draft.content.length - excluded.length : 0;

  return (
    <GlassSurface strong radius={20} style={styles.panel}>
      <View style={styles.head}>
        <Sparkles size={20} color={palette.lav600} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline" style={{ color: palette.lav600 }}>
            {draft ? 'AI draft · unverified' : `AI ${KIND_TITLE[kind].toLowerCase()}`}
          </AppText>
          <AppText variant="caption" tone="secondary">
            Summarises documented facts only, from a de-identified copy of the record. No interpretation or advice. Check each line; tap a source to open it, tap a line to leave it out.
          </AppText>
        </View>
      </View>

      {!draft && (
        <Button
          variant="secondary"
          label={saved ? 'Saved to notes · draft another' : `Draft ${KIND_TITLE[kind].toLowerCase()}`}
          loading={busy === 'draft'}
          disabled={!!busy}
          onPress={generate}
        />
      )}

      {draft && (
        <>
          {draft.content.map((s, i) => {
            const out = excluded.includes(i);
            return (
              <View key={i} style={[styles.sentence, out && styles.excluded]}>
                <Pressable onPress={() => toggle(i)} accessibilityRole="checkbox" accessibilityState={{ checked: !out }}>
                  <AppText style={out ? styles.struck : undefined}>{s.text}</AppText>
                </Pressable>
                <View style={styles.chips}>
                  {s.sources.map((src) => (
                    <Chip key={`${src.kind}:${src.id}`} label={sourceLabel(db, src)} variant="glass" onPress={openSource(src)} />
                  ))}
                </View>
              </View>
            );
          })}
          <AppText variant="caption" tone="faint">
            {`${draft.model} · ${fmtDate(new Date(draft.generated_at))}${dropped ? ` · ${dropped} uncited line${dropped === 1 ? '' : 's'} removed` : ''}`}
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Discard" loading={busy === 'discard'} disabled={!!busy} onPress={() => decide(true)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button label="Verify & save as note" loading={busy === 'verify'} disabled={!!busy || kept === 0} onPress={() => decide(false)} />
            </View>
          </View>
        </>
      )}

      {!!error && (
        <AppText variant="caption" tone="secondary">
          {error}
        </AppText>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  panel: { padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  sentence: { gap: 6, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.divider },
  excluded: { opacity: 0.45 },
  struck: { textDecorationLine: 'line-through' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
