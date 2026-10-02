import { View } from 'react-native';
import { router } from 'expo-router';
import { Baby, BedDouble, ClipboardCheck } from 'lucide-react-native';
import { daysBetween } from '@domain/gestation';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDay, fmtTime, gaLabel, motherOf, sexLabel } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Pregnancy } from '@/data/types';
import { useNow } from '@/lib/clock';
import { AppText, Avatar, Chip, EmptyState, ListRow, Screen, Section, StatusBadge, TopBar, palette, space } from '@/ui';

/**
 * CT-55 Labour room: admitted mothers (with the time of admission), those delivered and awaiting discharge (each
 * mother's and each live baby's checklist one tap away), then those near their EDD. Operational list, no scoring.
 */
export default function LabourRoom() {
  const db = useDb();
  const now = useNow();
  const admitted = db.pregnancies.filter((p) => p.status === 'admitted').sort((a, b) => (a.admittedAt?.getTime() ?? 0) - (b.admittedAt?.getTime() ?? 0));
  const near = db.pregnancies.filter((p) => p.status === 'active' && daysBetween(now, p.edd) <= 21).sort((a, b) => a.edd.getTime() - b.edd.getTime());
  // Delivered, with the mother's or a living baby's discharge still open.
  const openDischarge = (subjectId: string) => db.discharges.some((d) => d.subjectId === subjectId && !d.completedAt);
  const awaiting = db.pregnancies
    .filter((p) => p.status === 'delivered')
    .map((p) => ({ p, babies: db.babies.filter((b) => b.pregnancyId === p.id && b.outcome === 'live' && !b.deceasedAt) }))
    .filter(({ p, babies }) => openDischarge(p.id) || babies.some((b) => openDischarge(b.id)))
    .sort((a, b) => (db.deliveries.find((d) => d.pregnancyId === a.p.id)?.at.getTime() ?? 0) - (db.deliveries.find((d) => d.pregnancyId === b.p.id)?.at.getTime() ?? 0));

  const tags = (p: Pregnancy) => activeTags(db, p.id).map((t) => <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />);
  const openPatient = (p: Pregnancy) => router.push({ pathname: '/care/p/[id]', params: { id: p.id } });

  const admittedRow = (p: Pregnancy) => {
    const m = motherOf(db, p.motherId);
    const since = p.admittedAt ? `Admitted ${fmtDay(p.admittedAt)} ${fmtTime(p.admittedAt)}` : 'Admitted';
    return (
      <ListRow
        key={p.id}
        leading={<Avatar name={m.name} size={40} />}
        title={m.name}
        subtitle={`${[m.ipNo && `IP ${m.ipNo}`, p.mchId].filter(Boolean).join(' · ')} · ${gaLabel(p, now)}${p.admissionReason ? ` · ${p.admissionReason}` : ''}`}
        meta={
          <>
            <StatusBadge status="due" label={since} />
            {tags(p)}
            <Chip label="Record delivery" icon={Baby} onPress={() => router.push({ pathname: '/care/p/[id]/deliver', params: { id: p.id } })} />
          </>
        }
        onPress={() => openPatient(p)}
      />
    );
  };

  const nearRow = (p: Pregnancy) => {
    const m = motherOf(db, p.motherId);
    return (
      <ListRow
        key={p.id}
        leading={<Avatar name={m.name} size={40} />}
        title={m.name}
        subtitle={`${p.mchId} · ${gaLabel(p, now)} · EDD ${fmtDay(p.edd)}`}
        meta={
          <>
            <StatusBadge status="upcoming" label={`EDD in ${daysBetween(now, p.edd)} days`} />
            {tags(p)}
          </>
        }
        onPress={() => openPatient(p)}
      />
    );
  };

  const checklistChip = (subjectId: string, label: string) => {
    const d = db.discharges.find((x) => x.subjectId === subjectId);
    if (!d) return null;
    const open = d.items.filter((i) => !i.state).length;
    return (
      <Chip
        key={subjectId}
        icon={ClipboardCheck}
        variant={d.completedAt ? 'glass' : 'soft'}
        label={d.completedAt ? `${label} · discharged` : `${label} · ${open ? `${open} open` : 'ready'}`}
        onPress={() => router.push({ pathname: '/care/discharge/[id]', params: { id: subjectId } })}
      />
    );
  };

  return (
    <Screen blob="none" header={<TopBar back title="Labour room" />}>
      <AppText variant="display">Labour room</AppText>
      <Section title={`Admitted · ${admitted.length}`}>
        {admitted.length === 0 ? (
          <EmptyState icon={BedDouble} title="No one admitted" body="Admit from a patient's Plan → Admit / record delivery." />
        ) : (
          <View style={{ gap: space.sm }}>
            {admitted.map(admittedRow)}
            <AppText variant="caption" tone="faint">
              Tap a mother to open her record; “Record delivery” opens the delivery form.
            </AppText>
          </View>
        )}
      </Section>

      {awaiting.length > 0 && (
        <Section title={`Delivered — awaiting discharge · ${awaiting.length}`}>
          <View style={{ gap: space.sm }}>
            {awaiting.map(({ p, babies }) => {
              const m = motherOf(db, p.motherId);
              const d = db.deliveries.find((x) => x.pregnancyId === p.id);
              return (
                <View key={p.id} style={{ gap: 6 }}>
                  <ListRow
                    leading={<Avatar name={m.name} size={40} />}
                    title={m.name}
                    subtitle={`${[m.ipNo && `IP ${m.ipNo}`, p.mchId].filter(Boolean).join(' · ')}${d ? ` · delivered ${fmtDay(d.at)} ${fmtTime(d.at)}` : ''}`}
                    onPress={() => openPatient(p)}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {checklistChip(p.id, 'Mother')}
                    {babies.map((b) => checklistChip(b.id, `${b.childId.slice(-2)} · ${sexLabel(b.sex)}`))}
                  </View>
                  {babies.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {babies.map((b) => (
                        <Chip key={b.id} icon={Baby} iconColor={palette.lav600} label={`Open ${b.childId.slice(-2)}`} onPress={() => router.push({ pathname: '/care/b/[id]', params: { id: b.id } })} />
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </Section>
      )}

      <Section title="Due within 3 weeks">
        <View style={{ gap: space.sm }}>{near.map(nearRow)}</View>
      </Section>
    </Screen>
  );
}
