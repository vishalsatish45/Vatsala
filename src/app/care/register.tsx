import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Controller, useFieldArray, useWatch, type Control } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react-native';

import { TAGS } from '@/data/catalogue';
import { BLOOD_GROUPS, PREVIOUS_MODES, PREVIOUS_OUTCOMES } from '@/data/codes';
import { eddFor, type MotherDetails } from '@/data/payloads';
import { findMother, type MotherMatch } from '@/data/registration';
import { fmtDay } from '@/data/selectors';
import { useDb, type RegisterInput } from '@/data/store';
import {
  MAX_PREVIOUS,
  OTHER_CONDITION,
  REGISTER_STEPS,
  blankPrevious,
  blankRegisterForm,
  calendarDay,
  gaDaysOn,
  makeRegisterSchema,
  pickerDay,
  motherFormValues,
  type MotherForm,
  type RegisterForm,
} from '@/features/care/forms';
import { MotherFields } from '@/features/care/MotherFields';
import { useActor } from '@/features/care/nav';
import { useRegisterDraft } from '@/features/care/registerDraft';
import { useNow } from '@/lib/clock';
import { useZodForm } from '@/lib/forms';
import { isRemote } from '@/lib/supabase';
import { useSubmitOnce } from '@/lib/useSubmitOnce';
import { useOutbox } from '@/data/outbox';
import { useSession } from '@/state/session';
import { AppText, Button, Card, Chip, DateField, DatePicker, Field, OptionChips, ProgressBar, Screen, SearchableMultiSelect, SegmentedPills, TopBar, palette, space } from '@/ui';

const CONDITIONS = ['Hypertension', 'Diabetes', 'Heart disease', 'Kidney disease', 'Thyroid disorder', 'Epilepsy', 'Asthma', 'TB', OTHER_CONDITION];
const BLOOD = [...BLOOD_GROUPS, 'Unknown'];
const STEPS = ['Mother details', 'Obstetric summary', 'History & risk'];
const RISK_OPTIONS = TAGS.filter((t) => t.group !== 'Newborn').map((t) => ({ value: t.code, label: t.label, group: t.group }));

type Lookup = { phone: string; state: 'searching' | 'none' | 'found' | 'error'; match?: MotherMatch; message?: string; decision?: 'same' | 'different' };

/**
 * CT-61…66 Pregnancy registration (PRD F-11): mother details, then the obstetric summary. Creates the MCH ID; there is
 * no dating step — the doctor records the dating at her first check-up, which schedules the ANC visits and test
 * windows. Obstetricians only (server rule).
 */
export default function Register() {
  const role = useSession((s) => s.account?.care?.role);
  if (role !== 'obstetrician') {
    return (
      <Screen header={<TopBar back title="Register pregnancy" />}>
        <AppText tone="secondary">Pregnancies are registered by an obstetrician of the hospital.</AppText>
      </Screen>
    );
  }
  return <RegisterScreen />;
}

function RegisterScreen() {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const [step, setStep] = useState(0);
  const [lookup, setLookup] = useState<Lookup>();
  const [regOpen, setRegOpen] = useState(false);
  const teams = useSession((s) => s.account?.care?.teams);
  const units = useMemo(() => (teams ?? []).filter((t) => t.kind === 'unit' && t.specialty === 'obstetrics'), [teams]);
  const unitIds = useMemo(() => units.map((u) => u.id as string), [units]);
  const schema = useMemo(() => makeRegisterSchema(now, { units: isRemote || unitIds.length > 1 ? unitIds : undefined }), [now, unitIds]);
  const { control, handleSubmit, reset, getValues, setValue } = useZodForm(schema, {
    defaultValues: { ...blankRegisterForm(now), teamId: unitIds.length === 1 ? unitIds[0] : undefined },
  });
  const previous = useFieldArray({ control, name: 'previous' });
  const { busy, once } = useSubmitOnce();
  const draft = useRegisterDraft((s) => s.draft);
  const failure = useOutbox((s) => s.failure);
  const lostDraft = draft && !db.pregnancies.some((p) => p.id === draft.pregnancyId) ? draft : undefined;

  const values = useWatch({ control }) as RegisterForm;
  // "Next" is enabled when the fields this step owns have no issue (the schema is the only rulebook).
  const issues = schema.safeParse(values).error?.issues ?? [];
  const issueIn = (fields: readonly string[]) => issues.find((i) => fields.includes(String(i.path[0])));
  const lookupBlocks = lookup?.phone === values.phone && (lookup.match?.activePregnancy || lookup.decision === 'different' || (lookup.state === 'found' && !lookup.decision));
  const valid = REGISTER_STEPS.map((fields, i) => !issueIn(fields) && (i > 0 || !lookupBlocks));
  const stepIssue = issueIn(REGISTER_STEPS[step]!)?.message;
  // Shown under G/P/L/A once all four are filled in
  const gplaIssue = [values.g, values.p, values.l, values.a].every((x) => x !== '') ? issueIn(['g', 'p', 'l', 'a'])?.message : undefined;
  const last = step === STEPS.length - 1;

  async function lookUp(phone: string) {
    setLookup({ phone, state: 'searching' });
    const r = await findMother(phone);
    setLookup((cur) => (cur?.phone !== phone ? cur : r.ok ? { phone, state: r.match ? 'found' : 'none', match: r.match } : { phone, state: 'error', message: r.message }));
  }

  /** Prefills what her record holds (fields already typed with nothing on record are kept). */
  function adoptReturning(match: MotherMatch) {
    const f = motherFormValues({ ...match, village: match.village ?? '' });
    for (const k of ['name', 'dob', 'age', 'lang', 'marital', 'husbandName', 'addressLine', 'village', 'district', 'state', 'pincode'] as const) {
      if (f[k] !== '' && f[k] !== undefined) setValue(k, f[k] as never, { shouldValidate: true, shouldDirty: true });
    }
    if (match.dob || match.age) {
      setValue('ageOnly', f.ageOnly, { shouldValidate: true });
      setValue('dobEstimated', f.dobEstimated, { shouldValidate: true });
    }
    setValue('returningId', match.motherId, { shouldValidate: true });
    setLookup((cur) => cur && { ...cur, decision: 'same' });
  }

  const create = once((input: RegisterInput) => {
    const id = db.registerPregnancy(input, by, now);
    useRegisterDraft.getState().keep(getValues(), id);
    const p = useDb.getState().pregnancies.find((x) => x.id === id);
    // In Supabase mode the MCH id is assigned by the server and appears on her record once saved.
    Alert.alert(
      'Pregnancy registered',
      `${isRemote ? 'MCH id is being assigned.' : p?.mchId}\n${
        input.dating
          ? 'Her ANC visits and test windows are planned from the EDD you entered.'
          : 'Record the dating scan / EDD at her first check-up: the ANC visits and test windows are scheduled from it.'
      }`,
    );
    router.replace({ pathname: '/care/p/[id]', params: { id } });
  });

  return (
    <Screen
      blob="none"
      header={<TopBar back title="Register pregnancy" />}
      footer={
        <View style={{ gap: space.xs }}>
          {/* Why "Next" is off, where it is always visible */}
          {!!stepIssue && (
            <AppText variant="caption" tone="overdue" align="center">
              To continue: {stepIssue}
            </AppText>
          )}
        <View style={styles.footer}>
          {step > 0 && (
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Back" onPress={() => setStep((s) => s - 1)} />
            </View>
          )}
          <View style={{ flex: 2 }}>
            {!last ? (
              <Button label="Next" disabled={!valid[step]} onPress={() => setStep((s) => s + 1)} />
            ) : (
              <Button label="Register" disabled={busy || !valid.every(Boolean)} onPress={handleSubmit(create)} />
            )}
          </View>
        </View>
        </View>
      }
    >
      <ProgressBar progress={(step + 1) / STEPS.length} leftCaption={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} />

      {lostDraft && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Last registration not saved</AppText>
          <AppText tone="secondary">
            {lostDraft.values.name || 'The mother'} was not registered{failure?.rpc === 'register_pregnancy' ? `: ${failure.message}` : '.'} Restore what you typed, correct it and save again.
          </AppText>
          <View style={styles.row}>
            <Chip label="Restore the form" onPress={() => { reset(lostDraft.values); setStep(0); useRegisterDraft.getState().clear(); }} />
            <Chip label="Discard" onPress={() => useRegisterDraft.getState().clear()} />
          </View>
        </Card>
      )}

      {step === 0 && (
        <MotherFields
          control={control as unknown as Control<MotherForm, unknown, MotherDetails>}
          now={now}
          onPhoneComplete={(ph) => void lookUp(ph)}
          afterPhone={lookup?.phone === values.phone && <ReturningCard lookup={lookup} onSame={adoptReturning} onDifferent={() => setLookup({ ...lookup, decision: 'different' })} />}
        />
      )}

      {step === 1 && (
        <>
          <Card style={{ gap: space.md }}>
            <AppText variant="title">Obstetric summary</AppText>
            <View style={styles.row}>
              {(['g', 'p', 'l', 'a'] as const).map((k) => (
                <Controller key={k} control={control} name={k} render={({ field }) => <Field flex label={k.toUpperCase()} keyboardType="number-pad" maxLength={2} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
              ))}
            </View>
            <AppText variant="caption" tone="secondary">
              Gravida · Para · Living · Abortions (G counts this pregnancy)
            </AppText>
            {!!gplaIssue && (
              <AppText variant="caption" tone="overdue">
                {gplaIssue}
              </AppText>
            )}
            <Chip label={`Registered on ${fmtDay(calendarDay(values.registeredOn))}${regOpen ? '' : ' · change (back-entry)'}`} onPress={() => setRegOpen((x) => !x)} />
            {regOpen && <Controller control={control} name="registeredOn" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />}
          </Card>

          <PresentPregnancy control={control} now={now} setEdd={(d) => setValue('presentEdd', d, { shouldValidate: true, shouldDirty: true })} />

          <Card style={{ gap: space.md }}>
            <AppText variant="title">Previous pregnancies (optional)</AppText>
            {lookup?.decision === 'same' && lookup.match && lookup.match.pregnancies > 0 && (
              <AppText variant="caption" tone="secondary">
                Pregnancies already on her record stay documented; add only ones not yet recorded.
              </AppText>
            )}
            {previous.fields.map((row, i) => (
              <View key={row.id} style={styles.prev}>
                <View style={styles.row}>
                  <Controller control={control} name={`previous.${i}.year`} render={({ field }) => <Field flex label="Year" keyboardType="number-pad" maxLength={4} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
                  <Controller control={control} name={`previous.${i}.weeks`} render={({ field }) => <Field flex label="Gestation" unit="wk" keyboardType="number-pad" maxLength={2} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
                </View>
                <Controller control={control} name={`previous.${i}.outcome`} render={({ field }) => <OptionChips label="Outcome" options={[...PREVIOUS_OUTCOMES]} value={field.value} onChange={field.onChange} />} />
                <Controller control={control} name={`previous.${i}.mode`} render={({ field }) => <OptionChips label="Mode of delivery (if any)" options={[...PREVIOUS_MODES]} value={field.value} onChange={field.onChange} />} />
                <Controller control={control} name={`previous.${i}.complications`} render={({ field }) => <Field label="Complications (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
                <Controller control={control} name={`previous.${i}.note`} render={({ field }) => <Field label={values.previous[i]?.outcome === 'Other' ? 'Note: what was the outcome?' : 'Note'} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
                <Chip label="Remove" icon={Trash2} onPress={() => previous.remove(i)} />
              </View>
            ))}
            {previous.fields.length < MAX_PREVIOUS && <Chip label="Add a previous pregnancy" icon={Plus} onPress={() => previous.append(blankPrevious())} />}
          </Card>
        </>
      )}

      {step === 2 && (
        <>

          <Card style={{ gap: space.md }}>
            <AppText variant="title">History</AppText>
            <Controller control={control} name="conditions" render={({ field }) => <OptionChips multi label="Documented conditions" options={CONDITIONS} value={field.value} onChange={field.onChange} />} />
            {values.conditions.includes(OTHER_CONDITION) && (
              <Controller control={control} name="otherCondition" render={({ field }) => <Field label="Other condition (as documented)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            )}
            <Controller control={control} name="allergies" render={({ field }) => <Field label="Allergies (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name="medicines" render={({ field }) => <Field label="Current medicines (as documented, optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            <Controller control={control} name="blood" render={({ field }) => <OptionChips label="Blood group (if known)" options={BLOOD} value={field.value} onChange={field.onChange} />} />
            <View style={styles.row}>
              <Controller control={control} name="height" render={({ field }) => <Field flex label="Height (if measured)" unit="cm" keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
              <Controller control={control} name="weight" render={({ field }) => <Field flex label="Weight (if measured)" unit="kg" keyboardType="decimal-pad" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            </View>
          </Card>

          <Card style={{ gap: space.md }}>
            <AppText variant="title">Risk factors (optional)</AppText>
            <AppText variant="caption" tone="secondary">
              Your choice — nothing is pre-selected or computed.
            </AppText>
            <Controller
              control={control}
              name="tags"
              render={({ field }) => <SearchableMultiSelect noun="risk factors" options={RISK_OPTIONS} value={field.value} onChange={field.onChange} />}
            />
            {values.tags.length > 0 && (
              <Controller control={control} name="tagNote" render={({ field }) => <Field label="Note (optional)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />} />
            )}
            <AppText variant="label" tone="secondary">
              Follow-up intensity
            </AppText>
            <Controller
              control={control}
              name="intensity"
              render={({ field }) => (
                <SegmentedPills
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'routine', label: 'Routine' },
                    { value: 'enhanced', label: 'Enhanced' },
                    { value: 'close', label: 'Close' },
                  ]}
                />
              )}
            />
          </Card>
          {units.length > 1 && (
            <Card style={{ gap: space.md }}>
              <AppText variant="title">Obstetric unit</AppText>
              <Controller
                control={control}
                name="teamId"
                render={({ field }) => (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {units.map((u) => (
                      <Chip key={u.id} label={u.name} variant={field.value === u.id ? 'selected' : 'soft'} onPress={() => field.onChange(u.id)} />
                    ))}
                  </View>
                )}
              />
            </Card>
          )}
          {isRemote && units.length === 0 && <AppText tone="overdue">You are not a member of an obstetric unit, so you cannot register a pregnancy. Ask your hospital admin.</AppText>}
          <AppText variant="caption" tone="faint">
            Her ANC visits and test windows are planned from the LMP and EDD (step 2) when you register.
          </AppText>
        </>
      )}

    </Screen>
  );
}

/**
 * Step 2 "Present pregnancy": the LMP and the EDD, both required. Picking the LMP fills the EDD with LMP + 280 days
 * (the doctor may change it, e.g. to a scan-corrected EDD); the POG is worked out from them and shown large.
 * Calendar arithmetic only.
 */
function PresentPregnancy({ control, now, setEdd }: { control: Control<RegisterForm, unknown, RegisterInput>; now: Date; setEdd: (d: Date) => void }) {
  // Watched here, field by field, so the POG follows every change as it is typed or picked
  const [presentLmp, presentEdd, registeredOn] = useWatch({ control, name: ['presentLmp', 'presentEdd', 'registeredOn'] });
  const values = { presentLmp, presentEdd };
  const reg = calendarDay(registeredOn);
  const regLabel = reg.getTime() === calendarDay(now).getTime() ? 'today' : `on ${fmtDay(reg)}`;
  const lmp = values.presentLmp && calendarDay(values.presentLmp);
  const lmpEdd = lmp && eddFor({ method: 'lmp', lmp });
  const ownEdd = values.presentEdd && calendarDay(values.presentEdd);
  // POG by dates (from the LMP); by the EDD only when there is no LMP. A different EDD's POG is shown beside it.
  const weeksDays = (ga: number) => (ga >= 0 ? `${Math.floor(ga / 7)} ${Math.floor(ga / 7) === 1 ? 'week' : 'weeks'} ${ga % 7} ${ga % 7 === 1 ? 'day' : 'days'}` : undefined);
  const byLmp = lmp ? weeksDays(gaDaysOn({ method: 'lmp', lmp }, reg)) : undefined;
  const byEdd = ownEdd ? weeksDays(gaDaysOn({ method: 'clinician', edd: ownEdd }, reg)) : undefined;
  const pog = byLmp ?? byEdd;
  const eddDiffers = !!(lmpEdd && ownEdd && lmpEdd.getTime() !== ownEdd.getTime());
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Present pregnancy</AppText>
      <Controller
        control={control}
        name="presentLmp"
        render={({ field, fieldState }) => (
          <DateField
            label="LMP (first day of last period)"
            value={field.value}
            onChange={(v) => {
              field.onChange(v);
              // The EDD follows the LMP while it is empty or was filled from the previous LMP (one typed by the doctor stays)
              const followsLmp = !ownEdd || (lmpEdd && ownEdd.getTime() === lmpEdd.getTime());
              if (v && followsLmp) setEdd(pickerDay(eddFor({ method: 'lmp', lmp: calendarDay(v) })));
            }}
            initial={new Date(now.getFullYear(), now.getMonth() - 2, 1)}
            error={fieldState.error && fieldState.isTouched ? fieldState.error.message : undefined}
          />
        )}
      />
      <Controller
        control={control}
        name="presentEdd"
        render={({ field, fieldState }) => (
          <DateField
            label="EDD"
            value={field.value}
            onChange={field.onChange}
            initial={new Date(now.getFullYear(), now.getMonth() + 5, 1)}
            hint={
              ownEdd && lmpEdd
                ? ownEdd.getTime() === lmpEdd.getTime()
                  ? 'By LMP (LMP + 280 days); change it if a scan corrected it'
                  : 'Your EDD is kept; the LMP is recorded too'
                : undefined
            }
            error={fieldState.error && fieldState.isTouched ? fieldState.error.message : undefined}
          />
        )}
      />
      <View style={styles.pog}>
        <AppText variant="label" tone="secondary">
          POG {regLabel}
          {pog ? (byLmp ? ' (by LMP)' : ' (by EDD)') : ''}
        </AppText>
        {pog ? (
          <AppText variant="headline" style={styles.pogValue}>
            {pog}
          </AppText>
        ) : (
          <AppText tone="secondary">Worked out once the LMP is in</AppText>
        )}
        {eddDiffers && byEdd && (
          <AppText variant="caption" tone="secondary">
            By your EDD: {byEdd}
          </AppText>
        )}
      </View>
    </Card>
  );
}

/** A mother of this hospital already has this number: the clinician says whether it is the same woman. */
function ReturningCard({ lookup, onSame, onDifferent }: { lookup: Lookup; onSame: (m: MotherMatch) => void; onDifferent: () => void }) {
  const m = lookup.match;
  if (lookup.state === 'searching') return <AppText variant="caption" tone="secondary">Checking this number…</AppText>;
  if (lookup.state === 'error') return <AppText variant="caption" tone="secondary">Could not check the number now ({lookup.message}). The server will check it when you save.</AppText>;
  if (!m) return null;
  const who = [m.name, m.age ? `${m.age} yrs` : undefined, m.village, m.dob ? `born ${fmtDay(m.dob)}` : undefined].filter(Boolean).join(' · ');
  return (
    <View style={styles.returning}>
      <AppText variant="headline">This number is on record here</AppText>
      <AppText>{who}</AppText>
      <AppText variant="caption" tone="secondary">
        {m.pregnancies} pregnanc{m.pregnancies === 1 ? 'y' : 'ies'} at this hospital
      </AppText>
      {m.activePregnancy ? (
        <AppText tone="overdue">She already has an ongoing pregnancy. Open her record instead of registering again.</AppText>
      ) : lookup.decision === 'same' ? (
        <AppText tone="secondary">Her record will be used for this pregnancy; corrections you make here update her details.</AppText>
      ) : lookup.decision === 'different' ? (
        <AppText tone="overdue">This number belongs to another patient. Enter a different number for her.</AppText>
      ) : (
        <>
          <AppText tone="secondary">Is this the same woman? Check her name and age with her.</AppText>
          <View style={styles.row}>
            <Chip label="Yes — same woman, use her record" variant="selected" onPress={() => onSame(m)} />
            <Chip label="No — someone else" onPress={onDifferent} />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  footer: { flexDirection: 'row', gap: space.sm },
  prev: { gap: space.sm, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.softBorder },
  returning: { gap: space.sm, padding: space.md, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.softBorder },
  pog: { gap: 4, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: 16, backgroundColor: palette.rose50 },
  pogValue: { fontSize: 24, lineHeight: 30, color: palette.rose600 },
});
