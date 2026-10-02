import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDay, gaLabel, invState, motherOf, nextVisit, stillDue } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { sharePdf } from '@/lib/device';
import { AppText, Button, Card, InfoRow, Screen, Section, TopBar, space } from '@/ui';

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
  const tagsText = activeTags(db, p.id).map((t) => tagLabel(t.code)).join(', ') || 'None';

  async function share() {
    const li = (x: string) => `<li>${x.replace(/</g, '&lt;')}</li>`;
    const html = `<html><body style="font-family:sans-serif;padding:24px;color:#2E1F2A">
      <h2 style="margin:0">Handoff summary · ${m.name}</h2>
      <p style="color:#6E5A67">${p.mchId} · ${m.age} y · ${p.status === 'delivered' ? 'Delivered' : gaLabel(p, now)} · EDD ${fmtDay(p.edd)}</p>
      <h3>Documented</h3><ul>${li(`G/P/L/A ${p.gpla.g}/${p.gpla.p}/${p.gpla.l}/${p.gpla.a}`)}${li(`Tags: ${tagsText}`)}${li(`Conditions: ${p.history.conditions.join(', ') || 'None documented'}`)}${li(`Allergies: ${p.history.allergies.join(', ') || 'None documented'}`)}${li(`Blood group: ${p.history.bloodGroup ?? '—'}`)}</ul>
      <h3>Done</h3><ul>${done.map((i) => li(i.sensitive ? i.label : `${i.label} — ${i.result?.value ?? ''}`)).join('')}</ul>
      <h3>Still due</h3><ul>${due.map((d) => li(`${d.label} — ${d.detail}`)).join('') || li('Nothing pending')}</ul>
      <p>Next visit: ${nv ? `${fmtDay(nv.dueBy)} · ${nv.title}` : '—'}</p>
      <p style="color:#A5949E;font-size:11px">Documented facts only · generated ${now.toLocaleString('en-IN')} · synthetic demo data</p>
    </body></html>`;
    try {
      await sharePdf(html, `Handoff ${p.mchId}`);
    } catch {
      /* alert already shown */
    }
  }

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
      <Button label="Share as PDF" onPress={share} />
      <AppText variant="caption" tone="faint" style={{ marginTop: space.sm }}>
        Documented facts only.
      </AppText>
    </Screen>
  );
}
