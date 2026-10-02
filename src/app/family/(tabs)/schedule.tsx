import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { addDays, daysBetween, localDay, toDateOnly } from '@domain/gestation';

import { useDb } from '@/data/store';
import { FocusSwitch, useFamilyFocus } from '@/features/family/FocusSwitch';
import { familyItems, useFamily } from '@/features/family/useFamily';
import { itemPlace, itemStatus, itemTitle, itemWhen } from '@/features/family/itemText';
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
  // Today by the phone's calendar (the UTC day is a day behind between 00:00 and 05:30 IST).
  const today = localDay(now);
  const [anchor, setAnchor] = useState(() => today);
  const { focus, canSwitch } = useFamilyFocus();
  const all = familyItems(db, ctx, now);
  const items = canSwitch ? all.filter((i) => i.subject === focus) : all;

  const monday = useMemo(() => addDays(toDateOnly(anchor), -((toDateOnly(anchor).getUTCDay() + 6) % 7)), [anchor]);
  // Completed hospital visits are the mother's; the baby's strip only shows its own items.
  const visits = ctx.pregnancy && focus === 'mother' ? db.visits.filter((v) => v.pregnancyId === ctx.pregnancy!.id) : [];
  const same = (a: Date, b: Date) => daysBetween(a, b) === 0;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    let state: DayState = 'none';
    if (visits.some((v) => same(d, v.at))) state = 'done';
    else if (items.some((it) => same(d, it.date) && it.status === 'missed')) state = 'missed';
    else if (items.some((it) => same(d, it.date))) state = 'planned';
    return { date: d, state, label: d.toLocaleDateString(localeFor(lang), { weekday: 'narrow', timeZone: 'UTC' }), isToday: same(d, today) };
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

  // The speaker reads what is listed: the period, then each item with its day and status.
  const readAloud = [
    t('family.scheduleTitle'),
    shown.length ? '' : t('family.noUpcoming'),
    ...shown.map((i) => `${itemTitle(t, i)}, ${itemWhen(t, i, lang)}, ${itemStatus(t, i)}`),
  ]
    .filter(Boolean)
    .join('. ');

  const title = range === 'week'
    ? `${monday.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${addDays(monday, 6).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
    : anchor.toLocaleDateString(localeFor(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <Screen
      withNav
      blob="none"
      header={<TopBar large title={t('family.tabs.schedule')} below={<FocusSwitch />} right={<ReadAloudButton text={readAloud} />} />}
    >
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
        <Pressable onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel={t('family.range.previous')} style={styles.navBtn}>
          <ChevronLeft size={20} color={palette.rose600} />
        </Pressable>
        <AppText variant="headline">{title}</AppText>
        <Pressable onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel={t('family.range.next')} style={styles.navBtn}>
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
            {/* Weekday initials in her language, Monday first (the dates of the first row). */}
            {cells.slice(0, 7).map((d, i) => (
              <AppText key={i} variant="caption" tone="faint" style={styles.cell}>
                {d.toLocaleDateString(localeFor(lang), { weekday: 'narrow', timeZone: 'UTC' })}
              </AppText>
            ))}
          </View>
          {Array.from({ length: 6 }, (_, r) => (
            <View key={r} style={styles.weekHead}>
              {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
                const inMonth = d.getUTCMonth() === anchor.getUTCMonth();
                const has = items.some((it) => same(d, it.date));
                const isToday = same(d, today);
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
            subtitle={`${itemWhen(t, i, lang)}${itemPlace(t, i) ? ` · ${itemPlace(t, i)}` : ''}`}
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
