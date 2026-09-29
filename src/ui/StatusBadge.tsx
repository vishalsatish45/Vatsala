import { CircleCheck, Clock3, CircleAlert, CircleX, Circle, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { statusColor, type TaskStatus } from './tokens';

const icons: Record<TaskStatus, LucideIcon> = {
  done: CircleCheck,
  due: Clock3,
  overdue: CircleAlert,
  missed: CircleX,
  upcoming: Circle,
};

/**
 * Operational task status — icon + word + colour, never colour alone.
 * Accepts task statuses only: clinical values can never be coloured (PRD §2.2).
 */
export function StatusBadge({ status, label }: { status: TaskStatus; label: string }) {
  const Icon = icons[status];
  const color = statusColor[status];
  return (
    <View style={styles.row} accessibilityLabel={label}>
      <Icon size={14} color={color} strokeWidth={2.2} />
      <AppText variant="caption" style={{ color }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
