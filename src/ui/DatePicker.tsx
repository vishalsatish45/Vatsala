import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette, radius } from './tokens';

type Props = {
  value: Date;
  onChange: (d: Date) => void;
  /** Days before this (by calendar day) can't be picked. */
  minDate?: Date;
  locale?: string;
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Month calendar, Monday first. Pure JS so it needs no native module and looks the same on
 * every platform. The picked date keeps the time of day of `value`.
 */
export function DatePicker({ value, onChange, minDate, locale = 'en-IN' }: Props) {
  const [month, setMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const min = minDate && startOfDay(minDate);
  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | undefined)[] = [...Array(firstWeekday).fill(undefined), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(undefined);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const canGoBack = !min || new Date(month.getFullYear(), month.getMonth(), 0) >= min;

  const pick = (day: number) => {
    const d = new Date(month.getFullYear(), month.getMonth(), day, value.getHours(), value.getMinutes());
    onChange(d);
  };
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <PressableScale onPress={() => canGoBack && shift(-1)} accessibilityRole="button" accessibilityLabel="Previous month" style={[styles.nav, !canGoBack && { opacity: 0.3 }]}>
          <ChevronLeft size={18} color={palette.ink} />
        </PressableScale>
        <AppText variant="headline">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</AppText>
        <PressableScale onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="Next month" style={styles.nav}>
          <ChevronRight size={18} color={palette.ink} />
        </PressableScale>
      </View>
      <View style={styles.week}>
        {WEEKDAYS.map((w, i) => (
          <AppText key={i} variant="caption" tone="faint" align="center" style={styles.cell}>
            {w}
          </AppText>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.week}>
          {week.map((day, di) => {
            if (!day) return <View key={di} style={styles.cell} />;
            const date = new Date(month.getFullYear(), month.getMonth(), day);
            const disabled = !!min && date < min;
            const selected = sameDay(date, value);
            return (
              <PressableScale
                key={di}
                onPress={() => !disabled && pick(day)}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
                style={[styles.cell, styles.day, selected && styles.selected]}
              >
                <AppText variant="label" style={{ color: selected ? palette.white : disabled ? palette.inkFaint : palette.ink }}>
                  {day}
                </AppText>
              </PressableScale>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  nav: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: palette.softBorder },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center' },
  day: { height: 40, justifyContent: 'center', borderRadius: radius.pill },
  selected: { backgroundColor: palette.ink },
});
