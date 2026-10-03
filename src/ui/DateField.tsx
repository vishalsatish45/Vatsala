import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';

import { AppText } from './AppText';
import { DatePicker } from './DatePicker';
import { families } from './fonts';
import { PressableScale } from './PressableScale';
import { parse, plausibleDigits } from './dateDigits';
import { palette, radius, space } from './tokens';

type Props = {
  label: string;
  /** A local-midnight date (as DatePicker gives); undefined = not entered. */
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  /** Month the calendar opens on when nothing is entered. */
  initial?: Date;
  /** Year jumps in the calendar (a date of birth). */
  yearNav?: boolean;
  hint?: string;
  error?: string;
};

type Parts = { dd: string; mm: string; yyyy: string };
const pad = (n: number) => String(n).padStart(2, '0');
const partsOf = (d: Date | undefined): Parts => (d ? { dd: pad(d.getDate()), mm: pad(d.getMonth() + 1), yyyy: String(d.getFullYear()) } : { dd: '', mm: '', yyyy: '' });
const dateOf = (p: Parts) => (p.dd && p.mm && p.yyyy.length === 4 ? parse(`${p.dd.padStart(2, '0')}-${p.mm.padStart(2, '0')}-${p.yyyy}`) : undefined);

/**
 * A date as three small boxes — DD · MM · YYYY — or picked on the calendar (the icon opens it). Each box takes digits
 * only (no dashes to edit); two digits move on to the next box and backspace in an empty box goes back. A day over 31
 * or a month over 12 is not taken; an impossible date (31-02) is shown as not a real date.
 */
export function DateField({ label, value, onChange, initial, yearNav, hint, error }: Props) {
  const [parts, setParts] = useState<Parts>(() => partsOf(value));
  const [calendar, setCalendar] = useState(false);
  const mmRef = useRef<TextInput>(null);
  const yyyyRef = useRef<TextInput>(null);
  const ddRef = useRef<TextInput>(null);

  // A value set from outside (the calendar, a restored draft, a returning mother) shows in the boxes.
  const [seen, setSeen] = useState(value);
  if (value?.getTime() !== seen?.getTime()) {
    setSeen(value);
    if (value && dateOf(parts)?.getTime() !== value.getTime()) setParts(partsOf(value));
  }

  function set(next: Parts) {
    setParts(next);
    const d = dateOf(next);
    if (d) onChange(d);
    else if (value) onChange(undefined);
  }

  const typeDay = (raw: string) => {
    const dd = raw.replace(/\D/g, '').slice(0, 2);
    if (!plausibleDigits(dd)) return;
    set({ ...parts, dd });
    if (dd.length === 2) mmRef.current?.focus();
  };
  const typeMonth = (raw: string) => {
    const mm = raw.replace(/\D/g, '').slice(0, 2);
    if (!plausibleDigits(`01${mm}`)) return;
    set({ ...parts, mm });
    if (mm.length === 2) yyyyRef.current?.focus();
  };
  const typeYear = (raw: string) => set({ ...parts, yyyy: raw.replace(/\D/g, '').slice(0, 4) });

  const filled = !!(parts.dd && parts.mm && parts.yyyy.length === 4);
  const started = !!(parts.dd || parts.mm || parts.yyyy);
  const impossible = filled && !dateOf(parts);
  const shownError = impossible ? 'Not a real date' : error;
  const shownHint = impossible ? undefined : started && !filled ? 'Day, month and the 4-digit year' : hint;

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 6 }}>
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
        <View style={[styles.box, !!shownError && styles.boxError]}>
          <Part inputRef={ddRef} value={parts.dd} onText={typeDay} placeholder="DD" max={2} label={label} />
          <AppText tone="faint">-</AppText>
          <Part inputRef={mmRef} value={parts.mm} onText={typeMonth} placeholder="MM" max={2} label={label} onBackEmpty={() => ddRef.current?.focus()} />
          <AppText tone="faint">-</AppText>
          <Part inputRef={yyyyRef} value={parts.yyyy} onText={typeYear} placeholder="YYYY" max={4} label={label} onBackEmpty={() => mmRef.current?.focus()} wide />
          <View style={{ flex: 1 }} />
          <PressableScale onPress={() => setCalendar((c) => !c)} accessibilityRole="button" accessibilityLabel={calendar ? 'Hide calendar' : 'Pick on a calendar'} hitSlop={10}>
            <CalendarDays size={22} color={calendar ? palette.rose600 : palette.inkSoft} />
          </PressableScale>
        </View>
        {!!(shownError || shownHint) && (
          <AppText variant="caption" tone={shownError ? 'overdue' : 'faint'}>
            {shownError ?? shownHint}
          </AppText>
        )}
      </View>
      {calendar && <DatePicker key={value ? `${value.getFullYear()}-${value.getMonth()}` : 'none'} value={value} initial={initial} yearNav={yearNav} onChange={(d) => onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate()))} />}
    </View>
  );
}

/** One box of a DateField: digits only; backspace in an empty box goes back to the previous one. */
function Part(props: {
  inputRef: React.RefObject<TextInput | null>;
  value: string;
  onText: (s: string) => void;
  placeholder: string;
  max: number;
  label: string;
  onBackEmpty?: () => void;
  wide?: boolean;
}) {
  const { inputRef, value, onText, placeholder, max, label, onBackEmpty, wide } = props;
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={onText}
      onKeyPress={(e) => {
        if (e.nativeEvent.key === 'Backspace' && value === '') onBackEmpty?.();
      }}
      placeholder={placeholder}
      placeholderTextColor={palette.inkFaint}
      keyboardType="number-pad"
      maxLength={max}
      selectTextOnFocus
      accessibilityLabel={`${label}: ${placeholder}`}
      style={[styles.part, wide && styles.year]}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: palette.softBorder,
  },
  boxError: { borderColor: palette.overdue },
  part: { width: 40, textAlign: 'center', fontFamily: families.latin.medium, fontSize: 17, color: palette.ink, paddingVertical: 12 },
  year: { width: 62 },
});
