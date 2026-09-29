import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, CircleDashed, MinusCircle, CircleAlert } from 'lucide-react-native';

import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { palette, space } from './tokens';

export type CheckState = 'done' | 'na' | 'not_done' | 'deferred' | undefined;

type Props = {
  label: string;
  state: CheckState;
  detail?: string;
  /** Action buttons (Record / N/A / Not done). */
  actions?: ReactNode;
  onPress?: () => void;
};

const icon = (s: CheckState) => {
  if (s === 'done') return <Check size={16} color={palette.white} strokeWidth={3} />;
  if (s === 'na' || s === 'deferred') return <MinusCircle size={18} color={palette.inkFaint} />;
  if (s === 'not_done') return <CircleAlert size={18} color={palette.due} />;
  return <CircleDashed size={18} color={palette.inkFaint} />;
};

/** Checklist item: ✓ done · ○ open · – N/A/deferred · ! not done (with reason) — PRD F-13, F-21. */
export function ChecklistRow({ label, state, detail, actions, onPress }: Props) {
  const body = (
    <View style={styles.row}>
      <View style={[styles.mark, state === 'done' && styles.markDone]}>{icon(state)}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyMedium" tone={state === 'na' ? 'faint' : 'primary'}>
          {label}
        </AppText>
        {!!detail && (
          <AppText variant="caption" tone="secondary">
            {detail}
          </AppText>
        )}
        {actions && <View style={styles.actions}>{actions}</View>}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} pressedScale={0.98} accessibilityRole="checkbox" accessibilityState={{ checked: state === 'done' }}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, paddingVertical: 10, alignItems: 'flex-start' },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.softBorder, backgroundColor: 'rgba(255,255,255,0.8)' },
  markDone: { backgroundColor: palette.done, borderColor: palette.done },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
});
