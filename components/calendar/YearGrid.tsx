import { civilDateParts, civilDay, intensityLabel, type CivilDate, type YearHeatmapValue } from "@/lib/domain/calendar";
import { formatDate } from "@/lib/domain/locale";
import type { CalendarLayer, CalendarLayerValue } from "./calendar-layers";

export function YearGrid({ year, values, today, timezone, locale, layer = "fasting", layerValues = [], onSelectMonth, onSelectDay }: {
  year: number;
  values: readonly YearHeatmapValue[];
  today: CivilDate;
  timezone: string;
  locale: string;
  layer?: CalendarLayer;
  layerValues?: readonly CalendarLayerValue[];
  onSelectMonth: (month: number) => void;
  onSelectDay?: (date: CivilDate) => void;
}) {
  const byDate = new Map(values.map((value) => [value.date, value]));
  const layerByDate = new Map(layerValues.map((value) => [value.date, value]));
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <div className="year-grid" aria-label={`${year} ${layer} heatmap`}>
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const month = monthIndex + 1;
        const prefix = `${year}-${String(month).padStart(2, "0")}-`;
        const monthValues = values.filter((value) => value.date.startsWith(prefix));
        const label = monthFormat.format(Date.UTC(year, monthIndex, 1));
        const fastedDays = monthValues.filter((value) => value.milliseconds > 0);
        const layerMonthValues = layerValues.filter((value) => value.date.startsWith(prefix) && value.intensity > 0);
        const summary = layer === "fasting"
          ? (fastedDays.length === 0 ? `${label}: no fasting` : `${label}: ${fastedDays.map((value) => `${civilDateParts(value.date).day}, ${number.format(value.milliseconds / 3_600_000)} hours`).join("; ")}`)
          : (layerMonthValues.length === 0 ? `${label}: no ${layer} data` : `${label}: ${layerMonthValues.map((value) => `${civilDateParts(value.date).day}, ${value.description}`).join("; ")}`);
        return (
          <div className="year-row" role="group" aria-label={summary} key={month}>
            <button type="button" className="year-month" onClick={() => onSelectMonth(month)}>{label}</button>
            {Array.from({ length: 31 }, (_, dayIndex) => {
              const date = `${prefix}${String(dayIndex + 1).padStart(2, "0")}` as CivilDate;
              const value = byDate.get(date);
              if (!value) return <span className="year-day year-day-hidden" aria-hidden="true" key={date} />;
              const hours = value.milliseconds / 3_600_000;
              const dateLabel = formatDate(civilDay(date, timezone).startAt, locale, timezone);
              const layerValue = layerByDate.get(date);
              const intensity = layer === "fasting" ? value.intensity : layerValue?.intensity ?? 0;
              const description = layer === "fasting"
                ? `${number.format(hours)} hours fasted · ${intensityLabel(value.intensity)}`
                : layerValue?.description ?? `no ${layer} data`;
              return <span
                className={`year-day heat-${intensity}${date === today ? " is-today" : ""}`}
                title={`${dateLabel} · ${description}`}
                aria-hidden="true"
                onClick={onSelectDay ? () => onSelectDay(date) : undefined}
                key={date}
              />;
            })}
          </div>
        );
      })}
    </div>
  );
}
