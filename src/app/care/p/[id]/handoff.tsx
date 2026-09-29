import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDay, gaLabel, invState, motherOf, nextVisit, stillDue } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Card, InfoRow, Screen, Section, TopBar, space } from '@/ui';

/** CT-29 Structured handoff summary (PRD F-29): documented facts, what's done, what's due. */
export default function Handoff() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const now = useNow();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const nv = nextVisit(db, p.id, now);
  const done = db.investigations.filter((i) => i.subjectId === p.id && i.status === 'reviewed');
  const due = stillDue(db, p, now);

  return (
    <Screen blob="none" header={<TopBar back title="Handoff summary" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} · {m.age} y · {p.status === 'delivered' ? 'Delivered' : gaLabel(p, now)} · EDD {fmtDay(p.edd)}
        </AppText>
      </View>
      <Section title="Documented">
        <Card>
          <InfoRow label="G/P/L/A" value={`${p.gpla.g}/${p.gpla.p}/${p.gpla.l}/${p.gpla.a}`} />
          <InfoRow label="Tags" value={activeTags(db, p.id).map((t) => tagLabel(t.code)).join(', ') || 'None'} />
          <InfoRow label="Conditions" value={p.history.conditions.join(', ') || 'None documented'} />
          <InfoRow label="Allergies" value={p.history.allergies.join(', ') || 'None documented'} />
          <InfoRow label="Blood group" value={p.history.bloodGroup} />
          <InfoRow label="Previous" value={p.previous.map((x) => `${x.year} ${x.mode ?? x.outcome}`).join(', ') || 'None'} />
        </Card>
      </Section>
      <Section title="Done">
        <Card style={{ gap: 4 }}>
          {done.map((i) => (
            <AppText key={i.id} variant="caption" tone="secondary">
              ✓ {i.label}
              {i.sensitive ? '' : ` — ${i.result?.value ?? ''}`}
            </AppText>
          ))}
        </Card>
      </Section>
      <Section title="Still due">
        <Card style={{ gap: 4 }}>
          {due.length === 0 && <AppText tone="secondary">Nothing pending.</AppText>}
          {due.map((d) => (
            <AppText key={d.key} variant="caption">
              • {d.label} — {d.detail}
            </AppText>
          ))}
          {db.investigations
            .filter((i) => i.subjectId === p.id && i.status === 'due' && invState(i, now).status === 'upcoming')
            .slice(0, 3)
            .map((i) => (
              <AppText key={i.id} variant="caption" tone="secondary">
                ○ {i.label} — {invState(i, now).label}
              </AppText>
            ))}
        </Card>
      </Section>
      <Card>
        <InfoRow label="Next visit" value={nv ? `${fmtDay(nv.dueBy)} · ${nv.title}` : undefined} />
        <InfoRow label="Contact" value={`${m.phone} · ${m.emergencyContact.relation} ${m.emergencyContact.phone}`} />
      </Card>
      <AppText variant="caption" tone="faint" style={{ marginTop: space.sm }}>
        Documented facts only. Sharing as PDF arrives with the backend.
      </AppText>
    </Screen>
  );
}
