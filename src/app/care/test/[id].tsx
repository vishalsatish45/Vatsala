import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useWatch } from "react-hook-form";
import { CalendarClock, Trash2 } from "lucide-react-native";

import { NOT_DONE_REASONS } from "@/data/catalogue";
import { asInvestigationId } from "@/data/ids";
import { fmtDay, invState, motherOf } from "@/data/selectors";
import { useDb } from "@/data/store";
import type { Investigation, PregnancyId } from "@/data/types";
import { useCareMe } from "@/features/care/CareTeam";
import { EnteredInErrorSheet } from "@/features/care/EnteredInErrorSheet";
import {
  FOLLOW_UPS,
  makeResultCorrectionSchema,
  notDoneSchema,
  pickerDay,
  resultSchema,
  reviewSchema,
  testWindowSchema,
} from "@/features/care/forms";
import { useActor } from "@/features/care/nav";
import { canWriteSubject } from "@/features/care/permissions";
import { useNow } from "@/lib/clock";
import { useZodForm } from "@/lib/forms";
import { useSubmitOnce } from "@/lib/useSubmitOnce";
import {
  AppText,
  Button,
  Card,
  Chip,
  DatePicker,
  Field,
  InfoRow,
  ListRow,
  OptionChips,
  Screen,
  Sheet,
  StatusBadge,
  TopBar,
  space,
} from "@/ui";

/**
 * CT-23/24 Investigation: order → enter result → clinician review (PRD F-16). No auto "abnormal". The doctor may move
 * the due window of a test still waiting for its result, and tap a recorded result to correct it (value, note, date
 * tested) or remove it — a correction keeps the earlier result in the record as "Corrected".
 */
export default function TestDetail() {
  const id = asInvestigationId(useLocalSearchParams<{ id: string }>().id);
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const order = useSubmitOnce(
    db.investigations.find((x) => x.id === id)?.status,
  );
  const inv = db.investigations.find((x) => x.id === id);
  const [editing, setEditing] = useState<"result" | "window">();
  const [removing, setRemoving] = useState(false);
  const me = useCareMe();
  if (!inv)
    return (
      <Screen header={<TopBar back title="Test" />}>
        <AppText>Not found.</AppText>
      </Screen>
    );
  const baby = db.babies.find((b) => b.id === inv.subjectId);
  const p = db.pregnancies.find(
    (x) => x.id === (baby?.pregnancyId ?? inv.subjectId),
  );
  const m = p ? motherOf(db, p.motherId) : undefined;
  const s = invState(inv, now);
  // app.require_writer: a pregnancy's tests are the obstetrician's, a baby's the paediatrician's (order, result,
  // not done, review, corrections, window). Others read only. A closed pregnancy episode takes no changes.
  const treating = canWriteSubject(me, baby ? "baby" : "pregnancy");
  const editable = treating && (!!baby || p?.status !== "closed");
  const waiting = inv.status === "due" || inv.status === "ordered";

  return (
    <Screen blob="none" header={<TopBar back title="Investigation" />}>
      <View style={{ gap: 4 }}>
        <AppText variant="display">{inv.label}</AppText>
        <AppText tone="secondary">
          {baby ? `${baby.childId} · ` : ""}
          {m?.name} · {p?.mchId}
        </AppText>
        <StatusBadge status={s.status} label={s.label} />
      </View>

      <Card>
        <InfoRow
          label="Due window"
          value={`${fmtDay(inv.dueFrom)} – ${fmtDay(inv.dueBy)}`}
        />
        <InfoRow
          label="Type"
          value={inv.kind === "scan" ? "Ultrasound" : "Lab"}
        />
        {inv.orderedAt && (
          <InfoRow label="Ordered" value={fmtDay(inv.orderedAt)} />
        )}
        {inv.review && (
          <InfoRow
            label="Reviewed"
            value={`${inv.review.by} · ${fmtDay(inv.review.at)} · ${inv.review.followUp}`}
          />
        )}
        {inv.sensitive && (
          <InfoRow label="Privacy" value="Never shown in the Family app" />
        )}
        {editable && waiting && (
          <View style={{ flexDirection: "row", paddingTop: space.sm }}>
            <Chip
              label="Change due window"
              icon={CalendarClock}
              onPress={() => setEditing("window")}
            />
          </View>
        )}
      </Card>

      {inv.result && (
        <ListRow
          title={`Result (as entered): ${inv.result.value}${inv.result.unit ? ` ${inv.result.unit}` : ""}`}
          subtitle={[
            `Tested ${fmtDay(inv.result.at)}`,
            inv.result.crlMm != null ? `CRL ${inv.result.crlMm} mm` : undefined,
            inv.result.note,
            editable && inv.resultId ? "Tap to correct" : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
          onPress={
            editable && inv.resultId ? () => setEditing("result") : undefined
          }
        />
      )}

      {editable && waiting && (
        <Card style={{ gap: space.md }}>
          <AppText variant="title">
            {inv.status === "due" ? "Order or enter result" : "Enter result"}
          </AppText>
          {inv.status === "due" && (
            <Button
              variant="secondary"
              label="Mark as ordered"
              disabled={order.busy}
              onPress={order.once(() => db.orderInvestigation(inv.id, by, now))}
            />
          )}
          <ResultForm key={inv.id} inv={inv} />
          <NotDoneForm key={`nd-${inv.id}`} inv={inv} />
        </Card>
      )}

      {editable && inv.status === "resulted" && (
        <ReviewForm
          key={inv.id}
          inv={inv}
          pregnancyId={baby ? undefined : p?.id}
        />
      )}

      <Sheet
        visible={editing === "result" && !removing}
        onClose={() => setEditing(undefined)}
        title="Correct result"
        subtitle="Saving keeps the earlier result in the record as “Corrected”; the corrected result waits for your review."
      >
        {editing === "result" && inv.result && (
          <ResultCorrectionForm
            key={inv.resultId}
            inv={inv}
            onDone={() => setEditing(undefined)}
            onRemove={() => setRemoving(true)}
          />
        )}
      </Sheet>
      <Sheet
        visible={editing === "window"}
        onClose={() => setEditing(undefined)}
        title="Change due window"
        subtitle="The reason is recorded in the audit trail."
      >
        {editing === "window" && (
          <WindowForm
            key={`${inv.id}:${inv.dueFrom.getTime()}:${inv.dueBy.getTime()}`}
            inv={inv}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Sheet>
      <EnteredInErrorSheet
        target={
          removing && inv.resultId && inv.result
            ? {
                kind: "investigation_result",
                id: inv.resultId,
                label: `${inv.label} · ${inv.result.value}${inv.result.unit ? ` ${inv.result.unit}` : ""}`,
              }
            : undefined
        }
        onClose={() => setRemoving(false)}
        onDone={() => setEditing(undefined)}
      />
    </Screen>
  );
}

/** The result as entered, its note and the day it was tested; saved as a new version (server correct_result). */
function ResultCorrectionForm({
  inv,
  onDone,
  onRemove,
}: {
  inv: Investigation;
  onDone: () => void;
  onRemove: () => void;
}) {
  const correctResult = useDb((s) => s.correctResult);
  const now = useNow();
  const by = useActor();
  const r = inv.result!;
  const { control, handleSubmit } = useZodForm(
    makeResultCorrectionSchema(now),
    {
      defaultValues: {
        value: `${r.value}${r.unit ? ` ${r.unit}` : ""}`,
        crl: r.crlMm != null ? String(r.crlMm) : "",
        note: r.note ?? "",
        testedOn: r.at,
      },
    },
  );
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((c) => {
      correctResult(inv.id, c, by, now);
      onDone();
    }),
  );
  return (
    <View style={{ gap: space.sm }}>
      <Controller
        control={control}
        name="value"
        render={({ field, fieldState }) => (
          <Field
            label="Result (as reported)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />
      {inv.kind === "scan" && (
        <Controller
          control={control}
          name="crl"
          render={({ field, fieldState }) => (
            <Field
              label="CRL (as reported, optional)"
              unit="mm"
              keyboardType="decimal-pad"
              maxLength={6}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <Field
            label="Note (optional)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
          />
        )}
      />
      <Controller
        control={control}
        name="testedOn"
        render={({ field, fieldState }) => (
          <>
            <AppText variant="label" tone="secondary">
              Date tested · {fmtDay(field.value)}
            </AppText>
            <DatePicker value={field.value} onChange={field.onChange} />
            {!!fieldState.error && (
              <AppText variant="caption" tone="overdue">
                {fieldState.error.message}
              </AppText>
            )}
          </>
        )}
      />
      <Button label="Save correction" disabled={busy} onPress={save} />
      <Button
        variant="secondary"
        icon={Trash2}
        label="Remove this record"
        onPress={onRemove}
      />
    </View>
  );
}

/** The test's due window, moved by the doctor with a reason (server reschedule_investigation). */
function WindowForm({
  inv,
  onDone,
}: {
  inv: Investigation;
  onDone: () => void;
}) {
  const reschedule = useDb((s) => s.rescheduleInvestigation);
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit, formState } = useZodForm(testWindowSchema, {
    defaultValues: {
      from: pickerDay(inv.dueFrom),
      by: pickerDay(inv.dueBy),
      reason: "",
    },
  });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((w) => {
      reschedule(inv.id, w.dueFrom, w.dueBy, w.reason, by, now);
      onDone();
    }),
  );
  const day = (name: "from" | "by", label: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <>
          <AppText variant="label" tone="secondary">
            {label} · {fmtDay(field.value)}
          </AppText>
          <DatePicker value={field.value} onChange={field.onChange} />
        </>
      )}
    />
  );
  return (
    <View style={{ gap: space.sm }}>
      {day("from", "From")}
      {day("by", "Due by")}
      {!!formState.errors.by?.message && (
        <AppText variant="caption" tone="overdue">
          {formState.errors.by.message}
        </AppText>
      )}
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <Field
            label="Reason (recorded)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder="e.g. Lab closed that week"
            error={fieldState.error?.message}
          />
        )}
      />
      <Button label="Save window" disabled={busy} onPress={save} />
    </View>
  );
}

function ResultForm({ inv }: { inv: Investigation }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(resultSchema, {
    defaultValues: { value: "", crl: "", note: "" },
  });
  const { busy, once } = useSubmitOnce(inv.status);
  const save = handleSubmit(
    once((r) => db.enterResult(inv.id, r.value, undefined, r.note, by, now, r.crlMm)),
  );
  return (
    <>
      <Controller
        control={control}
        name="value"
        render={({ field }) => (
          <Field
            label="Result"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={
              inv.kind === "scan" ? "e.g. Report documented" : "e.g. 11.2 g/dL"
            }
          />
        )}
      />
      {inv.kind === "scan" && (
        <Controller
          control={control}
          name="crl"
          render={({ field, fieldState }) => (
            <Field
              label="CRL (as reported, optional)"
              unit="mm"
              keyboardType="decimal-pad"
              maxLength={6}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
      <Controller
        control={control}
        name="note"
        render={({ field }) => (
          <Field
            label="Note (optional)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            multiline
          />
        )}
      />
      <Button label="Save result" disabled={busy} onPress={save} />
    </>
  );
}

function NotDoneForm({ inv }: { inv: Investigation }) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(notDoneSchema, {
    defaultValues: { reason: undefined },
  });
  const { busy, once } = useSubmitOnce();
  const reason = useWatch({ control, name: "reason" });
  const save = handleSubmit(
    once((v) => {
      db.markNotDone(inv.id, v.reason ?? "", by, now);
      router.back();
    }),
  );
  return (
    <>
      <Controller
        control={control}
        name="reason"
        render={({ field }) => (
          <OptionChips
            label="Or mark not done"
            options={NOT_DONE_REASONS}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      {reason && (
        <Button
          variant="secondary"
          label={`Not done · ${reason}`}
          disabled={busy}
          onPress={save}
        />
      )}
    </>
  );
}

function ReviewForm({
  inv,
  pregnancyId,
}: {
  inv: Investigation;
  pregnancyId?: PregnancyId;
}) {
  const db = useDb();
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(reviewSchema, {
    defaultValues: { followUp: undefined },
  });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once(({ followUp }) => {
      if (!followUp) return;
      db.reviewResult(inv.id, followUp, by, now);
      if (followUp === "Refer" && pregnancyId)
        router.replace({
          pathname: "/care/p/[id]/refer",
          params: { id: pregnancyId },
        });
      else router.back();
    }),
  );
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title">Your review</AppText>
      <AppText variant="caption" tone="secondary">
        The app never marks results normal or abnormal. Choose what happens
        next.
      </AppText>
      <Controller
        control={control}
        name="followUp"
        render={({ field }) => (
          <OptionChips
            label="Follow-up"
            options={FOLLOW_UPS}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <Button label="Mark reviewed" disabled={busy} onPress={save} />
    </Card>
  );
}
