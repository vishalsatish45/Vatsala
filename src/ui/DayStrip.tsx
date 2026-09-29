import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette } from './tokens';

export type DayState = 'done' | 'missed' | 'planned' | 'none';

type Day = { date: Date; state: DayState; label: string; isToday: boolean };

const SIZE = 40;

/** Hatched fill — DESIGN.md §3.6: "hatching means not happened" (missed = red, planned = faint). */
function Hatch({ color, opacity }: { color: string; opacity: number }) {
  return (
    <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id={`h${color}${opacity}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <Line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2.4" strokeOpacity={opacity} />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width={SIZE} height={SIZE} rx={SIZE / 2} fill={`url(#h${color}${opacity})`} />
    </Svg>
  );
}

/** Week of day tokens (inspiration B): done = rose, today = amber ring + ▼, missed/planned hatched. */
export function DayStrip({ days, selected, onSelect }: { days: Day[]; selected?: number; onSelect?: (i: number) => void }) {
  return (
    <View style={styles.row}>
      {days.map((d, i) => (
        <PressableScale key={i} onPress={() => onSelect?.(i)} style={styles.col} accessibilityLabel={`${d.label} ${d.date.getDate()}`} haptic={false}>
          <AppText variant="caption" tone={d.isToday ? 'accent' : 'faint'}>
            {d.isToday ? '▼' : d.label}
          </AppText>
          <View
            style={[
              styles.token,
              d.state === 'done' && { backgroundColor: palette.rose500, borderColor: palette.rose500 },
              d.isToday && { borderColor: palette.amber, borderWidth: 2 },
              selected === i && { transform: [{ scale: 1.08 }] },
            ]}
          >
            {d.state === 'missed' && <Hatch color={palette.overdue} opacity={0.45} />}
            {d.state === 'planned' && <Hatch color={palette.rose600} opacity={0.3} />}
            <AppText variant="label" style={{ color: d.state === 'done' ? palette.white : palette.ink }}>
              {d.date.getDate()}
            </AppText>
          </View>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  col: { alignItems: 'center', gap: 6 },
  token: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.95)',
    overflow: 'hidden',
  },
});
