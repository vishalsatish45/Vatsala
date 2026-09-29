import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Chip } from './Chip';

type Single = { multi?: false; value: string | undefined; onChange: (v: string | undefined) => void };
type Multi = { multi: true; value: string[]; onChange: (v: string[]) => void };

type Props = (Single | Multi) & { label?: string; options: readonly string[]; variant?: 'soft' | 'tag' };

/** Chips instead of dropdowns — faster to tap in a busy OPD (PRD F-13). */
export function OptionChips(props: Props) {
  const { label, options, variant = 'soft' } = props;
  const selected = (o: string) => (props.multi ? props.value.includes(o) : props.value === o);
  const toggle = (o: string) => {
    if (props.multi) props.onChange(props.value.includes(o) ? props.value.filter((x) => x !== o) : [...props.value, o]);
    else props.onChange(props.value === o ? undefined : o);
  };
  return (
    <View style={styles.wrap}>
      {!!label && (
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
      )}
      <View style={styles.row}>
        {options.map((o) => (
          <Chip key={o} label={o} variant={selected(o) ? 'selected' : variant} onPress={() => toggle(o)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
