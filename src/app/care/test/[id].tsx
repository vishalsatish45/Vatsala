import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { NOT_DONE_REASONS } from '@/data/catalogue';
import { fmtDay, invState, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { EnteredInErrorSheet, type EieTarget } from '@/features/care/EnteredInErrorSheet';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, Field, InfoRow, OptionChips, Screen, StatusBadge, TopBar, space } from '@/ui';

const FOLLOW_UPS = ['None', 'Repeat test', 'Refer', 'Discuss at next visit'];

/** CT-23/24 Investigation: order → enter result → clinician review (PRD F-16). No auto "abnormal". */
export default function TestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const inv = db.investigations.find((x) => x.id === id);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState<string>();
  const [reason, setReason] = useState<string>();
  const [eie, setEie] = useState<EieTarget>();
  const treating = useSession((s) => s.account?.care?.role) !== 'specialist';
  if (!inv) return <Screen header={<TopBar back title="Test" />}><AppText>Not found.</AppText></Screen>;
  const p = db.pregnancies.find((x) => x.id === inv.subjectId);
  const m = p ? motherOf(db, p.motherId) : undefined;
  const s = invState(inv, now);

  return (
    <Screen blob="none" header={<TopBar back title="Investigation" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{inv.label}</AppText>
        <AppText tone="secondary">
          {m?.name} · {p?.mchId}
        </AppText>
        <StatusBadge status={s.status} label={s.label} />
      </View>

      <Card>
        <InfoRow label="Window" value={`${fmtDay(inv.dueFrom)} – ${fmtDay(inv.dueBy)}`} />
        <InfoRow label="Type" value={inv.kind === 'scan' ? 'Ultrasound' : 'Lab'} />
        {inv.orderedAt && <InfoRow label="Ordered" value={fmtDay(inv.orderedAt)} />}
        {inv.result && <InfoRow label="Tested" value={fmtDay(inv.result.at)} />}
        {inv.result && <InfoRow label="Result (as entered)" value={`${inv.result.value}${inv.result.unit ? ` ${inv.result.unit}` : ''}`} />}
        {inv.result?.note && <InfoRow label="Note" value={inv.result.note} />}
        {inv.review && <InfoRow label="Reviewed" value={`${inv.review.by} · ${fmtDay(inv.review.at)} · ${inv.review.followUp}`} />}
        {inv.sensitive && <InfoRow label="Privacy" value="Never shown in the Family app" />}
        {inv.result && inv.resultId && treating && (
          <View style={{ flexDirection: 'row', paddingTop: space.sm }}>
            <Chip label="Result entered in error" onPress={() => setEie({ kind: 'investigation_result', id: inv.resultId!, label: `${inv.label} · ${inv.result!.value}${inv.result!.unit ? ` ${inv.result!.unit}` : ''}` })} />
          </View>
        )}
      </Card>
      <EnteredInErrorSheet target={eie} onClose={() => setEie(undefined)} />

      {(inv.status === 'due' || inv.status === 'ordered') && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">{inv.status === 'due' ? 'Order or enter result' : 'Enter result'}</AppText>
          {inv.status === 'due' && <Button variant="secondary" label="Mark as ordered" onPress={() => db.orderInvestigation(inv.id, by, now)} />}
          <Field label="Result" value={value} onChangeText={setValue} placeholder={inv.kind === 'scan' ? 'e.g. Report documented' : 'e.g. 11.2 g/dL'} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} multiline />
          <Button label="Save result" onPress={() => value.trim() && db.enterResult(inv.id, value.trim(), undefined, note.trim() || undefined, by, now)} />
          <OptionChips label="Or mark not done" options={NOT_DONE_REASONS} value={reason} onChange={setReason} />
          {reason && <Button variant="secondary" label={`Not done · ${reason}`} onPress={() => { db.markNotDone(inv.id, reason, by, now); router.back(); }} />}
        </Card>
      )}

      {inv.status === 'resulted' && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">Your review</AppText>
          <AppText variant="caption" tone="secondary">
            The app never marks results normal or abnormal. Choose what happens next.
          </AppText>
          <OptionChips label="Follow-up" options={FOLLOW_UPS} value={followUp} onChange={setFollowUp} />
          <Button
            label="Mark reviewed"
            onPress={() => {
              if (!followUp) return;
              db.reviewResult(inv.id, followUp, by, now);
              if (followUp === 'Refer' && p) router.replace({ pathname: '/care/p/[id]/refer', params: { id: p.id } });
              else router.back();
            }}
          />
        </Card>
      )}
    </Screen>
  );
}
