import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Controller, useWatch } from 'react-hook-form';

import { useDb } from '@/data/store';
import type { SelfLogId } from '@/data/types';
import { FEEDING_CHOICES, MOVEMENT_CHOICES, blankSelfLog, selfLogSchema, selfLogValue, type SelfLogForm, type SelfLogKind } from '@/features/family/forms';
import { readingKinds } from '@/features/family/stage';
import { useFamily } from '@/features/family/useFamily';
import { VoiceField } from '@/features/voice/VoiceField';
import { useClock } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { AppText, Button, Card, OptionChips, PressableScale, palette, radius, space } from '@/ui';

/** The moment of saving (date + hh:mm, on the demo clock), not when the screen last rendered. */
const savedAt = () => new Date(Date.now() + useClock.getState().offsetDays * 86_400_000);

/**
 * The self-report form (one schema, `selfLogSchema`) shared by /family/log and the Journey Record tab.
 * `save` stores the reading once per tap and hands back its id and timestamp.
 */
export function useSelfLogForm(onSaved: (saved: { id: SelfLogId; at: Date }) => void) {
  const { t } = useTranslation();
  const db = useDb();
  const ctx = useFamily();
  // Only what this account may record (the server refuses the rest): her readings need `logs`, feeding needs `baby`
  // and a living baby; pregnancy-only kinds while pregnant (stage.ts).
  const kinds: SelfLogKind[] = readingKinds(ctx.stage, ctx.scopes);
  const { control, handleSubmit, setValue } = useZodForm(selfLogSchema, { defaultValues: { ...blankSelfLog, kind: kinds[0] ?? blankSelfLog.kind } });
  const { busy, once } = useSubmitOnce();
  const values = useWatch({ control }) as SelfLogForm;

  const save = handleSubmit(
    once((r) => {
      if (!ctx.mother || !kinds.includes(r.kind)) return;
      // Chip readings are stored as their English label; numbers exactly as typed.
      const value = r.isChoice ? t(r.value, { lng: 'en' }) : r.value;
      const at = savedAt();
      // A feeding note is for the living baby (never a stillborn baby or one who has died).
      const babyId = r.subject === 'baby' ? ctx.babies[0]?.id : undefined;
      onSaved({ id: db.addSelfLog({ motherId: ctx.mother.id, subject: r.subject, babyId, kind: r.kind, value, at, by: ctx.accountName }), at });
    }),
  );

  const chooseKind = (k: SelfLogKind) => {
    setValue('kind', k, { shouldValidate: true });
    setValue('choice', undefined, { shouldValidate: true });
  };

  // A kind this account may not record (her record loaded after the form opened) is never offered or saved.
  const allowed = kinds.includes(values.kind);
  return { control, kinds, kind: allowed ? values.kind : undefined, chooseKind, ready: allowed && !!selfLogValue(values), busy, save };
}

/** Kind picker + the inputs for the chosen kind. `minHeight` keeps each screen's original row height. */
export function SelfLogFields({ form, rowHeight }: { form: Pick<ReturnType<typeof useSelfLogForm>, 'control' | 'kinds' | 'kind' | 'chooseKind'>; rowHeight: number }) {
  const { t } = useTranslation();
  const { control, kinds, kind, chooseKind } = form;
  return (
    <>
      <View style={styles.kinds} accessibilityRole="radiogroup">
        {kinds.map((k) => {
          const active = k === kind;
          return (
            <PressableScale
              key={k}
              onPress={() => chooseKind(k)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.kind, { minHeight: rowHeight, backgroundColor: active ? palette.ink : 'rgba(255,255,255,0.75)' }]}
            >
              <View style={[styles.dot, { borderColor: active ? palette.white : palette.inkFaint }]}>{active && <View style={styles.dotFill} />}</View>
              <AppText variant="bodyMedium" style={{ color: active ? palette.white : palette.ink }}>
                {t(`family.log.${k}`)}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
      <Card style={{ gap: space.md }}>
        {kind === 'bp' && (
          <View style={styles.row}>
            <Controller control={control} name="sys" render={({ field }) => <VoiceField voiceMode="number" flex label={t('family.log.sys')} keyboardType="number-pad" value={field.value} onChangeText={field.onChange} unit="mmHg" />} />
            <Controller control={control} name="dia" render={({ field }) => <VoiceField voiceMode="number" flex label={t('family.log.dia')} keyboardType="number-pad" value={field.value} onChangeText={field.onChange} unit="mmHg" />} />
          </View>
        )}
        {kind === 'contractions' && (
          <Controller
            control={control}
            name="count"
            render={({ field }) => (
              <VoiceField voiceMode="number" label={t('family.log.contractionsCount')} hint={t('family.log.contractionsHint')} keyboardType="number-pad" value={field.value} onChangeText={(v) => field.onChange(v.replace(/[^0-9]/g, ''))} />
            )}
          />
        )}
        {kind === 'weight' && <Controller control={control} name="kg" render={({ field }) => <VoiceField voiceMode="number" label={t('family.log.weight')} keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} unit="kg" />} />}
        {(kind === 'movements' || kind === 'feeding') && <ChoiceChips control={control} keys={kind === 'movements' ? MOVEMENT_CHOICES : FEEDING_CHOICES} />}
      </Card>
    </>
  );
}

/** Chips show the translated label; the form keeps the i18n key. */
function ChoiceChips({ control, keys }: { control: ReturnType<typeof useSelfLogForm>['control']; keys: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <Controller
      control={control}
      name="choice"
      render={({ field }) => <OptionChips options={keys.map((k) => t(k))} value={field.value ? t(field.value) : undefined} onChange={(v) => field.onChange(keys.find((k) => t(k) === v))} />}
    />
  );
}

/** Self-report form shared by /family/log and the Journey Record tab. */
export function RecordForm({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const form = useSelfLogForm(() => onSaved?.());
  return (
    <View style={{ gap: space.sm }}>
      <SelfLogFields form={form} rowHeight={48} />
      <Button label={t('family.log.save')} onPress={form.save} disabled={!form.ready || form.busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  kinds: { gap: space.xs },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.white },
});
