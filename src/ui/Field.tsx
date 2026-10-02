import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from './AppText';
import { families } from './fonts';
import { palette, radius, space } from './tokens';

type Props = TextInputProps & {
  label: string;
  unit?: string;
  hint?: string;
  error?: string;
  flex?: boolean;
  /** Trailing control inside the box, after the unit (e.g. a voice-typing mic). */
  accessory?: ReactNode;
};

/** Labelled glass input. Numeric fields show a unit suffix (DESIGN.md §4 Field/NumericField). */
export function Field({ label, unit, hint, error, flex, accessory, style, ...input }: Props) {
  return (
    <View style={[styles.wrap, flex && { flex: 1 }]}>
      <AppText variant="label" tone="secondary">
        {label}
      </AppText>
      <View style={[styles.box, !!error && styles.boxError]}>
        <TextInput placeholderTextColor={palette.inkFaint} style={[styles.input, style]} accessibilityLabel={label} {...input} />
        {!!unit && (
          <AppText variant="label" tone="faint">
            {unit}
          </AppText>
        )}
        {accessory}
      </View>
      {!!(error || hint) && (
        <AppText variant="caption" tone={error ? 'overdue' : 'faint'}>
          {error ?? hint}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: palette.softBorder,
  },
  boxError: { borderColor: palette.overdue },
  input: { flex: 1, fontFamily: families.latin.medium, fontSize: 17, color: palette.ink, paddingVertical: 12 },
});
