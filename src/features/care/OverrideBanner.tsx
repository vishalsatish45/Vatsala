import { View } from 'react-native';
import { router } from 'expo-router';
import { ShieldAlert } from 'lucide-react-native';

import { overrideActive } from '@/data/payloads';
import { fmtTime } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Id } from '@/data/types';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { useSession } from '@/state/session';
import { AppText, Chip, GlassSurface, palette, space } from '@/ui';

/** Shown on a record opened through emergency access: when it expires, and a way to end it now. */
export function OverrideBanner({ motherId }: { motherId: Id }) {
  const overrides = useDb((s) => s.overrides);
  const endOverride = useDb((s) => s.endOverride);
  const staffId = useSession((s) => s.account?.care?.staffId);
  const by = useActor();
  const now = useNow();
  const o = overrides.find((x) => x.motherId === motherId && (!x.staffId || !staffId || x.staffId === staffId) && overrideActive(x, now));
  if (!o) return null;
  return (
    <GlassSurface strong radius={16} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderWidth: 1.5, borderColor: palette.lav400 }}>
      <ShieldAlert size={20} color={palette.lav600} />
      <View style={{ flex: 1 }}>
        <AppText variant="headline">Emergency access · expires {fmtTime(o.expiresAt)}</AppText>
        <AppText variant="caption" tone="secondary" numberOfLines={2}>
          Reason: {o.reason}
        </AppText>
      </View>
      <Chip
        label="End now"
        onPress={() => {
          endOverride(o.id, by, new Date());
          if (router.canGoBack()) router.back();
        }}
      />
    </GlassSurface>
  );
}
