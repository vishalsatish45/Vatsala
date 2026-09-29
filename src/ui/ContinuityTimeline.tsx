import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Baby } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AppText } from './AppText';
import { palette, space } from './tokens';

export type TLEvent = {
  id: string;
  at: Date;
  lane: 'mother' | 'baby' | 'shared';
  state: 'past' | 'planned' | 'missed';
  title: string;
  sub?: string;
};

type Props = {
  events: TLEvent[];
  now: Date;
  fmt: (d: Date) => string;
  motherLabel: string;
  babyLabel: string;
  todayLabel: string;
  /** Shown as a ghost node at the end when there is no delivery yet. */
  eddLabel?: string;
  edd?: Date;
};

const RAIL = 28;
const LANE = { mother: palette.rose500, baby: palette.lav600 } as const;

function Node({ state, color }: { state: TLEvent['state']; color: string }) {
  if (state === 'past') return <View style={[styles.node, { backgroundColor: color, borderColor: color }]} />;
  if (state === 'missed') return <View style={[styles.node, { borderColor: palette.overdue, borderWidth: 2.5 }]} />;
  return <View style={[styles.node, { borderColor: color, borderStyle: 'dashed', borderWidth: 2 }]} />;
}

function Row({ e, color, fmt, rail = true, last }: { e: TLEvent; color: string; fmt: (d: Date) => string; rail?: boolean; last?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.railCol}>
        {rail && !last && <View style={[styles.rail, { backgroundColor: color + '40' }]} />}
        <Node state={e.state} color={color} />
      </View>
      <View style={[styles.text, { opacity: e.state === 'planned' ? 0.72 : 1 }]}>
        <AppText variant="label" numberOfLines={2}>
          {e.title}
        </AppText>
        <AppText variant="caption" tone={e.state === 'missed' ? 'overdue' : 'secondary'} numberOfLines={1}>
          {fmt(e.at)}
          {e.sub ? ` · ${e.sub}` : ''}
        </AppText>
      </View>
    </View>
  );
}

function Today({ label }: { label: string }) {
  return (
    <View style={styles.today}>
      <View style={styles.todayDot} />
      <AppText variant="caption" style={{ color: palette.amber }}>
        {label}
      </AppText>
      <View style={styles.todayLine} />
    </View>
  );
}

/**
 * The "wow" screen (PRD F-06, DESIGN.md §3.5): one maternal lane that splits into mother
 * and baby lanes at delivery. Future nodes are dashed (the plan), missed ones red.
 */
export function ContinuityTimeline({ events, now, fmt, motherLabel, babyLabel, todayLabel, eddLabel, edd }: Props) {
  const [w, setW] = useState(0);
  const delivery = events.find((e) => e.lane === 'shared');
  const pre = events.filter((e) => e.lane !== 'shared' && (!delivery || e.at.getTime() < delivery.at.getTime()));
  const post = delivery ? events.filter((e) => e.lane !== 'shared' && e.at.getTime() >= delivery.at.getTime()) : [];
  const t = now.getTime();
  const preTodayIdx = pre.findIndex((e) => e.at.getTime() > t);
  const postTodayIdx = post.findIndex((e) => e.at.getTime() > t);

  return (
    <View onLayout={(ev) => setW(ev.nativeEvent.layout.width)}>
      {/* ── Before delivery: one lane ── */}
      <Animated.View entering={FadeIn.duration(350)}>
        {pre.map((e, i) => (
          <View key={e.id}>
            {i === preTodayIdx && !delivery && <Today label={todayLabel} />}
            <Row e={e} color={LANE.mother} fmt={fmt} last={!delivery && i === pre.length - 1 && !edd} />
          </View>
        ))}
        {!delivery && preTodayIdx === -1 && <Today label={todayLabel} />}
        {!delivery && edd && <Row e={{ id: 'edd', at: edd, lane: 'mother', state: 'planned', title: eddLabel ?? 'EDD' }} color={LANE.baby} fmt={fmt} last />}
      </Animated.View>

      {delivery && (
        <>
          {/* ── Delivery node ── */}
          <Animated.View entering={FadeInDown.delay(150).duration(450)} style={styles.deliveryWrap}>
            <View style={[styles.stem, { left: RAIL / 2 - 1, backgroundColor: LANE.mother + '40' }]} />
            <LinearGradient colors={[palette.rose300, palette.lav400]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.deliveryNode}>
              <Baby size={24} color={palette.white} />
            </LinearGradient>
            <AppText variant="headline" align="center">
              {delivery.title}
            </AppText>
            <AppText variant="caption" tone="secondary" align="center">
              {fmt(delivery.at)}
              {delivery.sub ? ` · ${delivery.sub}` : ''}
            </AppText>
          </Animated.View>

          {/* ── The split ── */}
          {w > 0 && (
            <Animated.View entering={FadeIn.delay(350).duration(500)}>
              <Svg width={w} height={44}>
                <Path d={`M ${w / 2} 0 C ${w / 2} 26, ${RAIL / 2} 18, ${RAIL / 2} 44`} stroke={LANE.mother} strokeOpacity={0.5} strokeWidth={2} fill="none" />
                <Path d={`M ${w / 2} 0 C ${w / 2} 26, ${w / 2 + RAIL / 2} 18, ${w / 2 + RAIL / 2} 44`} stroke={LANE.baby} strokeOpacity={0.6} strokeWidth={2} fill="none" />
              </Svg>
            </Animated.View>
          )}

          {/* ── After delivery: two lanes ── */}
          <Animated.View entering={FadeInDown.delay(500).duration(450)}>
            <View style={styles.laneHeads}>
              <AppText variant="label" style={{ flex: 1, color: LANE.mother }}>
                {motherLabel}
              </AppText>
              <AppText variant="label" style={{ flex: 1, color: LANE.baby }}>
                {babyLabel}
              </AppText>
            </View>
            {post.map((e, i) => (
              <View key={e.id}>
                {i === postTodayIdx && <Today label={todayLabel} />}
                <View style={styles.split}>
                  {(['mother', 'baby'] as const).map((lane) => (
                    <View key={lane} style={styles.half}>
                      <View style={[styles.rail, styles.halfRail, { backgroundColor: LANE[lane] + '40' }]} />
                      {e.lane === lane && <Row e={e} color={LANE[lane]} fmt={fmt} rail={false} />}
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {postTodayIdx === -1 && <Today label={todayLabel} />}
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: 54 },
  railCol: { width: RAIL, alignItems: 'center' },
  rail: { position: 'absolute', top: 16, bottom: -4, width: 2, borderRadius: 1 },
  node: { width: 14, height: 14, borderRadius: 7, marginTop: 3, borderWidth: 1.5, backgroundColor: 'rgba(255,255,255,0.9)' },
  text: { flex: 1, paddingBottom: space.md, paddingRight: 4, gap: 1 },
  deliveryWrap: { alignItems: 'center', gap: 2, paddingTop: space.xs },
  stem: { position: 'absolute', top: -8, height: 20, width: 2 },
  deliveryNode: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: palette.white, marginBottom: 4 },
  laneHeads: { flexDirection: 'row', marginBottom: space.xs },
  split: { flexDirection: 'row' },
  half: { flex: 1, minHeight: 54 },
  halfRail: { left: RAIL / 2 - 1, top: 0, bottom: 0 },
  today: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 6, marginLeft: RAIL / 2 - 5 },
  todayDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.amber },
  todayLine: { flex: 1, height: 1.5, backgroundColor: palette.amber, opacity: 0.4 },
});
