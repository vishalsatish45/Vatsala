import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { addDays, daysBetween, toDateOnly } from '@domain/gestation';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { itemStatus, itemTitle, itemWhen } from '@/features/family/itemText';
import { useNow } from '@/lib/clock';
import { localeFor } from '@/lib/i18n';
import { AppText, DayStrip, GlassSurface, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, space, type DayState } from '@/ui';

type Range = 'week' | 'month' | 'all';

/** FH-10 Schedule: week day-strip + everything coming up (DESIGN.md §6.3). */
export default function Schedule() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [range, setRange] = useState<Range>('week');
  const items = familyItems(db, ctx, now);

  // Week strip: Monday → Sunday of the current week.
  const today = toDateOnly(now);
  const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
  const visits = ctx.pregnancy ? db.visits.filter((v) => v.pregnancyId === ctx.pregnancy!.id) : [];
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const same = (x: Date) => daysBetween(d, x) === 0;
    let state: DayState = 'none';
    if (visits.some((v) => same(v.at))) state = 'done';
    else if (items.some((it) => same(it.date) && it.status === 'missed')) state = 'missed';
    else if (items.some((it) => same(it.date))) state = 'planned';
    return { date: d, state, label: d.toLocaleDateString(localeFor(lang), { weekday: 'narrow', timeZone: 'UTC' }), isToday: i === (today.getUTCDay() + 6) % 7 };
  });

  const limit = range === 'week' ? 7 : range === 'month' ? 31 : 400;
  const shown = items.filter((i) => i.status !== 'upcoming' || daysBetween(now, i.date) <= limit);

  return (
    <Screen withNav blob="none" header={<TopBar title={t('family.tabs.schedule')} />}>
      <AppText variant="display">{t('family.scheduleTitle')}</AppText>
      <GlassSurface strong style={{ padding: space.md }}>
        <DayStrip days={days} />
      </GlassSurface>
      <SegmentedPills
        value={range}
        onChange={setRange}
        options={[
          { value: 'week', label: t('family.range.week') },
          { value: 'month', label: t('family.range.month') },
          { value: 'all', label: t('family.range.all') },
        ]}
      />
      <View style={{ gap: space.sm }}>
        {shown.map((i) => (
          <ListRow
            key={i.id}
            title={itemTitle(t, i)}
            subtitle={`${itemWhen(t, i, lang)}${i.place ? ` · ${i.place}` : ''}`}
            meta={<StatusBadge status={i.status} label={itemStatus(t, i)} />}
            onPress={() => router.push({ pathname: '/family/item/[id]', params: { id: i.id } })}
          />
        ))}
        {shown.length === 0 && (
          <AppText tone="secondary" align="center" style={{ paddingVertical: space.xl }}>
            {t('family.noUpcoming')}
          </AppText>
        )}
      </View>
    </Screen>
  );
}
