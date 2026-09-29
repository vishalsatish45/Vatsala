import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, MessageCircle } from 'lucide-react-native';
import { addDays } from '@domain/gestation';

import { MISSED_OUTCOMES } from '@/data/catalogue';
import { ago, fmtDay, motherOf, taskState } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useActor } from '@/features/care/nav';
import { comingSoon } from '@/lib/comingSoon';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, Chip, InfoRow, IntensityPill, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

/** CT-96 Task / missed-visit recovery: call, remind, reschedule, log outcome (PRD F-23). */
export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const t = db.tasks.find((x) => x.id === id);
  const [outcome, setOutcome] = useState<string>();
  const [inDays, setInDays] = useState<string>();
  if (!t) return <Screen header={<TopBar back title="Task" />}><AppText>Not found.</AppText></Screen>;

  const baby = t.subjectType === 'baby' ? db.babies.find((b) => b.id === t.subjectId) : undefined;
  const p = baby ? db.pregnancies.find((x) => x.id === baby.pregnancyId) : db.pregnancies.find((x) => x.id === t.subjectId);
  const m = p ? motherOf(db, p.motherId) : undefined;
  const st = taskState(db, t, now);
  const intensity = baby?.intensity ?? p?.intensity ?? 'routine';

  return (
    <Screen blob="none" header={<TopBar back title={st === 'missed' ? 'Missed visit' : 'Task'} />}>
      <View style={{ gap: 6 }}>
        <AppText variant="display">{baby ? `Baby of ${m?.name}` : m?.name}</AppText>
        <AppText tone="secondary">{t.title}</AppText>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <StatusBadge status={st} label={st === 'missed' ? `Missed · due ${fmtDay(t.dueBy)}` : `Due ${fmtDay(t.dueBy)}`} />
          <IntensityPill value={intensity} />
        </View>
      </View>

      <Card>
        <InfoRow label="Phone" value={m?.phone} />
        <InfoRow label="Language" value={m?.lang === 'kn' ? 'Kannada' : m?.lang === 'hi' ? 'Hindi' : 'English'} />
        <InfoRow label="Village" value={m?.village} />
        <InfoRow label="Contact attempts" value={String(t.contactAttempts.length)} />
        {t.overrideReason && <InfoRow label="Last change" value={t.overrideReason} />}
      </Card>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label="Call" icon={Phone} onPress={() => m && Linking.openURL(`tel:${m.phone}`)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="WhatsApp" icon={MessageCircle} onPress={() => comingSoon('WhatsApp reminder (F-49) — sent from an approved template in her language')} />
        </View>
      </View>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Log outcome</AppText>
        <OptionChips options={MISSED_OUTCOMES} value={outcome} onChange={setOutcome} />
        {outcome === 'Rescheduled' && <OptionChips label="New date in (days)" options={['1', '2', '3', '7']} value={inDays} onChange={setInDays} />}
        <Button
          label="Save outcome"
          onPress={() => {
            if (!outcome) return;
            db.logContact(t.id, outcome, by, now);
            if (outcome === 'Rescheduled' && inDays) db.rescheduleTask(t.id, addDays(now, Number(inDays)), 'Rescheduled after contact', by, now);
            if (['Delivered elsewhere', 'Moved away', 'Declined'].includes(outcome)) db.cancelTask(t.id, outcome, by, now);
            router.back();
          }}
        />
      </Card>

      {t.contactAttempts.length > 0 && (
        <Card style={{ gap: 6 }}>
          <AppText variant="headline">Attempts</AppText>
          {[...t.contactAttempts].reverse().map((a, i) => (
            <AppText key={i} variant="caption" tone="secondary">
              {a.outcome} · {a.by} · {ago(a.at, now)} ago
            </AppText>
          ))}
        </Card>
      )}

      {p && <Chip label={`Open ${m?.name}`} onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })} />}
    </Screen>
  );
}
