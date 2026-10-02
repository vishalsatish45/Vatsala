import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { GlassSurface } from './GlassSurface';
import { palette, radius, space } from './tokens';

type Props = {
  label: string;
  value: string;
  unit?: string;
  icon?: LucideIcon;
  /** e.g. "28 Sep" — every clinical number carries its date. */
  caption?: string;
  /** "Home reading" etc. */
  badge?: string;
};

/**
 * Glass tile with a centred label and an oversized number + small unit
 * (inspiration A: "Length: 30cm · Weight: 800g").
 * Deliberately has NO status/colour prop: documented clinical values are always
 * shown in neutral ink and never interpreted (PRD §2.2, DESIGN.md §4).
 */
export function StatTile({ icon: Icon, label, value, unit, caption, badge }: Props) {
  return (
    <GlassSurface radius={radius.lg} elevation="card" style={styles.tile}>
      <View style={styles.head}>
        {Icon && <Icon size={14} color={palette.rose600} strokeWidth={2} />}
        <AppText variant="label" tone="secondary" numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <View style={styles.valueRow}>
        <AppText variant="stat" numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
        {!!unit && (
          <AppText variant="caption" tone="secondary" style={styles.unit}>
            {unit}
          </AppText>
        )}
      </View>
      {(!!caption || !!badge) && (
        <View style={styles.foot}>
          {!!caption && (
            <AppText variant="caption" tone="faint">
              {caption}
            </AppText>
          )}
          {!!badge && (
            <View style={styles.badge}>
              <AppText variant="caption" tone="secondary">
                {badge}
              </AppText>
            </View>
          )}
        </View>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, paddingVertical: space.sm, paddingHorizontal: space.sm, alignItems: 'center', gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  unit: { marginBottom: 4, marginLeft: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: palette.softBorder, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
});
