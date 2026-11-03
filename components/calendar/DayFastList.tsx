import { formatCompactDuration } from "@/lib/domain/fasts";
import { goalLabel } from "@/lib/domain/fast-view";
import { formatDate, formatTime } from "@/lib/domain/locale";
import type { FastRecord } from "@/lib/domain/types";
import { Button } from "../ui/Button";
import { Tag } from "../ui/Tag";

export function DayFastList({ fasts, timezone, locale, now, onEdit, onAdd }: {
  fasts: readonly FastRecord[];
  timezone: string;
  locale: string;
  now: number;
  onEdit: (fast: FastRecord) => void;
  onAdd: () => void;
}) {
  const sorted = [...fasts].sort((first, second) => first.startAt - second.startAt);
  return (
    <div className="day-fast-list">
      {sorted.length === 0 ? <p className="day-empty">No fasting logged on this day.</p> : sorted.map((fast) => {
        const endAt = fast.endAt ?? now;
        const live = fast.endAt === null;
        const met = endAt - fast.startAt >= fast.goalHours * 3_600_000;
        const status = live ? "Live" : met ? "Goal met" : "Short";
        return (
          <button className="day-fast-row" type="button" key={fast.id} onClick={() => onEdit(fast)}>
            <span className="day-fast-range">{formatTime(fast.startAt, locale, timezone)} → {live ? "now" : formatTime(endAt, locale, timezone)}</span>
            <strong>{formatCompactDuration(endAt - fast.startAt)}</strong>
            <span className="day-fast-meta">
              {formatDate(fast.startAt, locale, timezone, { month: "short", day: "numeric" })}
              {live ? " · in progress" : ` – ${formatDate(endAt, locale, timezone, { month: "short", day: "numeric" })}`}
              {` · ${goalLabel(fast.goalHours)} goal`}
            </span>
            <Tag variant={live || met ? "accent" : "outline"}>{status}</Tag>
          </button>
        );
      })}
      <Button className="calendar-add-fast" onClick={onAdd}>+ Log a past fast</Button>
    </div>
  );
}
