import { dayClockSegments, type CivilDay } from "@/lib/domain/calendar";
import { formatCompactDuration } from "@/lib/domain/fasts";
import type { FastRecord, MealRecord } from "@/lib/domain/types";

const SIZE = 300;
const CENTER = SIZE / 2;
const RADIUS = 118;
const STROKE = 22;

function point(fraction: number, radius: number): [number, number] {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return [CENTER + radius * Math.cos(angle), CENTER + radius * Math.sin(angle)];
}

function arcPath(start: number, end: number): string {
  const [startX, startY] = point(start, RADIUS);
  const [endX, endY] = point(end, RADIUS);
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${startX} ${startY} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${endX} ${endY}`;
}

export function DayClock({ day, fasts, meals = [], timezone = "UTC", now }: { day: CivilDay; fasts: readonly FastRecord[]; meals?: readonly MealRecord[]; timezone?: string; now: number }) {
  const segments = dayClockSegments(day, fasts, now);
  const dayDuration = day.endAt - day.startAt;
  const total = segments.reduce((sum, segment) => sum + (segment.endFraction - segment.startFraction) * dayDuration, 0);
  const viewingToday = now >= day.startAt && now < day.endAt;
  const nowFraction = (now - day.startAt) / dayDuration;
  const summaryId = `clock-summary-${day.date}`;

  return (
    <div className="day-clock-wrap">
      <svg className="day-clock" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Fasting clock for ${day.date}`} aria-describedby={summaryId}>
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--color-divider)" strokeWidth={STROKE} />
        {segments.map((segment, index) => segment.endFraction - segment.startFraction >= 0.999 ? (
          <circle key={index} cx={CENTER} cy={CENTER} r={RADIUS} fill="none" className={segment.live ? "clock-live" : "clock-completed"} strokeWidth={STROKE} />
        ) : (
          <path key={index} d={arcPath(segment.startFraction, segment.endFraction)} fill="none" className={segment.live ? "clock-live" : "clock-completed"} strokeWidth={STROKE} />
        ))}
        {Array.from({ length: 24 }, (_, hour) => {
          const major = hour % 6 === 0;
          const [x1, y1] = point(hour / 24, RADIUS - STROKE / 2);
          const [x2, y2] = point(hour / 24, RADIUS - STROKE / 2 - (major ? 9 : 5));
          return <line key={hour} x1={x1} y1={y1} x2={x2} y2={y2} className="clock-tick" strokeWidth={major ? 2 : 1} />;
        })}
        {[[0, "12a"], [6, "6a"], [12, "12p"], [18, "6p"]].map(([hour, label]) => {
          const [x, y] = point(Number(hour) / 24, RADIUS - STROKE / 2 - 20);
          return <text key={label} x={x} y={y + 4} textAnchor="middle" className="clock-label">{label}</text>;
        })}
        {meals.filter((meal) => meal.deletedAt === null && meal.eatenAt >= day.startAt && meal.eatenAt < day.endAt).map((meal) => {
          const local = localClockTime(meal.eatenAt, timezone);
          const [x, y] = point((local.hour * 60 + local.minute) / (24 * 60), RADIUS);
          return <rect key={meal.id} x={x - 5} y={y - 5} width="10" height="10" className="clock-meal" data-meal-time={`${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`} />;
        })}
        {viewingToday ? (() => {
          const [x1, y1] = point(nowFraction, RADIUS - STROKE / 2 - 2);
          const [x2, y2] = point(nowFraction, RADIUS + STROKE / 2 + 2);
          return <line x1={x1} y1={y1} x2={x2} y2={y2} className="clock-now" strokeWidth="2" />;
        })() : null}
        <text x={CENTER} y={CENTER + 6} textAnchor="middle" className="clock-total">{formatCompactDuration(total)}</text>
        <text x={CENTER} y={CENTER + 30} textAnchor="middle" className="clock-subtitle">FASTED</text>
      </svg>
      <p className="visually-hidden" id={summaryId}>{formatCompactDuration(total)} fasted in {segments.length} {segments.length === 1 ? "interval" : "intervals"} on this day.</p>
    </div>
  );
}

function localClockTime(at: number, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
}
