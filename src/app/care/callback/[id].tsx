import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone } from 'lucide-react-native';

import { CALLBACK_OUTCOMES } from '@/data/catalogue';
import { ago, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, Field, InfoRow, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

/**
 * CT-41/42 Call-back detail & outcome (PRD F-25). Shows what the family reported, as
 * reported. The clinical judgement is made by the person on the call.
 */
export default function CallbackDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const c = db.callbacks.find((x) => x.id === id);
  const [outcome, setOutcome] = useState<string>();
  const [note, setNote] = useState('');
  if (!c) return <Screen header={<TopBar back title="Call-back" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, c.motherId);
  const p = db.pregnancies.find((x) => x.motherId === m.id);
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
        {logs.map((l) => (
          <InfoRow key={l.id} label={`Home ${l.kind.toUpperCase()} (${ago(l.at, now)} ago)`} value={l.value} />
        ))}
      </Card>

      <Button label={`Call ${m.phone}`} icon={Phone} onPress={() => Linking.openURL(`tel:${m.phone}`)} />

      {!c.closedAt && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">After the call</AppText>
          <OptionChips options={CALLBACK_OUTCOMES} value={outcome} onChange={setOutcome} />
          <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="What was discussed" />
          <Button
            label="Close call-back"
            onPress={() => {
              if (!outcome) return;
              db.closeCallback(c.id, outcome, note.trim() || undefined, by, now);
              router.back();
            }}
          />
        </Card>
      )}

      {p && <Chip label={`Open ${m.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />}
    </Screen>
  );
}
