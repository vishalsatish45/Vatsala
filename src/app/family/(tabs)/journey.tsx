import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { HeartPulse, Pill, Scale } from 'lucide-react-native';
import { gestationalAge } from '@domain/gestation';

import { useDb } from '@/data/store';
import { MyBaby } from '@/features/family/MyBaby';
import { RecordForm } from '@/features/family/RecordForm';
import { fmtDay, fmtShort, fmtTime } from '@/features/family/itemText';
import { familyTimeline } from '@/features/family/timeline';
import { useFamily } from '@/features/family/useFamily';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, ContinuityTimeline, ListRow, Screen, StatTile, StatusBadge, TopBar, UnderlineTabs, WeekScrubber, palette, space } from '@/ui';

type Tab = 'journey' | 'tests' | 'readings' | 'record' | 'meds';

const TEST_KEYS = ['ogtt', 'hb1', 'hb2', 'hb3', 'anomaly', 'dating', 'bg', 'urine', 'rbs', 'tsh', 'ict'];

/**
 * FH-20…24 My pregnancy (Journey · Tests · Readings · Medicines) — becomes FH-30 My Baby
 * after delivery. No tags, no sensitive results (PRD §15.4).
 */
export default function Journey() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [tab, setTab] = useState<Tab>('journey');
  const p = ctx.pregnancy;
  if (!p || !ctx.mother) return <Screen withNav header={<TopBar title={t('family.tabs.journey')} />}><AppText>—</AppText></Screen>;

  if (p.status === 'delivered' && ctx.babies.length > 0) {
    return (
      <Screen withNav blobCenterY={170} header={<TopBar title={t('family.baby.title')} />}>
        <MyBaby />
      </Screen>
    );
  }

  const ga = gestationalAge(p.edd, now);
  const visits = db.visits.filter((v) => v.pregnancyId === p.id).sort((a, b) => b.at.getTime() - a.at.getTime());
  const last = visits[0];
  const logs = ctx.scopes.logs ? db.selfLogs.filter((l) => l.motherId === ctx.mother!.id).sort((a, b) => b.at.getTime() - a.at.getTime()) : [];
  const tests = db.investigations.filter((i) => i.subjectId === p.id && !i.sensitive);

  return (
    <Screen withNav blob="none" header={<TopBar title={t('family.tabs.journey')} />}>
      <AppText variant="display">{t('family.journeyTitle')}</AppText>
      <AppText tone="secondary">{t('family.weeksDays', { w: ga.weeks, d: ga.days })} · 🩺 {p.assignedDoctor?.name ?? t('family.noDoctor')}</AppText>
      {p.status !== 'delivered' && <WeekScrubber week={ga.weeks} label={t('family.weeksDays', { w: ga.weeks, d: ga.days })} />}

      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'journey', label: t('family.journey.journey') },
          { value: 'tests', label: t('family.journey.tests') },
          { value: 'meds', label: t('family.journey.meds') },
          { value: 'readings', label: t('family.journey.readings') },
          { value: 'record', label: t('family.journey.record') },
        ]}
      />

      {tab === 'journey' && (
        <ContinuityTimeline
          events={familyTimeline(db, ctx, now, t)}
          now={now}
          fmt={(d) => fmtDay(d, lang)}
          motherLabel={t('family.tl.you')}
          babyLabel={t('family.tl.baby')}
          todayLabel={t('family.tl.today')}
          edd={p.status === 'delivered' ? undefined : p.edd}
          eddLabel={t('family.tl.due')}
        />
      )}

      {tab === 'tests' &&
        (ctx.scopes.logs || !ctx.isCaregiver ? (
          <View style={{ gap: space.sm }}>
            {tests.map((i) => {
              const status = i.status === 'reviewed' || i.status === 'not_done' ? 'done' : i.status === 'resulted' ? 'due' : now.getTime() < i.dueFrom.getTime() ? 'upcoming' : 'due';
              const label = i.status === 'resulted' ? t('family.status.discuss') : t(`family.status.${status}`);
              return (
                <ListRow
                  key={i.id}
                  title={TEST_KEYS.includes(i.code) ? t(`family.tests.${i.code}`) : i.label}
                  subtitle={status === 'done' && i.result ? `${fmtShort(i.result.at, lang)} · ${i.result.value}${i.result.unit ? ` ${i.result.unit}` : ''}` : status === 'done' ? fmtShort(i.dueBy, lang) : t('family.before', { date: fmtShort(i.dueBy, lang) })}
                  meta={<StatusBadge status={status} label={label} />}
                  onPress={() => router.push({ pathname: '/family/test/[id]' as any, params: { id: i.id } })}
                />
              );
            })}
          </View>
        ) : (
          <AppText tone="secondary">{t('family.me.never')}</AppText>
        ))}

      {tab === 'readings' &&
        (ctx.scopes.logs ? (
          <>
            <View style={styles.tiles}>
              <StatTile icon={Scale} label={t('family.log.weight')} value={last?.vitals.weightKg ? String(last.vitals.weightKg) : '—'} unit="kg" caption={last ? fmtShort(last.at, lang) : undefined} badge={t('family.journey.atHospital')} />
              <StatTile icon={HeartPulse} label={t('family.log.bp')} value={last?.vitals.bpSys ? `${last.vitals.bpSys}/${last.vitals.bpDia}` : '—'} caption={last ? fmtShort(last.at, lang) : undefined} badge={t('family.journey.atHospital')} />
            </View>
            {logs.map((l) => (
              <ListRow key={l.id} title={l.kind === 'note' ? l.value : `${t(`family.log.${l.kind}`)}: ${l.value}`} subtitle={`${t('family.journey.youRecorded')} · ${fmtDay(l.at, lang)} · ${fmtTime(l.at, lang)}`} />
            ))}
            {!ctx.isCaregiver && <Button variant="secondary" label={t('family.journey.addReading')} onPress={() => router.push('/family/log')} />}
          </>
        ) : (
          <AppText tone="secondary">{t('family.me.limited', { name: ctx.mother.name })}</AppText>
        ))}

      {tab === 'record' &&
        (ctx.scopes.logs && !ctx.isCaregiver ? (
          <RecordForm onSaved={() => setTab('readings')} />
        ) : (
          <AppText tone="secondary">{t('family.me.limited', { name: ctx.mother.name })}</AppText>
        ))}

      {tab === 'meds' && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="caption" tone="secondary">
            {t('family.journey.medsSub')}
          </AppText>
          {p.history.medicines.map((m) => (
            <View key={m} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <Pill size={18} color={palette.rose600} />
              <AppText variant="bodyMedium">{m}</AppText>
            </View>
          ))}
          <Button variant="secondary" label={t('family.meds.title')} onPress={() => router.push('/family/medicines')} />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ tiles: { flexDirection: 'row', gap: space.sm } });
