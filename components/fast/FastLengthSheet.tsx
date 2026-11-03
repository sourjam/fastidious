"use client";

import { useEffect, useState } from "react";

import { validateGoalHours } from "@/lib/domain/fasts";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { FastPresets } from "./FastPresets";

export function FastLengthSheet({
  open,
  value,
  onClose,
  onSet,
}: {
  open: boolean;
  value: number;
  onClose: () => void;
  onSet: (hours: number) => void | Promise<void>;
}) {
  const [custom, setCustom] = useState(String(value));
  const [committing, setCommitting] = useState(false);
  useEffect(() => { if (open) setCustom(String(value)); }, [open, value]);
  const parsed = Number(custom);
  const validation = validateGoalHours(parsed);
  const error = custom.trim() && !validation.ok ? validation.message : undefined;

  async function apply(hours: number) {
    setCommitting(true);
    try { await onSet(hours); } finally { setCommitting(false); }
  }

  return (
    <Sheet open={open} title="Fast length" onClose={onClose} isCommitting={committing}>
      <FastPresets selected={value} onSelect={(hours) => void apply(hours)} />
      <div className="sheet-inline-action">
        <Field
          label="Custom hours"
          type="number"
          min={1}
          max={168}
          step={0.5}
          value={custom}
          error={error}
          onChange={(event) => setCustom(event.target.value)}
        />
        <Button disabled={!validation.ok || committing} onClick={() => validation.ok && void apply(validation.value)}>Set</Button>
      </div>
      <Button onClick={onClose} disabled={committing}>Cancel</Button>
    </Sheet>
  );
}
