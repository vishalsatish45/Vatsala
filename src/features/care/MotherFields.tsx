import { useState } from 'react';
import { View } from 'react-native';
import { Controller, type Control, type FieldPath } from 'react-hook-form';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import type { MotherDetails } from '@/data/payloads';
import { EC_RELATIONS, LANGUAGES, type MotherForm } from '@/features/care/forms';
import { AppText, Card, Chip, Field, InfoRow, OptionChips, space } from '@/ui';

type Recorded = { rchId?: string; abhaNumber?: string; abhaAddress?: string };

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * A mother's details as one form section (registration step 1, "Edit details"). Required: name, age, mobile and
 * language; everything else is optional and only sent when entered. RCH / ABHA ids already on record are shown, not
 * edited (the server adds an id once and never overwrites one).
 */
export function MotherFields({
  control,
  recorded = {},
  phoneHint,
  onPhoneComplete,
  moreOpen = false,
}: {
  control: Control<MotherForm, unknown, MotherDetails>;
  recorded?: Recorded;
  phoneHint?: string;
  /** Called with a complete 10-digit number as it is typed (registration looks a returning mother up). */
  onPhoneComplete?: (phone: string) => void;
  moreOpen?: boolean;
}) {
  const [more, setMore] = useState(moreOpen);
  const text = (name: FieldPath<MotherForm>, label: string, opts: { unit?: string; numeric?: boolean; max?: number; placeholder?: string; flex?: boolean; hint?: string; onComplete?: (v: string) => void } = {}) => (
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
          keyboardType={opts.numeric ? 'number-pad' : 'default'}
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

  return (
    <>
      <Card style={{ gap: space.md }}>
        <AppText variant="title">Mother</AppText>
        {text('phone', 'Mobile (used for her login)', { numeric: true, max: 10, hint: phoneHint ?? 'She logs in with this number and an OTP.', onComplete: onPhoneComplete })}
        {text('name', 'Full name', { placeholder: 'e.g. Asha R' })}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {text('age', 'Age', { unit: 'yrs', numeric: true, max: 2, flex: true })}
          {text('village', 'Village / area', { flex: true })}
        </View>
        <Controller control={control} name="lang" render={({ field }) => <OptionChips label="Preferred language" options={Object.keys(LANGUAGES)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Emergency contact (optional)</AppText>
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

      <Card style={{ gap: space.md }}>
        <Chip label={more ? 'Fewer details' : 'More details (RCH id, address, ABHA …)'} icon={more ? ChevronUp : ChevronDown} onPress={() => setMore((x) => !x)} />
        {more && (
          <>
            {recorded.rchId ? <InfoRow label="RCH id" value={recorded.rchId} /> : text('rchId', 'RCH id (12 digits)', { numeric: true, max: 12 })}
            {text('husbandName', "Husband's name")}
            {text('altPhone', 'Alternate mobile', { numeric: true, max: 10 })}
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {text('dobText', 'Date of birth', { placeholder: 'DD-MM-YYYY', flex: true })}
              <Controller
                control={control}
                name="dobEstimated"
                render={({ field }) => (
                  <View style={{ justifyContent: 'flex-end', paddingBottom: 6 }}>
                    <Chip label="Estimated" variant={field.value ? 'selected' : 'soft'} onPress={() => field.onChange(!field.value)} />
                  </View>
                )}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {text('district', 'District', { flex: true })}
              {text('state', 'State', { flex: true })}
            </View>
            {text('pincode', 'PIN code', { numeric: true, max: 6 })}
            {recorded.abhaNumber ? <InfoRow label="ABHA number" value={recorded.abhaNumber} /> : text('abhaNumber', 'ABHA number (14 digits)', { numeric: true, max: 14 })}
            {recorded.abhaAddress ? <InfoRow label="ABHA address" value={recorded.abhaAddress} /> : text('abhaAddress', 'ABHA address', { placeholder: 'name@abdm' })}
          </>
        )}
      </Card>
    </>
  );
}
