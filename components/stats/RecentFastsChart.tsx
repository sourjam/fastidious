import { formatCompactDuration, HOUR_MS } from "@/lib/domain/fasts";
import { formatDate } from "@/lib/domain/locale";
import { goalHitCount, goalMet } from "@/lib/domain/statistics";
import type { FastRecord, IanaTimezone } from "@/lib/domain/types";
import { Blueprint } from "../ui/Blueprint";

function goalText(hours: number, locale: string): string {
  return `${hours.toLocaleString(locale, { maximumFractionDigits: 1 })} hour goal`;
}

export function RecentFastsChart({ fasts, locale, timezone }: {
  fasts: readonly FastRecord[];
  locale: string;
  timezone: IanaTimezone;
}) {
  const maximum = Math.max(1, ...fasts.map((fast) => Math.max(fast.endAt! - fast.startAt, fast.goalHours * HOUR_MS)));
  const hits = goalHitCount(fasts);

  return (
    <Blueprint className="recent-fasts-card">
      <div className="stats-card-heading">
        <h2>Last 14 fasts</h2>
        <span>{hits} of {fasts.length} hit goal</span>
      </div>
      {fasts.length ? (
        <div className="recent-fasts-chart" role="group" aria-label={`Last ${fasts.length} completed fasts. ${hits} hit goal.`}>
          {fasts.map((fast) => {
            const duration = fast.endAt! - fast.startAt;
            const met = goalMet(fast);
            const label = `${formatDate(fast.endAt!, locale, timezone)}: ${formatCompactDuration(duration)} fast, ${goalText(fast.goalHours, locale)}, ${met ? "goal met" : "missed goal"}`;
            return (
              <span
                aria-label={label}
                className={`recent-fast-bar recent-fast-bar-${met ? "met" : "missed"}`}
                data-status={met ? "met" : "missed"}
                key={fast.id}
                role="img"
                style={{ height: `${Math.max(3, duration / maximum * 100)}%` }}
                title={label}
              />
            );
          })}
        </div>
      ) : <p className="stats-empty">Completed fasts will appear here.</p>}
    </Blueprint>
  );
}
