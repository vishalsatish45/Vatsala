import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { DEPARTMENTS, tagLabel } from '@/data/catalogue';
import { activeTags, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Referral } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

const URGENCY: Record<string, Referral['urgency']> = { Routine: 'routine', 'Within 24 h': '24h', Emergency: 'emergency' };

/** CT-51 New referral with an auto-attached context bundle (PRD F-17). */
export default function NewReferral() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const [dept, setDept] = useState<string>();
  const [urgency, setUrgency] = useState<string>('Routine');
  const [reason, setReason] = useState('');
  const [question, setQuestion] = useState('');

  function send() {
    if (!dept || !reason.trim()) return Alert.alert('Missing details', 'Choose a department and add the reason.');
    const rid = db.createReferral({ pregnancyId: p.id, department: dept, urgency: URGENCY[urgency] ?? 'routine', reason: reason.trim(), question: question.trim() }, by, now);
    router.replace({ pathname: '/care/referral/[id]', params: { id: rid } });
  }

  return (
    <Screen blob="none" header={<TopBar back title="New referral" />} footer={<Button label="Send referral" onPress={send} />}>
      <AppText variant="display">Refer {m.name}</AppText>
      <Card style={{ gap: space.md }}>
        <OptionChips label="Department" options={DEPARTMENTS} value={dept} onChange={setDept} />
        <OptionChips label="Urgency (your choice)" options={Object.keys(URGENCY)} value={urgency} onChange={(v) => v && setUrgency(v)} />
        <Field label="Reason" value={reason} onChangeText={setReason} placeholder="e.g. Palpitations reported" multiline />
        <Field label="Question to answer" value={question} onChangeText={setQuestion} placeholder="e.g. Fitness for vaginal delivery?" multiline />
      </Card>
      <Card style={{ gap: 6 }}>
        <AppText variant="headline">Attached context</AppText>
        <AppText variant="caption" tone="secondary">
          {p.mchId} · {gaLabel(p, now)} · G{p.gpla.g}P{p.gpla.p}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Tags: {activeTags(db, p.id).map((t) => tagLabel(t.code)).join(', ') || 'none'}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Documented conditions: {p.history.conditions.join(', ') || 'none'}
        </AppText>
      </Card>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
