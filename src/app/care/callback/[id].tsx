import { Suspense, lazy } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';
import { Phone } from 'lucide-react-native';

import { CALLBACK_OUTCOMES } from '@/data/catalogue';
import { asCallbackId } from '@/data/ids';
import { ago, currentPregnancy, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Callback } from '@/data/types';
import { closeCallbackSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { RemoteVoiceNote } from '@/features/storage/RemoteVoiceNote';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Chip, Field, InfoRow, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

const VoicePlayer = lazy(() => import('@/features/device/VoicePlayer'));

/**
 * CT-41/42 Call-back detail & outcome (PRD F-25). Shows what the family reported, as
 * reported. The clinical judgement is made by the person on the call.
 */
export default function CallbackDetail() {
  const id = asCallbackId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const c = db.callbacks.find((x) => x.id === id);
  if (!c) return <Screen header={<TopBar back title="Call-back" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, c.motherId);
  // A returning mother: her ongoing pregnancy, else her latest episode.
  const p = currentPregnancy(db, m.id);
  const logs = db.selfLogs.filter((l) => l.motherId === m.id).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 3);

  return (
    <Screen blob="none" header={<TopBar back title="Call-back" />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p ? `${p.mchId} · ${p.status === 'delivered' ? 'Postnatal' : gaLabel(p, now)}` : ''}
        </AppText>
        <StatusBadge status={c.closedAt ? 'done' : 'due'} label={c.closedAt ? `Closed · ${c.outcome}` : `Waiting ${ago(c.at, now)}`} />
      </View>

      <Card style={{ gap: space.sm }}>
        <AppText variant="headline">What the family reported</AppText>
        <InfoRow label="Requested by" value={`${c.requestedBy} · ${c.channel === 'whatsapp' ? 'WhatsApp' : 'app'}`} />
        {c.signs.length > 0 && (
          <View style={{ gap: 6 }}>
            <AppText variant="label" tone="secondary">
              Ticked from the warning-signs list
            </AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.signs.map((s) => (
                <Chip key={s} label={s} variant="tag" />
              ))}
            </View>
          </View>
        )}
        <InfoRow label="Message" value={c.note} />
        {c.voiceUri ? (
          <Suspense fallback={null}>
            <VoicePlayer uri={c.voiceUri} seconds={c.voiceSeconds} />
          </Suspense>
        ) : c.voicePath ? (
          <RemoteVoiceNote storageKey={c.voicePath} seconds={c.voiceSeconds} />
        ) : null}
        {logs.map((l) => (
          <InfoRow key={l.id} label={`Home ${l.kind.toUpperCase()} (${ago(l.at, now)} ago)`} value={l.value} />
        ))}
      </Card>

      <Button label={`Call ${m.phone}`} icon={Phone} onPress={() => Linking.openURL(`tel:${m.phone}`)} />

      {!c.closedAt && <CloseForm key={c.id} callback={c} />}

      {p && <Chip label={`Open ${m.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />}
    </Screen>
  );
}

/** CT-42 "After the call": the outcome the person on the call chose, and their note. */
function CloseForm({ callback }: { callback: Callback }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(closeCallbackSchema, { defaultValues: { outcome: undefined, note: '' } });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((v) => {
      db.closeCallback(callback.id, v.outcome, v.note, by, now);
      router.back();
    }),
  );
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">After the call</AppText>
      <Controller control={control} name="outcome" render={({ field }) => <OptionChips options={CALLBACK_OUTCOMES} value={field.value} onChange={field.onChange} />} />
      <Controller control={control} name="note" render={({ field }) => <Field label="Note" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline placeholder="What was discussed" />} />
      <Button label="Close call-back" disabled={busy} onPress={save} />
    </Card>
  );
}
