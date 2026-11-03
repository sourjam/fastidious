"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { WeightUnit } from "@/lib/domain/types";
import { parseWeightInput } from "@/lib/validation/domain";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";

export function AddWeightSheet({ open, unit, onClose, onSave }: {
  open: boolean;
  unit: WeightUnit;
  onClose: () => void;
  onSave: (kilograms: number) => Promise<string | undefined>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(undefined);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseWeightInput(value, unit);
    if (!parsed.ok) return setError(parsed.message);
    setSaving(true);
    const saveError = await onSave(parsed.value);
    setSaving(false);
    if (saveError) setError(saveError);
  }

  return (
    <Sheet open={open} title="Add weight" onClose={onClose} isCommitting={saving}>
      <form className="add-weight-form" onSubmit={(event) => void submit(event)}>
        <Field
          autoComplete="off"
          autoFocus
          error={error}
          inputMode="decimal"
          label={`Weight (${unit})`}
          onChange={(event) => { setValue(event.currentTarget.value); setError(undefined); }}
          placeholder={unit === "kg" ? "70.0" : "154.0"}
          value={value}
        />
        <div className="sheet-actions">
          <Button disabled={saving} onClick={onClose}>Cancel</Button>
          <Button disabled={saving} type="submit" variant="primary">Add weight</Button>
        </div>
      </form>
    </Sheet>
  );
}
