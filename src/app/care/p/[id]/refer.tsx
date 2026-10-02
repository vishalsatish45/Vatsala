import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller } from 'react-hook-form';

import { DEPARTMENTS, tagLabel } from '@/data/catalogue';
import { asPregnancyId } from '@/data/ids';
import { activeTags, gaLabel, motherOf } from '@/data/selectors';
import { useDb } from '@/data/store';
import type { PregnancyId } from '@/data/types';
import { URGENCY, referSchema } from '@/features/care/forms';
import { useActor } from '@/features/care/nav';
import { useNow } from '@/lib/clock';
import { firstError, useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, space } from '@/ui';

/** CT-51 New referral with an auto-attached context bundle (PRD F-17). */
export default function NewReferral() {
  const id = asPregnancyId(useLocalSearchParams<{ id: string }>().id);
  return <ReferralForm key={id} id={id} />;
}

function ReferralForm({ id }: { id: PregnancyId }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const { control, handleSubmit } = useZodForm(referSchema, { defaultValues: { dept: undefined, urgency: 'Routine', reason: '', question: '' } });
  const { busy, once } = useSubmitOnce();

  const send = handleSubmit(
    once((r) => {
      const rid = db.createReferral({ pregnancyId: p.id, ...r }, by, now);
      router.replace({ pathname: '/care/referral/[id]', params: { id: rid } });
    }),
    (errors) => Alert.alert('Missing details', firstError(errors) ?? ''),
  );

  return (
    <Screen blob="none" header={<TopBar back title="New referral" />} footer={<Button label="Send referral" disabled={busy} onPress={send} />}>
      <AppText variant="display">Refer {m.name}</AppText>
      <Card style={{ gap: space.md }}>
        <Controller control={control} name="dept" render={({ field }) => <OptionChips label="Department" options={DEPARTMENTS} value={field.value} onChange={field.onChange} />} />
        <Controller control={control} name="urgency" render={({ field }) => <OptionChips label="Urgency (your choice)" options={Object.keys(URGENCY)} value={field.value} onChange={(v) => v && field.onChange(v)} />} />
        <Controller control={control} name="reason" render={({ field }) => <Field label="Reason" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Palpitations reported" multiline />} />
        <Controller
          control={control}
          name="question"
          render={({ field }) => <Field label="Question to answer" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="e.g. Fitness for vaginal delivery?" multiline />}
        />
      </Card>
      <Card style={{ gap: 6 }}>
        <AppText variant="headline">Attached context</AppText>
        <AppText variant="caption" tone="secondary">
          {p.mchId} · {gaLabel(p, now)} · G{p.gpla.g}P{p.gpla.p}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Tags: {activeTags(db, p.id).map((t) => tagLabel(t.code)).join(', ') || 'none'}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Documented conditions: {p.history.conditions.join(', ') || 'none'}
        </AppText>
      </Card>
      <View style={{ height: 8 }} />
    </Screen>
  );
}
