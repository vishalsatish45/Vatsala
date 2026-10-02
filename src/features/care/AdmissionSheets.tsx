import { Alert } from 'react-native';
import { Controller, useWatch } from 'react-hook-form';

import { fmtDay, fmtTime } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { Pregnancy } from '@/data/types';
import { ADMIT_REASONS, makeAdmitSchema, makeEndAdmissionSchema, whenDefaults } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { WhenFields } from '@/features/care/WhenFields';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Field, OptionChips, Sheet } from '@/ui';

type SheetProps = { pregnancy: Pregnancy; visible: boolean; onClose: () => void; onDone?: () => void };

/** Admit to the labour room / ward: a confirmation with the documented time (default now) and reason. */
export function AdmitSheet(props: SheetProps) {
  // a fresh form (time = now) every time the sheet opens
  return props.visible ? <AdmitForm key={String(props.visible)} {...props} /> : null;
}

function AdmitForm({ pregnancy, visible, onClose, onDone }: SheetProps) {
  const admit = useDb((s) => s.admit);
  const by = useActor();
  const now = useNow();
  const { control, handleSubmit, setValue, formState } = useZodForm(makeAdmitSchema(now), { defaultValues: { ...whenDefaults(now), reason: '' } });
  const { busy, once } = useSubmitOnce();
  const reason = useWatch({ control, name: 'reason' });
  const save = handleSubmit(
    once((v) => {
      admit(pregnancy.id, v, by);
      onClose();
      onDone?.();
    }),
    (errors) => Alert.alert('Check the admission', firstError(errors) ?? ''),
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Admit to the labour room?"
      subtitle={`${pregnancy.mchId} · the IP number is issued on saving`}
      footer={
        <>
          <Button label="Admit" disabled={busy} onPress={save} />
          <Button variant="secondary" label="Cancel" onPress={onClose} />
        </>
      }
    >
      <WhenFields control={control} setValue={setValue} label="Time of admission" error={formState.errors.time?.message} />
      <OptionChips
        label="Reason (as documented)"
        options={ADMIT_REASONS}
        value={(ADMIT_REASONS as readonly string[]).includes(reason) ? reason : undefined}
        onChange={(v) => setValue('reason', v ?? '', { shouldValidate: true })}
      />
      <Controller control={control} name="reason" render={({ field }) => <Field label="Reason" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="Or type the reason" />} />
    </Sheet>
  );
}

/** End an admission without a delivery: a confirmation with the documented time (not before the admission). */
export function EndAdmissionSheet(props: SheetProps & { ipNo?: string }) {
  return props.visible ? <EndAdmissionForm key={String(props.visible)} {...props} /> : null;
}

function EndAdmissionForm({ pregnancy, visible, onClose, onDone, ipNo }: SheetProps & { ipNo?: string }) {
  const endAdmission = useDb((s) => s.endAdmission);
  const by = useActor();
  const now = useNow();
  const { control, handleSubmit, setValue, formState } = useZodForm(makeEndAdmissionSchema(now, pregnancy.admittedAt), { defaultValues: whenDefaults(now) });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((v) => {
      endAdmission(pregnancy.id, by, v.at);
      onClose();
      onDone?.();
    }),
    (errors) => Alert.alert('Check the time', firstError(errors) ?? ''),
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="End admission without delivery?"
      subtitle={[ipNo && `IP ${ipNo}`, pregnancy.admittedAt && `admitted ${fmtDay(pregnancy.admittedAt)} ${fmtTime(pregnancy.admittedAt)}`].filter(Boolean).join(' · ') || undefined}
      footer={
        <>
          <Button label="End admission" disabled={busy} onPress={save} />
          <Button variant="secondary" label="Keep admitted" onPress={onClose} />
        </>
      }
    >
      <AppText tone="secondary">
        For an antenatal admission that ends without a delivery (for example after observation). After a delivery, the mother’s discharge checklist closes the admission instead. Her ANC plan continues.
      </AppText>
      <WhenFields control={control} setValue={setValue} label="Time the admission ended" error={formState.errors.time?.message} />
    </Sheet>
  );
}
