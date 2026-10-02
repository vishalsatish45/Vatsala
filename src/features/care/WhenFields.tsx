import { View } from 'react-native';
import { Controller, type Control, type FieldValues, type Path, type PathValue, type UseFormSetValue } from 'react-hook-form';

import { dateText, timeText } from '@/features/care/forms';
import { AppText, Chip, Field, space } from '@/ui';

type Props<T extends FieldValues, TOut> = {
  control: Control<T, unknown, TOut>;
  setValue: UseFormSetValue<T>;
  /** Shown above the two fields, e.g. "Time of admission". */
  label?: string;
  /** The schema's message for this pair (it sits on `time`). */
  error?: string;
};

/**
 * Exact date and time, typed as on paper: "DD-MM-YYYY" and "HH:MM" (24-hour, the phone's local time), with
 * "Set to now". For forms whose schema spreads the `date` + `time` fields (src/features/care/forms.ts).
 */
export function WhenFields<T extends FieldValues & { date: string; time: string }, TOut>({ control, setValue, label, error }: Props<T, TOut>) {
  const setNow = () => {
    const t = new Date();
    setValue('date' as Path<T>, dateText(t) as PathValue<T, Path<T>>, { shouldValidate: true });
    setValue('time' as Path<T>, timeText(t) as PathValue<T, Path<T>>, { shouldValidate: true });
  };
  return (
    <View style={{ gap: space.sm }}>
      {!!label && (
        <AppText variant="label" tone="secondary">
          {label}
        </AppText>
      )}
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
        <Controller
          control={control}
          name={'date' as Path<T>}
          render={({ field }) => (
            <Field flex label="Date (DD-MM-YYYY)" value={String(field.value ?? '')} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="numbers-and-punctuation" />
          )}
        />
        <Controller
          control={control}
          name={'time' as Path<T>}
          render={({ field }) => (
            <Field flex label="Time (24-hour)" placeholder="HH:MM" value={String(field.value ?? '')} onChangeText={field.onChange} onBlur={field.onBlur} keyboardType="numbers-and-punctuation" />
          )}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Chip label="Set to now" onPress={setNow} />
        {!!error && (
          <AppText variant="caption" tone="overdue" style={{ flex: 1 }}>
            {error}
          </AppText>
        )}
      </View>
    </View>
  );
}
