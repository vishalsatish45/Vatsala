import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Controller } from 'react-hook-form';

import { useDb } from '@/data/store';
import type { CaregiverScopes } from '@/data/types';
import { CAREGIVER_RELATIONS, caregiverSchema } from '@/features/family/forms';
import { useFamily } from '@/features/family/useFamily';
import { VoiceField } from '@/features/voice/VoiceField';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, Field, OptionChips, Screen, TopBar, palette, space } from '@/ui';

const SCOPES: (keyof CaregiverScopes)[] = ['schedule', 'baby', 'logs'];

/** FM-03 Add a family member (caregiver) with scopes the mother chooses (PRD F-05). */
export default function AddCaregiver() {
  const { t } = useTranslation();
  const now = useNow();
  const db = useDb();
  const ctx = useFamily();
  const { control, handleSubmit, formState } = useZodForm(caregiverSchema, {
    defaultValues: { name: '', relation: undefined, phone: '', scopes: { schedule: true, baby: true, logs: false } },
  });
  const { busy, once } = useSubmitOnce();
  const relLabel = (r: (typeof CAREGIVER_RELATIONS)[number]) => t(`family.me.rel.${r}`);

  const save = handleSubmit(
    once((v) => {
      if (!ctx.mother) return;
      // The care team reads English (PRD F-62).
      db.addCaregiver({ motherId: ctx.mother.id, name: v.name, relation: t(`family.me.rel.${v.relation}`, { lng: 'en' }), phone: v.phone, scopes: v.scopes }, now);
      router.back();
    }),
  );

  return (
    <Screen blob="none" header={<TopBar back title={t('family.me.add')} />} footer={<Button label={t('family.me.save')} onPress={save} disabled={!formState.isValid || busy} />}>
      <Card style={{ gap: space.md }}>
        <Controller control={control} name="name" render={({ field }) => <VoiceField label={t('family.me.name')} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
        <Controller
          control={control}
          name="relation"
          render={({ field }) => (
            <OptionChips
              label={t('family.me.relation')}
              options={CAREGIVER_RELATIONS.map(relLabel)}
              value={field.value ? relLabel(field.value) : undefined}
              onChange={(label) => field.onChange(CAREGIVER_RELATIONS.find((r) => relLabel(r) === label))}
            />
          )}
        />
        <Controller
          control={control}
          name="phone"
          render={({ field }) => <Field label={t('family.me.phone')} keyboardType="number-pad" maxLength={10} value={field.value} onChangeText={(v) => field.onChange(v.replace(/\D/g, ''))} onBlur={field.onBlur} />}
        />
      </Card>
      <Card style={{ gap: space.md }}>
        <AppText variant="headline">{t('family.me.canSee')}</AppText>
        {SCOPES.map((k) => (
          <Controller
            key={k}
            control={control}
            name={`scopes.${k}`}
            render={({ field }) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <AppText variant="bodyMedium">{t(`family.me.scope.${k}`)}</AppText>
                <Switch value={field.value} onValueChange={field.onChange} trackColor={{ true: palette.rose300, false: palette.divider }} thumbColor={field.value ? palette.rose500 : palette.white} />
              </View>
            )}
          />
        ))}
        <AppText variant="caption" tone="faint">
          {t('family.me.never')}
        </AppText>
      </Card>
    </Screen>
  );
}
