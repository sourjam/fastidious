"use client";

import { useEffect, useMemo, useState } from "react";

import { formatCompactDuration, intervalsOverlap, validateGoalHours } from "@/lib/domain/fasts";
import type { FastRecord } from "@/lib/domain/types";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Sheet } from "../ui/Sheet";
import { formatDateTimeInput, parseDateTimeInput } from "./date-time";

export type EditFastMode = "active" | "past" | "new";

interface DraftValidation {
  startAt: number | null;
  endAt: number | null;
  goalHours: number;
  startError?: string;
  endError?: string;
  goalError?: string;
  valid: boolean;
  note: string;
}

export function EditFastSheet({
  open,
  mode,
  fast,
  fasts,
  timezone,
  defaultGoalHours,
  onClose,
  onSave,
  onDelete,
  now = Date.now,
}: {
  open: boolean;
  mode: EditFastMode;
  fast?: FastRecord;
  fasts: readonly FastRecord[];
  timezone: string;
  defaultGoalHours: number;
  onClose: () => void;
  onSave: (value: { startAt: number; endAt: number | null; goalHours: number }) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  now?: () => number;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [goal, setGoal] = useState(String(defaultGoalHours));
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const current = now();
    const initialEnd = fast?.endAt ?? current;
    setStart(formatDateTimeInput(fast?.startAt ?? initialEnd - defaultGoalHours * 3_600_000, timezone));
    setEnd(formatDateTimeInput(initialEnd, timezone));
    setGoal(String(fast?.goalHours ?? defaultGoalHours));
  }, [defaultGoalHours, fast, now, open, timezone]);

  const validation = useMemo<DraftValidation>(() => {
    const current = now();
    const startAt = parseDateTimeInput(start, timezone);
    const endAt = mode === "active" ? null : parseDateTimeInput(end, timezone);
    const goalHours = Number(goal);
    let startError: string | undefined;
    let endError: string | undefined;
    const goalResult = validateGoalHours(goalHours);
    if (startAt === null) startError = "Enter a valid start time.";
    else if (startAt > current) startError = "Start time cannot be in the future.";
    if (mode !== "active") {
      if (endAt === null) endError = "Enter a valid end time.";
      else if (startAt !== null && endAt <= startAt) endError = "End time must be after start time.";
      else if (endAt > current) endError = "End time cannot be in the future.";
    }
    if (!startError && !endError && startAt !== null) {
      const overlaps = fasts.some((record) =>
        record.deletedAt === null && record.id !== fast?.id && intervalsOverlap(startAt, endAt, record.startAt, record.endAt),
      );
      if (overlaps) startError = "Fast overlaps an existing fast.";
    }
    const goalError = goalResult.ok ? undefined : goalResult.message;
    const valid = !startError && !endError && !goalError && startAt !== null && (mode === "active" || endAt !== null);
    const durationEnd = mode === "active" ? current : endAt;
    return {
      startAt,
      endAt,
      goalHours,
      startError,
      endError,
      goalError,
      valid,
      note: valid && durationEnd !== null ? `Duration ${formatCompactDuration(durationEnd - startAt)}` : "Fix the highlighted field to save.",
    };
  }, [end, fast?.id, fasts, goal, mode, now, start, timezone]);

  async function commit(action: () => void | Promise<void>) {
    setCommitting(true);
    try { await action(); } finally { setCommitting(false); }
  }

  const title = mode === "active" ? "Edit start time" : mode === "new" ? "Log a past fast" : "Edit fast";
  return (
    <Sheet open={open} title={title} onClose={onClose} isCommitting={committing}>
      <Field label="Started" type="datetime-local" value={start} error={validation.startError} onChange={(event) => setStart(event.target.value)} />
      {mode !== "active" ? (
        <Field label="Ended" type="datetime-local" value={end} error={validation.endError} onChange={(event) => setEnd(event.target.value)} />
      ) : null}
      {mode !== "active" ? (
        <Field label="Goal hours" type="number" min={1} max={168} step={0.5} value={goal} error={validation.goalError} onChange={(event) => setGoal(event.target.value)} />
      ) : null}
      <p className="edit-fast-note" aria-live="polite">{validation.note}</p>
      <div className="sheet-actions">
        <Button onClick={onClose} disabled={committing}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!validation.valid || committing}
          onClick={() => {
            if (!validation.valid || validation.startAt === null) return;
            void commit(() => onSave({ startAt: validation.startAt!, endAt: validation.endAt, goalHours: validation.goalHours }));
          }}
        >Save</Button>
      </div>
      {onDelete ? (
        <Button className="danger-action" disabled={committing} onClick={() => void commit(onDelete)}>
          {mode === "active" ? "Discard Fast" : "Delete fast"}
        </Button>
      ) : null}
    </Sheet>
  );
}
