import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { addDays, daysBetween, toDateOnly } from '@domain/gestation';

import { useDb } from '@/data/store';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { itemStatus, itemTitle, itemWhen } from '@/features/family/itemText';
import { ReadAloudButton } from '@/features/voice/ReadAloudButton';
import { useNow } from '@/lib/clock';
import { localeFor } from '@/lib/i18n';
import { AncBadge, AppText, DayStrip, EmptyState, GlassSurface, ListRow, Screen, SegmentedPills, StatusBadge, TopBar, palette, space, type DayState } from '@/ui';

type Range = 'week' | 'month' | 'all';

function monthCells(anchor: Date): Date[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const lead = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
}

/** Schedule: week strip / month grid / all-time, with prev-next navigation. */
export default function Schedule() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const [range, setRange] = useState<Range>('week');
  const [anchor, setAnchor] = useState(() => toDateOnly(now));
  const items = familyItems(db, ctx, now);

  const monday = useMemo(() => addDays(toDateOnly(anchor), -((toDateOnly(anchor).getUTCDay() + 6) % 7)), [anchor]);
  const visits = ctx.pregnancy ? db.visits.filter((v) => v.pregnancyId === ctx.pregnancy!.id) : [];
  const same = (a: Date, b: Date) => daysBetween(a, b) === 0;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    let state: DayState = 'none';
    if (visits.some((v) => same(d, v.at))) state = 'done';
    else if (items.some((it) => same(d, it.date) && it.status === 'missed')) state = 'missed';
    else if (items.some((it) => same(d, it.date))) state = 'planned';
    return { date: d, state, label: d.toLocaleDateString(localeFor(lang), { weekday: 'narrow', timeZone: 'UTC' }), isToday: same(d, now) };
  });

  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const monthKey = `${anchor.getUTCFullYear()}-${anchor.getUTCMonth()}`;

  const shown = useMemo(() => {
    if (range === 'week') {
      const sun = addDays(monday, 6);
      return items.filter((i) => i.date >= addDays(monday, -1) && i.date <= addDays(sun, 1));
    }
    if (range === 'month') {
      return items.filter((i) => i.date.getUTCFullYear() === anchor.getUTCFullYear() && i.date.getUTCMonth() === anchor.getUTCMonth());
    }
    return items;
  }, [items, range, monday, anchor]);

  const shift = (dir: 1 | -1) => {
    if (range === 'week') setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + dir, 1)));
  };

  const title = range === 'week'
    ? `${monday.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${addDays(monday, 6).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
    : anchor.toLocaleDateString(localeFor(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Screen
      withNav
      blob="none"
      header={<TopBar title={t('family.tabs.schedule')} right={<ReadAloudButton text={t('family.scheduleTitle')} />} />}
    >
      <AppText variant="display">{t('family.scheduleTitle')}</AppText>
      <SegmentedPills
        value={range}
        onChange={(v) => setRange(v)}
        options={[
          { value: 'week', label: t('family.range.week') },
          { value: 'month', label: t('family.range.month') },
          { value: 'all', label: t('family.range.all') },
        ]}
      />
      <View style={styles.navRow}>
        <Pressable onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel="Previous" style={styles.navBtn}>
          <ChevronLeft size={20} color={palette.rose600} />
        </Pressable>
        <AppText variant="headline">{title}</AppText>
        <Pressable onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="Next" style={styles.navBtn}>
          <ChevronRight size={20} color={palette.rose600} />
        </Pressable>
      </View>

      {range === 'week' ? (
        <GlassSurface strong style={{ padding: space.sm }}>
          <DayStrip days={days} />
        </GlassSurface>
      ) : (
        <GlassSurface strong style={{ padding: space.sm, gap: 4 }} key={monthKey}>
          <View style={styles.weekHead}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => (
              <AppText key={i} variant="caption" tone="faint" style={styles.cell}>
                {w}
              </AppText>
            ))}
          </View>
          {Array.from({ length: 6 }, (_, r) => (
            <View key={r} style={styles.weekHead}>
              {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
                const inMonth = d.getUTCMonth() === anchor.getUTCMonth();
                const has = items.some((it) => same(d, it.date));
                const isToday = same(d, now);
                return (
                  <View key={i} style={styles.cell}>
                    <View style={[styles.dot, isToday && styles.today, has && styles.has]}>
                      <AppText variant="caption" tone={inMonth ? 'primary' : 'faint'}>
                        {d.getUTCDate()}
                      </AppText>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </GlassSurface>
      )}

      <View style={{ gap: space.sm }}>
        {shown.map((i) => (
          <ListRow
            key={i.id}
            title={itemTitle(t, i)}
            subtitle={`${itemWhen(t, i, lang)}${i.place ? ` · ${i.place}` : ''}`}
            meta={
              <>
                {i.kind === 'visit' && <AncBadge />}
                <StatusBadge status={i.status} label={itemStatus(t, i)} />
              </>
            }
            onPress={() => router.push({ pathname: '/family/item/[id]', params: { id: i.id } })}
          />
        ))}
        {shown.length === 0 && <EmptyState title={t('family.noUpcoming')} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { padding: 8 },
  weekHead: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: palette.amber },
  has: { backgroundColor: palette.rose100 },
});
