import { useState } from 'react';
import { View } from 'react-native';
import { CalendarDays } from 'lucide-react-native';

import { DatePicker } from './DatePicker';
import { Field } from './Field';
import { PressableScale } from './PressableScale';
import { parse, plausibleDigits, toText, withDashes } from './dateDigits';
import { palette, space } from './tokens';

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

/**
 * A date typed as DD-MM-YYYY or picked on the calendar (the icon opens it). Both stay in step: picking fills the box,
 * a complete typed date moves the calendar.
 */
export function DateField({ label, value, onChange, initial, yearNav, hint, error }: Props) {
  const [text, setText] = useState(value ? toText(value) : '');
  const [calendar, setCalendar] = useState(false);

  // A value set from outside (the calendar, a restored draft, a returning mother) shows in the box.
  const [seen, setSeen] = useState(value);
  const digitsOf = (s: string) => s.replace(/\D/g, '').slice(0, 8);
  if (value?.getTime() !== seen?.getTime()) {
    setSeen(value);
    if (value && parse(withDashes(digitsOf(text)))?.getTime() !== value.getTime()) setText(toText(value));
  }

  function type(raw: string) {
    const digits = digitsOf(raw);
    // Typing at the end: dashes are added as the digits arrive, and a day over 31 or a month over 12 is not taken.
    // An edit in the middle is kept exactly as typed (so the cursor stays where it is); it is tidied on leaving the box.
    const atEnd = raw.startsWith(text) && raw.length > text.length;
    if (atEnd && !plausibleDigits(digits)) return;
    setText(atEnd ? withDashes(digits) : raw.replace(/[^\d-]/g, '').slice(0, 10));
    const d = digits.length === 8 ? parse(withDashes(digits)) : undefined;
    if (d) onChange(d);
    else if (value) onChange(undefined);
  }

  const typed = digitsOf(text);
  const incomplete = typed.length > 0 && typed.length < 8;
  const impossible = typed.length === 8 && !parse(withDashes(typed));

  return (
    <View style={{ gap: space.sm }}>
      <Field
        label={label}
        value={text}
        onChangeText={type}
        onBlur={() => setText(withDashes(typed))}
        placeholder="DD-MM-YYYY"
        keyboardType="number-pad"
        maxLength={10}
        hint={impossible ? undefined : (incomplete ? 'Type it as DD-MM-YYYY' : hint)}
        error={impossible ? 'Not a real date' : error}
        accessory={
          <PressableScale onPress={() => setCalendar((c) => !c)} accessibilityRole="button" accessibilityLabel={calendar ? 'Hide calendar' : 'Pick on a calendar'} hitSlop={10}>
            <CalendarDays size={22} color={calendar ? palette.rose600 : palette.inkSoft} />
          </PressableScale>
        }
      />
      {calendar && <DatePicker key={value ? `${value.getFullYear()}-${value.getMonth()}` : 'none'} value={value} initial={initial} yearNav={yearNav} onChange={(d) => onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate()))} />}
    </View>
  );
}
