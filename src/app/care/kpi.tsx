import { StyleSheet, View } from 'react-native';
import { ClipboardCheck, GitPullRequestArrow, PhoneCall, Syringe } from 'lucide-react-native';

import { fmtDate, kpi } from '@/data/selectors';
import { useDb } from '@/data/store';
import { useNow } from '@/lib/clock';
import { AppText, BarChart, Card, HeroNumber, Screen, StatTile, TopBar, space } from '@/ui';

const pct = (v: number | null) => (v == null ? '—' : String(Math.round(v * 100)));

/**
 * CT-81 KPI (PRD §18). Primary: on-time completion of scheduled maternal & newborn visits.
 * Computed live from task events — in the demo, on synthetic data.
 */
export default function Kpi() {
  const db = useDb();
  const now = useNow();
  const r = kpi(db, now);

  return (
    <Screen blobCenterY={170} header={<TopBar back title="KPI" />}>
      <HeroNumber caption="On-time visits · last 8 weeks" value={pct(r.onTimeRate)} suffix="%" subtitle="ANC, postnatal & newborn visits completed within their window" />

      <Card style={{ gap: space.sm }}>
        <AppText variant="title">By week</AppText>
        <BarChart bars={r.weeks.map((w, i) => ({ label: fmtDate(w.start).split(' ')[0]!, value: w.rate, highlight: i === r.weeks.length - 1 }))} average={r.onTimeRate} />
        <AppText variant="caption" tone="faint">
          Each bar: visits due that week that were completed on time ÷ visits due (once completed or past their grace period). Label = week starting.
        </AppText>
      </Card>

      <AppText variant="title">Secondary</AppText>
      <View style={styles.tiles}>
        <StatTile icon={ClipboardCheck} label="ANC completeness" value={pct(r.completeness)} unit="%" caption="Checklist items recorded · 30 d" />
        <StatTile icon={PhoneCall} label="Contacted < 48 h" value={pct(r.contactWithin48h)} unit="%" caption="Late/missed visits" />
      </View>
      <View style={styles.tiles}>
        <StatTile icon={Syringe} label="Vaccines on time" value={pct(r.vaccineTimeliness)} unit="%" caption="Within 7 days of due" />
        <StatTile icon={GitPullRequestArrow} label="Referral answer" value={r.referralMedianDays == null ? '—' : String(r.referralMedianDays)} unit="days" caption="Median to recommendations" />
      </View>
      <AppText variant="caption" tone="faint" align="center">
        Synthetic demo data. In a pilot, compared against a paper-register baseline (PRD §18.4).
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ tiles: { flexDirection: 'row', gap: space.sm } });
