import { useMemo } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { asPregnancyId } from '@/data/ids';
import { motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import { canEditMother, useCareMe } from '@/features/care/CareTeam';
import { makeMotherSchema, motherFormValues } from '@/features/care/forms';
import { MotherFields } from '@/features/care/MotherFields';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Screen, TopBar } from '@/ui';

/**
 * CT-20 "Edit details": the treating obstetrician corrects a mother's details (update_mother — only the changed
 * fields are sent, version-checked and audited). A corrected mobile number moves her login to it. RCH / ABHA ids
 * can be added once; a recorded id is shown, not edited.
 */
export default function EditMotherDetails() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const me = useCareMe();
  const p = db.pregnancies.find((x) => x.id === id);
  if (!p) return <Screen header={<TopBar back title="Edit details" />}><AppText>Not found.</AppText></Screen>;
  const m = motherOf(db, p.motherId);
  if (!canEditMother(db, me, m.id)) {
    return (
      <Screen header={<TopBar back title="Edit details" />}>
        <AppText tone="secondary">Only an obstetrician of her current obstetric team can correct her details.</AppText>
      </Screen>
    );
  }
  return <DetailsForm key={m.id} motherId={m.id} />;
}

function DetailsForm({ motherId }: { motherId: ReturnType<typeof motherOf>['id'] }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const m = motherOf(db, motherId);
  const schema = useMemo(() => makeMotherSchema(now), [now]);
  const { control, handleSubmit, formState } = useZodForm(schema, { defaultValues: motherFormValues(m) });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((details) => {
      db.updateMother(m.id, details, by, now);
      router.back();
    }),
  );
  const problem = firstError(formState.errors);

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Edit details" />}
      footer={<Button label="Save corrections" disabled={busy || !formState.isValid} onPress={save} />}
    >
      <AppText tone="secondary">Correct what is wrong. Only the fields you change are saved, and the change is recorded in the audit trail.</AppText>
      <MotherFields control={control} moreOpen recorded={{ rchId: m.rchId, abhaNumber: m.abhaNumber, abhaAddress: m.abhaAddress }} phoneHint="She signs in with this number. Changing it moves her login to the new number." />
      {!!problem && (
        <AppText variant="caption" tone="overdue">
          {problem}
        </AppText>
      )}
    </Screen>
  );
}
