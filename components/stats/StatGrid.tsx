import { formatCompactDuration } from "@/lib/domain/fasts";
import type { CompletedFastStatistics, StreakStatistics } from "@/lib/domain/statistics";
import { Blueprint } from "../ui/Blueprint";

export function StatGrid({ summary, streak, locale }: {
  summary: CompletedFastStatistics;
  streak: StreakStatistics;
  locale: string;
}) {
  const duration = (hours: number) => formatCompactDuration(hours * 3_600_000);
  const values = [
    ["Current streak", `${streak.current} ${streak.current === 1 ? "day" : "days"}`],
    ["Longest streak", `${streak.longest} ${streak.longest === 1 ? "day" : "days"}`],
    ["Fasts logged", summary.count.toLocaleString(locale)],
    ["Average", summary.count ? duration(summary.averageHours) : "—"],
    ["Longest fast", summary.count ? duration(summary.longestHours) : "—"],
    ["Total hours", summary.count ? Math.round(summary.totalHours).toLocaleString(locale) : "—"],
  ];

  return (
    <div className="stat-grid" aria-label="Statistics summary">
      {values.map(([label, value]) => (
        <Blueprint className="stat-cell" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </Blueprint>
      ))}
    </div>
  );
}
