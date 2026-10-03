import { useState } from "react";
import { Alert, StyleSheet, Switch, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react-native";
import { addDays, gestationalAge } from "@domain/gestation";
import {
  ancIntervalWeeks,
  completeness,
  expectedComponents,
} from "@domain/schedules";

import { COMPLAINTS, NOT_DONE_REASONS } from "@/data/catalogue";
import { asPregnancyId, asVisitId, paramValue } from "@/data/ids";
import {
  DATING_NOT_RECORDED,
  fmtDay,
  fmtTime,
  motherOf,
  nextVisit,
} from "@/data/selectors";
import { useDb, type VisitInput } from "@/data/store";
import type { PregnancyId, Visit } from "@/data/types";
import { EnteredInErrorSheet } from "@/features/care/EnteredInErrorSheet";
import {
  OTHER_COMPLAINT,
  makeVisitSchema,
  visitFormValues,
  visitRecorded,
  visitTime,
  whenDefaults,
  type VisitForm,
} from "@/features/care/forms";
import { useActor } from "@/features/care/nav";
import { WhenFields } from "@/features/care/WhenFields";
import { useNow } from "@/lib/clock";
import { useZodForm } from "@/lib/forms";
import { useSubmitOnce } from "@/lib/useSubmitOnce";
import {
  AppText,
  Button,
  Card,
  ChecklistRow,
  Chip,
  DatePicker,
  Field,
  OptionChips,
  ProgressBar,
  Screen,
  Sheet,
  TopBar,
  palette,
  space,
} from "@/ui";

/**
 * CT-30 Record ANC visit with the completeness checklist (PRD F-13), at the date and time of the visit (default now;
 * never in the future, never before the registration). With `?edit=<visit id>` the same form opens a recorded visit
 * for correction: saving writes the corrected version and withdraws the old one (server correct_visit); "Remove this
 * record" withdraws it with a reason. Values are stored as entered — never interpreted.
 */
export default function RecordVisit() {
  const params = useLocalSearchParams<{ id: string; edit?: string }>();
  const id = asPregnancyId(params.id);
  const editId = paramValue(params.edit);
  const visit = useDb((s) =>
    editId ? s.visits.find((v) => v.id === editId) : undefined,
  );
  if (editId && !visit)
    return (
      <Screen header={<TopBar back title="Visit" />}>
        <AppText>
          This visit is no longer on the record (it was corrected or removed).
        </AppText>
      </Screen>
    );
  return <VisitFormScreen key={visit?.id ?? id} id={id} visit={visit} />;
}

function VisitFormScreen({ id, visit }: { id: PregnancyId; visit?: Visit }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const p = db.pregnancies.find((x) => x.id === id)!;
  const m = motherOf(db, p.motherId);
  const nv = nextVisit(db, p.id, now);

  const [defaults] = useState<VisitForm>(() =>
    visit
      ? visitFormValues(visit, nv?.dueBy ?? addDays(now, 14))
      : {
          ...whenDefaults(now),
          weight: "",
          sys: "",
          dia: "",
          pulse: "",
          fundal: "",
          fhr: "",
          albumin: undefined,
          sugar: undefined,
          oedema: undefined,
          presentation: undefined,
          movements: undefined,
          ifa: false,
          counselling: [],
          complaints: [],
          otherComplaint: "",
          nextOn: addDays(
            now,
            ancIntervalWeeks(
              p.intensity,
              p.edd ? gestationalAge(p.edd, now).weeks : 0,
            ) * 7,
          ),
          gaps: {},
        },
  );
  // Undated (dating not recorded yet): the checklist of the earliest weeks; no visit is planned until she is dated.
  const gaOn = (d: Date) =>
    p.edd ? gestationalAge(p.edd, d) : { weeks: 0, days: 0, totalDays: 0 };
  // Rebuilt per render (cheap; the React Compiler memoizes it): the expected components follow the visit's date.
  const schema = makeVisitSchema((d) => gaOn(d).weeks, now, p.registeredOn);
  const { control, handleSubmit, setValue, formState } = useZodForm(schema, {
    defaultValues: defaults,
  });
  const { busy, once } = useSubmitOnce();
  const [review, setReview] = useState(false);
  const [removing, setRemoving] = useState(false);
  const values = useWatch({ control }) as VisitForm;
  const ga = gaOn(visitTime(values) ?? now);
  const defaultWeeks = ancIntervalWeeks(p.intensity, ga.weeks);

  const recorded = visitRecorded(values);
  const merged = Object.fromEntries(
    expectedComponents(ga.weeks).map((c) => [
      c.key,
      recorded[c.key] ?? values.gaps[c.key]?.state,
    ]),
  );
  const comp = completeness(ga.weeks, merged);
  const nextInDays = Math.round(
    (startOfDay(values.nextOn).getTime() - startOfDay(now).getTime()) /
      86_400_000,
  );

  const save = once(({ at, ...input }: VisitInput & { at: Date }) => {
    setReview(false);
    if (visit) {
      db.correctVisit(visit.id, input, at, by, now);
      Alert.alert(
        "Visit corrected",
        'The corrected version is saved; the earlier one is kept in the record as "Corrected".',
      );
    } else {
      db.recordVisit(p.id, input, by, at);
      Alert.alert(
        "Visit saved",
        `${comp.done}/${comp.expected} components recorded · next visit ${fmtDay(input.nextVisitOn)}`,
      );
    }
    router.back();
  });

  const invalid = () =>
    Alert.alert(
      "Check values",
      "Some entries need a look — please re-check the highlighted fields.",
    );
  const trySave = handleSubmit(
    (input) => (comp.missing.length ? setReview(true) : save(input)),
    invalid,
  );

  const vital = (
    name: "weight" | "pulse" | "sys" | "dia" | "fundal" | "fhr",
    label: string,
    unit: string,
    keyboardType: "decimal-pad" | "number-pad",
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          flex
          label={label}
          unit={unit}
          keyboardType={keyboardType}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
  const options = (
    name: "albumin" | "sugar" | "oedema" | "presentation",
    label: string,
    opts: string[],
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <OptionChips
          label={label}
          options={opts}
          value={field.value}
          onChange={field.onChange}
        />
      )}
    />
  );
  const mark = (
    key: string,
    gap: { state: "na" } | { state: "not_done"; reason: string },
  ) => setValue("gaps", { ...values.gaps, [key]: gap });

  return (
    <Screen
      blob="none"
      header={<TopBar back title={visit ? "Correct visit" : "Record visit"} />}
      footer={
        <Button
          label={
            visit
              ? `Save correction · ${comp.done}/${comp.expected}`
              : `Save visit · ${comp.done}/${comp.expected}`
          }
          disabled={busy}
          onPress={trySave}
        />
      }
    >
      <View style={{ gap: 4 }}>
        <AppText variant="display">{m.name}</AppText>
        <AppText tone="secondary">
          {p.mchId} ·{" "}
          {p.edd
            ? `${ga.weeks}+${ga.days} weeks at the visit`
            : DATING_NOT_RECORDED}
        </AppText>
        {visit && (
          <AppText variant="caption" tone="faint">
            Recorded {fmtDay(visit.at)} {fmtTime(visit.at)} by {visit.by}.
            Saving keeps that version in the record as &quot;Corrected&quot;.
          </AppText>
        )}
      </View>

      <Card style={{ gap: space.sm }}>
        <WhenFields
          control={control}
          setValue={setValue}
          label="Date of visit"
          error={formState.errors.time?.message}
        />
      </Card>

      <Card style={{ gap: space.xs }}>
        <ProgressBar
          progress={comp.expected ? comp.done / comp.expected : 1}
          label="Visit completeness"
          leftCaption={`${comp.done} of ${comp.expected} expected components`}
          rightCaption={
            comp.missing.length ? `${comp.missing.length} open` : "Complete"
          }
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Vitals</AppText>
        <View style={styles.row}>
          {vital("weight", "Weight", "kg", "decimal-pad")}
          {vital("pulse", "Pulse", "/min", "number-pad")}
        </View>
        <View style={styles.row}>
          {vital("sys", "BP systolic", "mmHg", "number-pad")}
          {vital("dia", "BP diastolic", "mmHg", "number-pad")}
        </View>
        {ga.weeks >= 20 && (
          <View style={styles.row}>
            {vital("fundal", "Fundal height", "cm", "number-pad")}
            {vital("fhr", "Fetal heart rate", "bpm", "number-pad")}
          </View>
        )}
        <AppText variant="caption" tone="faint">
          Values are stored exactly as entered. The app does not interpret them.
        </AppText>
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Examination</AppText>
        {options("albumin", "Urine albumin", [
          "Nil",
          "Trace",
          "1+",
          "2+",
          "3+",
        ])}
        {options("sugar", "Urine sugar", ["Nil", "Trace", "1+", "2+", "3+"])}
        {options("oedema", "Oedema", ["None", "Pedal", "Generalised"])}
        {ga.weeks >= 28 && (
          <Controller
            control={control}
            name="movements"
            render={({ field }) => (
              <OptionChips
                label="Fetal movements (as reported)"
                options={["Normal", "Reduced", "Not asked"]}
                value={field.value}
                onChange={(v) =>
                  field.onChange(v === "Not asked" ? undefined : v)
                }
              />
            )}
          />
        )}
        {ga.weeks >= 32 &&
          options("presentation", "Presentation", [
            "Cephalic",
            "Breech",
            "Transverse",
            "Unsure",
          ])}
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="title">Care given</AppText>
        <Controller
          control={control}
          name="ifa"
          render={({ field }) => (
            <View style={styles.switchRow}>
              <AppText variant="bodyMedium">IFA / calcium dispensed</AppText>
              <Switch
                value={field.value}
                onValueChange={field.onChange}
                trackColor={{ true: palette.rose300, false: palette.divider }}
                thumbColor={field.value ? palette.rose500 : palette.white}
              />
            </View>
          )}
        />
        <Controller
          control={control}
          name="counselling"
          render={({ field }) => (
            <OptionChips
              multi
              label="Counselling given"
              options={[
                "Nutrition",
                "Warning signs",
                "Birth preparedness",
                "Breastfeeding",
                "Family planning",
              ]}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="complaints"
          render={({ field }) => (
            <OptionChips
              multi
              label="Complaints (as reported)"
              options={[...COMPLAINTS, OTHER_COMPLAINT]}
              value={field.value}
              onChange={field.onChange}
              variant="soft"
            />
          )}
        />
        {values.complaints.includes(OTHER_COMPLAINT) && (
          <Controller
            control={control}
            name="otherComplaint"
            render={({ field }) => (
              <Field
                label="Other complaint"
                placeholder="Write the complaint as reported"
                multiline
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        )}
      </Card>

      {!visit && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title">Next visit</AppText>
          <Controller
            control={control}
            name="nextOn"
            render={({ field }) => (
              <>
                <OptionChips
                  label={`Suggested by ${p.intensity} schedule: ${defaultWeeks} wk`}
                  options={WEEK_SHORTCUTS}
                  value={WEEK_SHORTCUTS.find(
                    (w) => Number(w.split(" ")[0]) * 7 === nextInDays,
                  )}
                  onChange={(v) =>
                    v &&
                    field.onChange(addDays(now, Number(v.split(" ")[0]) * 7))
                  }
                />
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  minDate={addDays(now, 1)}
                />
              </>
            )}
          />
          <AppText variant="bodyMedium">
            In {nextInDays} day{nextInDays === 1 ? "" : "s"} ·{" "}
            {fmtDay(values.nextOn)}
          </AppText>
        </Card>
      )}

      {visit && (
        <Card style={{ gap: space.sm }}>
          <AppText variant="title">Remove this record</AppText>
          <AppText tone="secondary">
            If this visit should not be on her record at all (wrong patient,
            duplicate), remove it with a reason. It stays in the audit trail.
          </AppText>
          <Button
            variant="secondary"
            icon={Trash2}
            label="Remove this record"
            onPress={() => setRemoving(true)}
          />
        </Card>
      )}

      <Sheet
        visible={review}
        onClose={() => setReview(false)}
        title="Before you save"
        subtitle="These expected components weren't recorded. Record them, or mark each one."
        footer={
          <Button
            label={
              comp.missing.length
                ? `Save anyway (${comp.missing.length} unmarked)`
                : visit
                  ? "Save correction"
                  : "Save visit"
            }
            disabled={busy}
            onPress={handleSubmit(save, invalid)}
          />
        }
      >
        {expectedComponents(ga.weeks)
          .filter((c) => recorded[c.key] !== "done")
          .map((c) => (
            <ChecklistRow
              key={c.key}
              label={c.label}
              state={values.gaps[c.key]?.state}
              detail={values.gaps[c.key]?.reason}
              actions={
                <>
                  <Chip label="Record now" onPress={() => setReview(false)} />
                  <Chip
                    label="N/A"
                    variant={
                      values.gaps[c.key]?.state === "na" ? "selected" : "soft"
                    }
                    onPress={() => mark(c.key, { state: "na" })}
                  />
                  {NOT_DONE_REASONS.slice(0, 3).map((r) => (
                    <Chip
                      key={r}
                      label={r}
                      variant={
                        values.gaps[c.key]?.reason === r ? "selected" : "soft"
                      }
                      onPress={() =>
                        mark(c.key, { state: "not_done", reason: r })
                      }
                    />
                  ))}
                </>
              }
            />
          ))}
      </Sheet>
      {visit && (
        <EnteredInErrorSheet
          target={
            removing
              ? {
                  kind: "encounter",
                  id: asVisitId(visit.id),
                  label: `Visit · ${fmtDay(visit.at)} · ${visit.by}`,
                }
              : undefined
          }
          onClose={() => setRemoving(false)}
          onDone={() => router.back()}
        />
      )}
    </Screen>
  );
}

const WEEK_SHORTCUTS = ["1 wk", "2 wk", "3 wk", "4 wk"];
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
