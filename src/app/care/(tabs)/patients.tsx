import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Search, ShieldAlert } from 'lucide-react-native';

import { mchIdIn } from '@/data/payloads';

import { tagLabel } from '@/data/catalogue';
import { daysBetween } from '@domain/gestation';

import { activeTags, babyAgeLabel, gaLabel, motherOf, nextVisit, fmtDay, patientIds } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Avatar, Chip, GlassSurface, ListRow, Screen, SegmentedPills, TopBar, families, intensityLabel, palette, space } from '@/ui';

type Filter = 'pregnant' | 'delivered' | 'babies';

/** CT-10 Patients (search by name, phone or MCH ID — F-28). */
export default function Patients() {
  const db = useDb();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>('pregnant');
  const [q, setQ] = useState('');
  const [smart, setSmart] = useState<string>();
  const match = (...s: string[]) => !q || s.some((x) => x.toLowerCase().includes(q.toLowerCase()));

  // F-26 smart lists — saved operational filters (no clinical scoring).
  const SMART: Record<string, (p: (typeof db.pregnancies)[number]) => boolean> = {
    'Close follow-up': (p) => p.intensity === 'close',
    'Due in 2 weeks': (p) => daysBetween(now, p.edd) <= 14,
    'Results to review': (p) => db.investigations.some((i) => i.subjectId === p.id && i.status === 'resulted'),
    'Has open referral': (p) => db.referrals.some((r) => r.pregnancyId === p.id && !['closed', 'declined'].includes(r.status)),
  };
  const pregnant = db.pregnancies.filter((p) => (p.status === 'active' || p.status === 'admitted') && (!smart || SMART[smart]!(p)));
  const delivered = db.pregnancies.filter((p) => p.status === 'delivered');

  return (
    <Screen withNav blob="none" header={<TopBar title="Patients" />}>
      <GlassSurface strong radius={999} elevation="card" style={styles.search}>
        <Search size={18} color={palette.inkFaint} />
        <TextInput value={q} onChangeText={setQ} placeholder="Name, phone or MCH ID" placeholderTextColor={palette.inkFaint} style={styles.searchInput} />
      </GlassSurface>
      <SegmentedPills
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pregnant', label: 'Pregnant', count: pregnant.length },
          { value: 'delivered', label: 'Delivered', count: delivered.length },
          { value: 'babies', label: 'Babies', count: db.babies.length },
        ]}
      />
      {filter === 'pregnant' && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Object.keys(SMART).map((k) => (
            <Chip key={k} label={k} variant={smart === k ? 'selected' : 'soft'} onPress={() => setSmart(smart === k ? undefined : k)} />
          ))}
        </View>
      )}
      <View style={{ gap: space.sm }}>
        {filter !== 'babies' &&
          (filter === 'pregnant' ? pregnant : delivered).map((p) => {
            const m = motherOf(db, p.motherId);
            if (!match(m.name, m.phone, p.mchId)) return null;
            const tags = activeTags(db, p.id);
            const nv = nextVisit(db, p.id, now);
            const ids = patientIds(db, m.id, p.id);
            return (
              <ListRow
                key={p.id}
                leading={<Avatar name={m.name} size={40} />}
                title={m.name}
                subtitle={ids.ip ? `${ids.ageObs}\n${ids.ip}` : ids.ageObs}
                meta={
                  <>
                    <AppText variant="caption" tone="secondary">
                      {`${p.mchId} · ${p.status === 'delivered' ? 'Delivered' : gaLabel(p, now)}${nv ? ` · next ${fmtDay(nv.dueBy)}` : ''}`}
                    </AppText>
                    {tags.slice(0, 2).map((t) => (
                      <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />
                    ))}
                    {tags.length > 2 && <Chip label={`+${tags.length - 2}`} variant="tag" />}
                    <Chip label={intensityLabel(p.intensity)} variant="soft" />
                  </>
                }
                onPress={() => router.push({ pathname: '/care/p/[id]', params: { id: p.id } })}
              />
            );
          })}
        {filter === 'babies' &&
          db.babies.map((b) => {
            const m = motherOf(db, b.motherId);
            if (!match(m.name, b.childId)) return null;
            return (
              <ListRow
                key={b.id}
                leading={<Avatar name={m.name} size={40} tint="lavender" />}
                title={`Baby of ${m.name}`}
                subtitle={`${b.childId} · ${b.deceasedAt ? `died ${fmtDay(b.deceasedAt)}` : babyAgeLabel(b, now)} · ${b.sex === 'F' ? 'Girl' : 'Boy'}`}
                meta={activeTags(db, b.id).map((t) => <Chip key={t.id} label={tagLabel(t.code)} variant="tag" />)}
                onPress={() => router.push({ pathname: '/care/b/[id]', params: { id: b.id } })}
              />
            );
          })}
        {filter === 'pregnant' && pregnant.length === 0 && <AppText tone="secondary">No active pregnancies.</AppText>}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Chip
          label="Patient not in my list"
          icon={ShieldAlert}
          onPress={() => router.push({ pathname: '/care/emergency', params: mchIdIn(q) ? { mch: mchIdIn(q) } : {} })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.md, height: 48 },
  searchInput: { flex: 1, fontFamily: families.latin.regular, fontSize: 15, color: palette.ink },
});
