import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { Sparkles } from './illustrations';
import { palette, space } from './tokens';

/** Line illustration + serif line + one action (DESIGN.md §4 EmptyState). */
export function EmptyState({ title, body, icon: Icon, actionLabel, onAction }: { title: string; body?: string; icon?: LucideIcon; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg }}>
      {Icon ? <Icon size={48} color={palette.rose300} strokeWidth={1.3} /> : <Sparkles size={64} color={palette.rose300} />}
      <AppText variant="title" align="center">
        {title}
      </AppText>
      {!!body && (
        <AppText tone="secondary" align="center">
          {body}
        </AppText>
      )}
      {!!actionLabel && (
        <View style={{ alignSelf: 'stretch', marginTop: space.xs }}>
          <Button variant="secondary" label={actionLabel} onPress={onAction} />
        </View>
      )}
    </View>
  );
}
