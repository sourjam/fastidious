import { fastDuration, goalLabel, metGoal } from "@/lib/domain/fast-view";
import { formatCompactDuration } from "@/lib/domain/fasts";
import { formatTime } from "@/lib/domain/locale";
import type { FastRecord } from "@/lib/domain/types";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

export function FastCompleteSheet({
  fast,
  timezone,
  onDone,
  onEdit,
  onResume,
  conflict,
}: {
  fast?: FastRecord;
  timezone: string;
  onDone: () => void;
  onEdit?: () => void;
  onResume: () => void | Promise<void>;
  conflict?: string;
}) {
  const now = Date.now();
  return (
    <Sheet open={Boolean(fast)} title="Fast complete" onClose={onDone}>
      {fast ? (
        <>
          <strong className="complete-duration">{formatCompactDuration(fastDuration(fast, now))}</strong>
          <p className="complete-summary">
            {metGoal(fast, now) ? "You hit your" : "Short of your"} {goalLabel(fast.goalHours)} goal. {formatTime(fast.startAt, navigator.language, timezone)} → {formatTime(fast.endAt!, navigator.language, timezone)}.
          </p>
          {conflict ? <p className="completion-conflict" role="alert">{conflict}</p> : null}
          <div className="sheet-actions">
            {onEdit ? <Button onClick={onEdit}>Edit Times</Button> : null}
            <Button variant="primary" onClick={onDone}>Done</Button>
          </div>
          <Button onClick={() => void onResume()}>Undo / Resume Fast</Button>
        </>
      ) : null}
    </Sheet>
  );
}
