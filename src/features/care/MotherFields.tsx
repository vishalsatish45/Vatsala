import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Controller, useWatch, type Control, type FieldPath } from 'react-hook-form';

import type { MotherDetails } from '@/data/payloads';
import { fmtDay } from '@/data/selectors';
import { EC_RELATIONS, LANGUAGES, MARITAL_STATUSES, ageOn, calendarDay, maskedAadhaar, type MotherForm } from '@/features/care/forms';
import { AppText, Card, Chip, DatePicker, Field, InfoRow, OptionChips, space } from '@/ui';

type Recorded = { rchId?: string; abhaNumber?: string; abhaAddress?: string };

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * A mother's details as ONE card (registration step 1, "Edit details"), in this order: name · date of birth (age
 * derived; age typed only when the date is not known) · mobile · alternate mobile · email · marital status (husband's
 * name and mobile only when married) · address · ids (RCH, Aadhaar last 4 digits, ABHA) · language · emergency contact.
 * Required: name, date of birth (or age), mobile and language. RCH / ABHA ids already on record are shown, not edited
 * (the server adds an id once and never overwrites one).
 */
export function MotherFields({
  control,
  now,
  recorded = {},
  phoneHint,
  onPhoneComplete,
  afterPhone,
}: {
  control: Control<MotherForm, unknown, MotherDetails>;
  now: Date;
  recorded?: Recorded;
  phoneHint?: string;
  /** Called with a complete 10-digit number as it is typed (registration looks a returning mother up). */
  onPhoneComplete?: (phone: string) => void;
  /** Shown right under the mobile number (registration: "this number is on record here"). */
  afterPhone?: ReactNode;
}) {
  const [dob, ageOnly, marital, aadhaar] = useWatch({ control, name: ['dob', 'ageOnly', 'marital', 'aadhaarLast4'] });
  const text = (name: FieldPath<MotherForm>, label: string, opts: { unit?: string; numeric?: boolean; max?: number; placeholder?: string; flex?: boolean; hint?: string; email?: boolean; onComplete?: (v: string) => void } = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          flex={opts.flex}
          label={label}
          unit={opts.unit}
          hint={opts.hint}
          placeholder={opts.placeholder}
          keyboardType={opts.numeric ? 'number-pad' : opts.email ? 'email-address' : 'default'}
          autoCapitalize={opts.email ? 'none' : undefined}
          maxLength={opts.max}
          value={String(field.value ?? '')}
          onChangeText={(v) => {
            const next = opts.numeric ? digits(v) : v;
            field.onChange(next);
            if (opts.onComplete && /^[6-9]\d{9}$/.test(next)) opts.onComplete(next);
          }}
          onBlur={field.onBlur}
          error={fieldState.error && (fieldState.isDirty || fieldState.isTouched) ? fieldState.error.message : undefined}
        />
      )}
    />
  );
  const section = (title: string) => (
    <AppText variant="label" tone="secondary">
      {title}
    </AppText>
  );
  // A likely year to open the calendar on when nothing is picked yet (25 years ago).
  const initialDob = new Date(now.getFullYear() - 25, 0, 1);

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Mother details</AppText>

      {text('name', 'Full name', { placeholder: 'e.g. Asha R' })}

      {section('Date of birth')}
      {!ageOnly && (
        <>
          <AppText variant="bodyMedium">
            {dob ? `${fmtDay(calendarDay(dob))} · ${ageOn(calendarDay(dob), now)} yrs` : 'Tap a day (« » change the year)'}
          </AppText>
          <Controller control={control} name="dob" render={({ field }) => <DatePicker value={field.value} initial={initialDob} yearNav onChange={field.onChange} />} />
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {!ageOnly && <Controller control={control} name="dobEstimated" render={({ field }) => <Chip label="Estimated" variant={field.value ? 'selected' : 'soft'} onPress={() => field.onChange(!field.value)} />} />}
        <Controller control={control} name="ageOnly" render={({ field }) => <Chip label="Only her age is known" variant={field.value ? 'selected' : 'soft'} onPress={() => field.onChange(!field.value)} />} />
      </View>
      {ageOnly && text('age', 'Age', { unit: 'yrs', numeric: true, max: 2 })}

      {text('phone', 'Mobile (used for her login)', { numeric: true, max: 10, hint: phoneHint ?? 'She logs in with this number and an OTP.', onComplete: onPhoneComplete })}
      {afterPhone}
      {text('altPhone', 'Alternate mobile (optional)', { numeric: true, max: 10 })}
      {text('email', 'Email (optional)', { email: true, placeholder: 'name@example.com' })}

      <Controller control={control} name="marital" render={({ field }) => <OptionChips label="Marital status" options={Object.keys(MARITAL_STATUSES)} value={field.value} onChange={field.onChange} />} />
      {marital === 'Married' && (
        <>
          {text('husbandName', "Husband's name (optional)")}
          {text('husbandPhone', "Husband's mobile (optional)", { numeric: true, max: 10 })}
        </>
      )}

      {section('Address')}
      {text('addressLine', 'House / street', { placeholder: 'e.g. #12, 2nd Cross, Temple Road' })}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {text('village', 'Village / area', { flex: true })}
        {text('district', 'District', { flex: true })}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {text('state', 'State', { flex: true })}
        {text('pincode', 'PIN code', { numeric: true, max: 6, flex: true })}
      </View>

      {section('IDs (optional)')}
      {recorded.rchId ? <InfoRow label="RCH id" value={recorded.rchId} /> : text('rchId', 'RCH ID (12 digits)', { numeric: true, max: 12 })}
      {text('aadhaarLast4', 'Aadhaar (last 4 digits)', {
        numeric: true,
        max: 4,
        hint: /^\d{4}$/.test(String(aadhaar ?? '')) ? `Recorded as ${maskedAadhaar(String(aadhaar))} — never the full number` : 'Only the last 4 digits — never the full number',
      })}
      {recorded.abhaNumber ? <InfoRow label="ABHA number" value={recorded.abhaNumber} /> : text('abhaNumber', 'ABHA number (14 digits)', { numeric: true, max: 14 })}
      {recorded.abhaAddress ? <InfoRow label="ABHA address" value={recorded.abhaAddress} /> : text('abhaAddress', 'ABHA address', { placeholder: 'name@abdm' })}

      <Controller control={control} name="lang" render={({ field }) => <OptionChips label="Preferred language" options={Object.keys(LANGUAGES)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />

      {section('Emergency contact (optional)')}
      {text('ecName', 'Name')}
      {text('ecRelation', 'Relation', { placeholder: 'e.g. Husband' })}
      <Controller
        control={control}
        name="ecRelation"
        render={({ field }) => (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {EC_RELATIONS.map((r) => (
              <Chip key={r} label={r} variant={field.value === r ? 'selected' : 'soft'} onPress={() => field.onChange(field.value === r ? '' : r)} />
            ))}
          </View>
        )}
      />
      {text('ecPhone', 'Their mobile', { numeric: true, max: 10 })}
    </Card>
  );
}
