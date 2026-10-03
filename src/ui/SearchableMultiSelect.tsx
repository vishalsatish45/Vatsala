import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, Plus, Search, X } from 'lucide-react-native';

import { AppText } from './AppText';
import { Button } from './Button';
import { Chip } from './Chip';
import { Field } from './Field';
import { Sheet } from './Sheet';
import { palette, radius, space } from './tokens';

export type SelectOption = { value: string; label: string; group?: string };

type Props = {
  /** Sheet title and the add button's noun, e.g. "risk factors". */
  noun: string;
  options: readonly SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
};

/**
 * Multi-select as removable chips plus a searchable checklist in a bottom sheet (long option lists, e.g. risk
 * factors). Nothing is pre-selected; the order of `value` follows the user's picks.
 */
export function SearchableMultiSelect({ noun, options, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = options.filter((o) => !q || o.label.toLowerCase().includes(q) || o.group?.toLowerCase().includes(q));
    const out = new Map<string, SelectOption[]>();
    for (const o of hits) out.set(o.group ?? '', [...(out.get(o.group ?? '') ?? []), o]);
    return [...out.entries()];
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View style={{ gap: space.sm }}>
      {value.length > 0 && (
        <View style={styles.chips}>
          {value.map((v) => (
            <Chip key={v} label={labelOf(v)} icon={X} variant="selected" onPress={() => toggle(v)} />
          ))}
        </View>
      )}
      <Chip label={value.length ? `Add or change ${noun}` : `Add ${noun}`} icon={Plus} onPress={() => setOpen(true)} />

      <Sheet visible={open} onClose={close} title={`Choose ${noun}`} subtitle={value.length ? `${value.length} selected` : undefined} footer={<Button label="Done" onPress={close} />}>
        <Field label="Search" value={query} onChangeText={setQuery} placeholder={`Search ${noun}`} autoCorrect={false} accessory={<Search size={18} color={palette.inkFaint} />} />
        {groups.length === 0 && (
          <AppText tone="secondary">No {noun} match “{query.trim()}”.</AppText>
        )}
        {groups.map(([group, items]) => (
          <View key={group} style={{ gap: 4 }}>
            {!!group && (
              <AppText variant="label" tone="secondary" style={{ marginTop: space.xs }}>
                {group}
              </AppText>
            )}
            {items.map((o) => {
              const on = value.includes(o.value);
              return (
                <Pressable key={o.value} onPress={() => toggle(o.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={o.label} style={[styles.row, on && styles.rowOn]}>
                  <AppText style={{ flex: 1 }}>{o.label}</AppText>
                  <View style={[styles.box, on && styles.boxOn]}>{on && <Check size={14} color={palette.white} strokeWidth={3} />}</View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 12, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.55)' },
  rowOn: { backgroundColor: palette.rose50 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: palette.inkFaint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: palette.rose600, borderColor: palette.rose600 },
});
