import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from 'react-native-svg';

import { AppText } from './AppText';
import { palette } from './tokens';

type Point = { at: Date; value: number };

const H = 110;

/**
 * Documented values over time (inspiration B hatched area). Neutral ink only — no bands,
 * thresholds or colours that would interpret the values (PRD §2.2).
 */
export function TrendLine({ points, fmt, unit }: { points: Point[]; fmt: (d: Date) => string; unit?: string }) {
  const [w, setW] = useState(0);
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const t0 = sorted[0]!.at.getTime();
  const t1 = sorted[sorted.length - 1]!.at.getTime();
  const vals = sorted.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.2 || 1;
  const x = (d: Date) => (t1 === t0 ? 0 : ((d.getTime() - t0) / (t1 - t0)) * (w - 16) + 8);
  const y = (v: number) => H - 10 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 20);
  const d = sorted.map((p, i) => `${i ? 'L' : 'M'} ${x(p.at)} ${y(p.value)}`).join(' ');
  const area = `${d} L ${x(sorted[sorted.length - 1]!.at)} ${H} L ${x(sorted[0]!.at)} ${H} Z`;

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={H}>
          <Defs>
            <Pattern id="tlhatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <Line x1="0" y1="0" x2="0" y2="6" stroke={palette.inkFaint} strokeWidth="1.5" strokeOpacity="0.35" />
            </Pattern>
          </Defs>
          <Rect x="0" y="0" width={w} height={H} fill="transparent" />
          <Path d={area} fill="url(#tlhatch)" />
          <Path d={d} stroke={palette.ink} strokeWidth={2} fill="none" strokeLinejoin="round" />
          {sorted.map((p, i) => (
            <Circle key={i} cx={x(p.at)} cy={y(p.value)} r={3.5} fill={palette.white} stroke={palette.ink} strokeWidth={1.5} />
          ))}
        </Svg>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="caption" tone="faint">
          {fmt(sorted[0]!.at)} · {sorted[0]!.value}
          {unit}
        </AppText>
        <AppText variant="caption" tone="faint">
          {fmt(sorted[sorted.length - 1]!.at)} · {sorted[sorted.length - 1]!.value}
          {unit}
        </AppText>
      </View>
    </View>
  );
}
