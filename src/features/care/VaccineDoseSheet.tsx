import { Alert } from 'react-native';
import { Controller, useWatch } from 'react-hook-form';
import { daysBetween } from '@domain/gestation';

import { fmtDay } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Baby, Immunization } from '@/data/types';
import { VACCINE_NOT_GIVEN_REASONS, VACCINE_ROUTES, VACCINE_SITES, dateText, makeVaccineDoseSchema, type VaccineDoseForm } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Field, OptionChips, SegmentedPills, Sheet } from '@/ui';

const WHERE = { 'Given here': 'here', 'Elsewhere / from card': 'elsewhere' } as const;

/**
 * Record one dose as documented (server `record_vaccine`): given on a date (default today; before the due date is
 * allowed), here or reported from a card / another facility, with batch, expiry, manufacturer, site and route — or
 * not given, with a reason. Recording closes the reminder in the family's app.
 */
export function VaccineDoseSheet({ dose, baby, onClose }: { dose?: Immunization; baby: Baby; onClose: () => void }) {
  return dose ? <DoseForm key={dose.id} dose={dose} baby={baby} onClose={onClose} /> : null;
}

function DoseForm({ dose, baby, onClose }: { dose: Immunization; baby: Baby; onClose: () => void }) {
  const recordVaccine = useDb((s) => s.recordVaccine);
  const by = useActor();
  const now = useNow();
  const { control, handleSubmit, setValue } = useZodForm(makeVaccineDoseSchema(now, baby.dob), {
    defaultValues: {
      outcome: 'given', givenOn: dateText(now), where: 'here', location: '', batch: '', expiry: '', manufacturer: '', site: undefined, route: undefined,
      reason: undefined, reasonOther: '',
    } satisfies VaccineDoseForm,
  });
  const v = useWatch({ control }) as VaccineDoseForm;
  const { busy, once } = useSubmitOnce();
  const early = daysBetween(now, dose.dueOn) > 0;

  const save = handleSubmit(
    once((input) => {
      recordVaccine(dose.id, input, by, now);
      onClose();
    }),
    (errors) => Alert.alert('Check the dose', firstError(errors) ?? ''),
  );

  const text = (name: 'givenOn' | 'location' | 'batch' | 'expiry' | 'manufacturer' | 'reasonOther', label: string, placeholder?: string) => (
    <Controller control={control} name={name} render={({ field }) => <Field label={label} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder={placeholder} />} />
  );

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Record ${dose.label}`}
      subtitle={`${dose.group} · due ${fmtDay(dose.dueOn)}`}
      footer={
        <>
          <Button label={v.outcome === 'not_given' ? 'Record as not given' : 'Record dose'} disabled={busy} onPress={save} />
          <Button variant="secondary" label="Cancel" onPress={onClose} />
        </>
      }
    >
      <SegmentedPills
        options={[{ value: 'given', label: 'Given' }, { value: 'not_given', label: 'Not given' }]}
        value={v.outcome}
        onChange={(o: 'given' | 'not_given') => setValue('outcome', o, { shouldValidate: true })}
      />
      {v.outcome === 'given' ? (
        <>
          {early && <AppText variant="caption" tone="secondary">This dose is due on {fmtDay(dose.dueOn)}. A dose given earlier is recorded with the date it was given.</AppText>}
          {text('givenOn', 'Date given (DD-MM-YYYY)')}
          <OptionChips label="Where" options={Object.keys(WHERE)} value={Object.keys(WHERE).find((k) => WHERE[k as keyof typeof WHERE] === v.where)} onChange={(k) => k && setValue('where', WHERE[k as keyof typeof WHERE], { shouldValidate: true })} />
          {v.where === 'elsewhere' && text('location', 'Where it was given', 'e.g. Sub-centre, from the MCP card')}
          {text('batch', 'Batch / lot (optional)')}
          {text('expiry', 'Expiry (DD-MM-YYYY, optional)')}
          {text('manufacturer', 'Manufacturer (optional)')}
          <Controller control={control} name="site" render={({ field }) => <OptionChips label="Site" options={VACCINE_SITES} value={field.value} onChange={field.onChange} />} />
          <Controller control={control} name="route" render={({ field }) => <OptionChips label="Route (empty: the vaccine's usual route)" options={VACCINE_ROUTES} value={field.value} onChange={field.onChange} />} />
        </>
      ) : (
        <>
          <Controller control={control} name="reason" render={({ field }) => <OptionChips label="Reason" options={VACCINE_NOT_GIVEN_REASONS} value={field.value} onChange={field.onChange} />} />
          {v.reason === 'Other' && text('reasonOther', 'Reason (recorded)')}
        </>
      )}
    </Sheet>
  );
}
