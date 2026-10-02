import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDay, motherOf, patientIds } from '@/data/selectors';
import { useDb } from '@/data/store';
import { AppText, Button, Card, Chip, InfoRow, ListRow, Screen, Section, TopBar } from '@/ui';

/**
 * Case File: the patient's complete documented record in one place —
 * history, previous consultations, diagnoses, medications, reports,
 * pregnancy history and observations. No AI, no interpretation.
 */
export default function CaseFile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const p = db.pregnancies.find((x) => x.id === id);
  if (!p) return <Screen header={<TopBar back title="Case File" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  const ids = patientIds(db, m.id, p.id);
  const tags = activeTags(db, p.id);
  const visits = db.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const invs = db.investigations.filter((i) => i.subjectId === p.id);
  const refs = db.referrals.filter((r) => r.pregnancyId === p.id);
  const notes = db.notes.filter((n) => n.subjectId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Case File" />}
      footer={<Button variant="secondary" label="Done" onPress={() => router.back()} />}
    >
      <View style={{ gap: 2 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">{ids.ageObs}</AppText>
        {!!ids.ip && <AppText tone="secondary">{ids.ip} · {p.mchId}</AppText>}
      </View>

      <Section title="Patient history">
        <Card>
          <InfoRow label="Conditions" value={p.history.conditions.join(', ') || 'None recorded'} />
          <InfoRow label="Allergies" value={p.history.allergies.join(', ') || 'None recorded'} />
          <InfoRow label="Blood group" value={p.history.bloodGroup} />
          <InfoRow label="Height" value={p.history.heightCm ? `${p.history.heightCm} cm` : undefined} />
          <InfoRow label="LMP" value={p.lmp ? fmtDay(p.lmp) : '—'} />
          <InfoRow label="EDD" value={fmtDay(p.edd)} />
        </Card>
      </Section>

      <Section title="Pregnancy history">
        <Card>
          {p.previous.length === 0 && <AppText tone="secondary">None recorded.</AppText>}
          {p.previous.map((x, i) => (
            <InfoRow key={i} label={String(x.year)} value={[x.outcome, x.mode, x.note].filter(Boolean).join(' · ')} />
          ))}
          <InfoRow label="This pregnancy" value={`G${p.gpla.g}P${p.gpla.p}L${p.gpla.l}A${p.gpla.a}`} />
        </Card>
      </Section>

      <Section title={`Previous consultations (${visits.length})`}>
        {visits.length === 0 && <AppText tone="secondary">No visits recorded yet.</AppText>}
        {visits.map((v) => (
          <ListRow
            key={v.id}
            title={`${fmtDay(v.at)} · ${v.by}`}
            subtitle={[
              v.vitals.bpSys ? `BP ${v.vitals.bpSys}/${v.vitals.bpDia ?? '—'}` : '',
              v.vitals.weightKg ? `${v.vitals.weightKg} kg` : '',
              v.complaints.join(', '),
            ].filter(Boolean).join(' · ') || '—'}
          />
        ))}
      </Section>

      <Section title={`Reports (${invs.length})`}>
        {invs.map((i) => (
          <ListRow
            key={i.id}
            title={i.label}
            subtitle={i.result ? `Tested ${fmtDay(i.result.at)} · ${i.result.value}${i.result.unit ? ` ${i.result.unit}` : ''}${i.review ? ` · reviewed (${i.review.followUp})` : ''}` : `Due by ${fmtDay(i.dueBy)} · ${i.status}`}
            onPress={() => router.push({ pathname: '/care/test/[id]', params: { id: i.id } })}
          />
        ))}
      </Section>

      <Section title="Diagnoses">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {tags.length === 0 && <AppText tone="secondary">No tags recorded.</AppText>}
          {tags.map((t) => (
            <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
          ))}
        </View>
      </Section>

      <Section title="Medications">
        <Card>
          {p.history.medicines.length === 0 && <AppText tone="secondary">None prescribed.</AppText>}
          {p.history.medicines.map((med) => (
            <AppText key={med} variant="bodyMedium">· {med}</AppText>
          ))}
        </Card>
      </Section>

      {refs.length > 0 && (
        <Section title="Referrals">
          {refs.map((r) => (
            <ListRow
              key={r.id}
              title={`${r.department} · ${r.status}`}
              subtitle={r.recommendations ?? r.reason}
              onPress={() => router.push({ pathname: '/care/referral/[id]', params: { id: r.id } })}
            />
          ))}
        </Section>
      )}

      <Section title={`Observations & notes (${notes.length})`}>
        {notes.length === 0 && <AppText tone="secondary">No notes yet.</AppText>}
        {notes.map((n) => (
          <Card key={n.id} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <AppText variant="label">{n.author}</AppText>
              <AppText variant="caption" tone="faint">{fmtDay(n.at)}</AppText>
            </View>
            <AppText>{n.body}</AppText>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
