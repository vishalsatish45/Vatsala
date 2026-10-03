import { useState } from "react";
import { View } from "react-native";
import { Controller } from "react-hook-form";
import { Trash2 } from "lucide-react-native";

import { PREVIOUS_MODES, PREVIOUS_OUTCOMES } from "@/data/codes";
import { useDb } from "@/data/store";
import type { DocumentedFact, PrevPregnancy } from "@/data/types";
import { EnteredInErrorSheet } from "@/features/care/EnteredInErrorSheet";
import { factFormValues, makeFactSchema } from "@/features/care/forms";
import { useActor } from "@/features/care/nav";
import { useNow } from "@/lib/clock";
import { useZodForm } from "@/lib/forms";
import { useSubmitOnce } from "@/lib/useSubmitOnce";
import { AppText, Button, Field, OptionChips, Sheet, space } from "@/ui";

const KIND_LABEL: Record<DocumentedFact["kind"], string> = {
  condition: "Condition",
  allergy: "Allergy",
  previous_pregnancy: "Previous pregnancy",
};

/**
 * A documented history entry opened for editing (History tab). Saving writes the corrected entry and withdraws the old
 * one as "Corrected" in one server step (correct_fact); "Remove this record" withdraws it with a reason. Text is kept
 * exactly as documented.
 */
export function FactEditSheet({
  fact,
  previous,
  onClose,
}: {
  fact?: DocumentedFact;
  previous?: PrevPregnancy;
  onClose: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  return (
    <>
      <Sheet
        visible={!!fact && !removing}
        onClose={onClose}
        title={fact ? `${KIND_LABEL[fact.kind]} · correct` : ""}
        subtitle="Saving keeps the earlier entry in the record as “Corrected”."
      >
        {fact && (
          <FactForm
            key={fact.id}
            fact={fact}
            previous={previous}
            onDone={onClose}
            onRemove={() => setRemoving(true)}
          />
        )}
      </Sheet>
      <EnteredInErrorSheet
        target={
          fact && removing
            ? {
                kind: fact.kind,
                id: fact.id,
                label: `${KIND_LABEL[fact.kind]} · ${fact.label}`,
              }
            : undefined
        }
        onClose={() => setRemoving(false)}
        onDone={onClose}
      />
    </>
  );
}

function FactForm({
  fact,
  previous,
  onDone,
  onRemove,
}: {
  fact: DocumentedFact;
  previous?: PrevPregnancy;
  onDone: () => void;
  onRemove: () => void;
}) {
  const correctFact = useDb((s) => s.correctFact);
  const now = useNow();
  const by = useActor();
  const { control, handleSubmit } = useZodForm(makeFactSchema(fact.kind, now), {
    defaultValues: factFormValues(fact, previous),
  });
  const { busy, once } = useSubmitOnce();
  const save = handleSubmit(
    once((c) => {
      correctFact(fact.id, c, by, now);
      onDone();
    }),
  );
  const text = (
    name: "label" | "year" | "weeks" | "complications" | "note",
    label: string,
    opts: {
      keyboardType?: "number-pad";
      placeholder?: string;
      flex?: boolean;
    } = {},
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          flex={opts.flex}
          label={label}
          keyboardType={opts.keyboardType}
          placeholder={opts.placeholder}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
  return (
    <View style={{ gap: space.sm }}>
      {fact.kind === "previous_pregnancy" ? (
        <>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {text("year", "Year", { keyboardType: "number-pad", flex: true })}
            {text("weeks", "Gestation (weeks)", {
              keyboardType: "number-pad",
              flex: true,
            })}
          </View>
          <Controller
            control={control}
            name="outcome"
            render={({ field, fieldState }) => (
              <>
                <OptionChips
                  label="Outcome"
                  options={[...PREVIOUS_OUTCOMES]}
                  value={field.value}
                  onChange={field.onChange}
                />
                {!!fieldState.error && (
                  <AppText variant="caption" tone="overdue">
                    {fieldState.error.message}
                  </AppText>
                )}
              </>
            )}
          />
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <OptionChips
                label="Mode (if a birth)"
                options={[...PREVIOUS_MODES]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          {text(
            "complications",
            "Complications as documented (comma-separated)",
          )}
          {text("note", "Note (optional)")}
        </>
      ) : (
        text(
          "label",
          fact.kind === "condition"
            ? "Condition as documented"
            : "Allergy as documented",
        )
      )}
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
