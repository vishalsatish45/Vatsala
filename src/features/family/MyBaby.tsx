import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarHeart, Scale } from 'lucide-react-native';
import { daysBetween } from '@domain/gestation';

import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, Button, Card, ContinuityTimeline, HeroNumber, ListRow, SegmentedPills, StatTile, StatusBadge, UnderlineTabs, space } from '@/ui';

import { fmtDay, fmtShort, itemStatus, itemTitle, itemWhen } from './itemText';
import { familyTimeline } from './timeline';
import { familyItems, useFamily } from './useFamily';

/** FH-30…33 My Baby: age, birth details, vaccine card, baby visits and the mother–baby timeline. */
export function MyBaby() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [idx, setIdx] = useState('0');
  const [tab, setTab] = useState<'baby' | 'vaccines' | 'timeline'>('baby');
  const baby = ctx.babies[Number(idx)] ?? ctx.babies[0];
  if (!baby) return null;

  if (!ctx.scopes.baby) {
    return <AppText tone="secondary">{t('family.me.limited', { name: ctx.mother?.name ?? '' })}</AppText>;
  }

  const age = daysBetween(baby.dob, now);
  // Doses recorded as not given are the care team's record; the family schedule never lists them (as family_schedule).
  const vax = db.immunizations.filter((i) => i.babyId === baby.id && i.notGivenReason === undefined);
  const groups = [...new Set(vax.map((v) => v.group))];
  const visits = familyItems(db, ctx, now).filter((i) => i.subject === 'baby' && i.kind !== 'vaccine');

  return (
    <View style={{ gap: space.md }}>
      {ctx.babies.length > 1 && (
        <SegmentedPills value={idx} onChange={setIdx} options={ctx.babies.map((_, i) => ({ value: String(i), label: t('family.baby.twin', { n: i + 1 }) }))} />
      )}
      <UnderlineTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'baby', label: t('family.baby.title') },
          { value: 'vaccines', label: t('family.baby.vaccines') },
          { value: 'timeline', label: t('family.journey.journey') },
        ]}
      />

      {tab === 'baby' && (
        <>
          <HeroNumber
            caption={`${t('family.babyAge')} · ${baby.sex === 'F' ? t('family.baby.girl') : baby.sex === 'M' ? t('family.baby.boy') : t('family.baby.undetermined')}`}
            value={String(age < 14 ? age : Math.floor(age / 7))}
            suffix={` ${age < 14 ? (age === 1 ? t('family.dayOld') : t('family.daysOld')) : t('family.weeksOld')}`}
          />
          <View style={styles.tiles}>
            <StatTile icon={Scale} label={t('family.baby.birthWeight')} value={baby.birthWeightG != null ? (baby.birthWeightG / 1000).toFixed(2) : '—'} unit="kg" />
            <StatTile icon={CalendarHeart} label={t('family.baby.born')} value={String(baby.dob.getDate())} unit={baby.dob.toLocaleDateString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { month: 'short' })} />
          </View>

          {visits.length > 0 && (
            <View style={{ gap: space.sm }}>
              <AppText variant="title">{t('family.baby.visits')}</AppText>
              {visits.map((i) => (
                <ListRow key={i.id} title={itemTitle(t, i)} subtitle={itemWhen(t, i, lang)} meta={<StatusBadge status={i.status} label={itemStatus(t, i)} />} onPress={() => router.push({ pathname: '/family/item/[id]', params: { id: i.id } })} />
              ))}
            </View>
          )}

          <Button variant="secondary" label={t('family.baby.logFeeding')} onPress={() => router.push('/family/log')} />
          <Button variant="secondary" label={t('family.guide.title')} onPress={() => router.push('/family/newborn-guide')} />
        </>
      )}

      {tab === 'vaccines' && (
        <>
          {groups.map((g) => (
            <Card key={g} style={{ gap: 8 }}>
              <AppText variant="headline">{g}</AppText>
              {vax
                .filter((v) => v.group === g)
                .map((v) => {
                  const overdue = !v.givenOn && daysBetween(v.dueOn, now) > 7;
                  const due = !v.givenOn && daysBetween(v.dueOn, now) >= 0;
                  return (
                    <View key={v.id} style={styles.dose}>
                      <AppText variant="bodyMedium" style={{ flex: 1 }}>
                        {v.label}
                      </AppText>
                      <StatusBadge
                        status={v.givenOn ? 'done' : overdue ? 'overdue' : due ? 'due' : 'upcoming'}
                        label={v.givenOn ? t('family.baby.given', { date: fmtShort(v.givenOn, lang) }) : overdue ? t('family.baby.overdueOn', { date: fmtShort(v.dueOn, lang) }) : t('family.baby.dueOn', { date: fmtShort(v.dueOn, lang) })}
                      />
                    </View>
                  );
                })}
            </Card>
          ))}
        </>
      )}

      {tab === 'timeline' && (
        <ContinuityTimeline events={familyTimeline(db, ctx, now, t)} now={now} fmt={(d) => fmtDay(d, lang)} motherLabel={t('family.tl.you')} babyLabel={t('family.tl.baby')} todayLabel={t('family.tl.today')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  dose: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
});
