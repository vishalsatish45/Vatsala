import { View } from 'react-native';
import { router } from 'expo-router';
import { BedDouble } from 'lucide-react-native';
import { daysBetween } from '@domain/gestation';

import { tagLabel } from '@/data/catalogue';
import { activeTags, fmtDay, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Avatar, Chip, EmptyState, ListRow, Screen, Section, StatusBadge, TopBar, space } from '@/ui';

/** CT-55 Labour room: admitted mothers, then those near their EDD (operational list, no scoring). */
export default function LabourRoom() {
  const db = useDb();
  const now = useNow();
  const admitted = db.pregnancies.filter((p) => p.status === 'admitted');
  const near = db.pregnancies.filter((p) => p.status === 'active' && daysBetween(now, p.edd) <= 21).sort((a, b) => a.edd.getTime() - b.edd.getTime());

  const row = (p: (typeof admitted)[number], admittedRow: boolean) => {
    const m = motherOf(db, p.motherId);
    return (
      <ListRow
        key={p.id}
        leading={<Avatar name={m.name} size={40} />}
        title={m.name}
        subtitle={`${p.mchId} · ${gaLabel(p, now)} · EDD ${fmtDay(p.edd)}`}
        meta={
          <>
            {admittedRow ? <StatusBadge status="due" label="Admitted" /> : <StatusBadge status="upcoming" label={`EDD in ${daysBetween(now, p.edd)} days`} />}
            {activeTags(db, p.id).map((t) => (
              <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
            ))}
          </>
        }
        onPress={() => router.push(admittedRow ? { pathname: '/care/p/[id]/deliver', params: { id: p.id } } : { pathname: '/care/p/[id]', params: { id: p.id } })}
      />
    );
  };

  return (
    <Screen blob="none" header={<TopBar back title="Labour room" />}>
      <AppText variant="display">Labour room</AppText>
      <Section title={`Admitted · ${admitted.length}`}>
        {admitted.length === 0 ? <EmptyState icon={BedDouble} title="No one admitted" body="Admit from a patient's Plan → Admit / record delivery." /> : <View style={{ gap: space.sm }}>{admitted.map((p) => row(p, true))}</View>}
      </Section>
      <Section title="Due within 3 weeks">
        <View style={{ gap: space.sm }}>{near.map((p) => row(p, false))}</View>
      </Section>
    </Screen>
  );
}
