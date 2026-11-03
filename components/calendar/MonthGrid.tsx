import { civilDateParts, civilDay, firstWeekday, intensityLabel, type CivilDate, type MonthCell } from "@/lib/domain/calendar";
import { formatDate } from "@/lib/domain/locale";
import type { CalendarLayer, CalendarLayerValue } from "./calendar-layers";

function weekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const sunday = Date.UTC(2024, 0, 7);
  const labels = Array.from({ length: 7 }, (_, index) => formatter.format(sunday + index * 86_400_000));
  return firstWeekday(locale) === 0 ? labels : [...labels.slice(1), labels[0]!];
}

export function MonthGrid({ title, cells, today, timezone, locale, layer = "fasting", layerValues = [], onSelect }: {
  title: string;
  cells: readonly MonthCell[];
  today: CivilDate;
  timezone: string;
  locale: string;
  layer?: CalendarLayer;
  layerValues?: readonly CalendarLayerValue[];
  onSelect: (date: CivilDate) => void;
}) {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const valuesByDate = new Map(layerValues.map((value) => [value.date, value]));
  return (
    <div className="month-grid" role="grid" aria-label={title}>
      {weekdayLabels(locale).map((label, index) => <span className="month-weekday" role="columnheader" key={`${label}-${index}`}>{label}</span>)}
      {cells.map((cell) => {
        if (!cell.inMonth) return <span className="month-cell month-cell-hidden" aria-hidden="true" key={cell.date} />;
        const { day } = civilDateParts(cell.date);
        const hours = cell.milliseconds / 3_600_000;
        const dateLabel = formatDate(civilDay(cell.date, timezone).startAt, locale, timezone, { month: "long", day: "numeric", year: "numeric" });
        const hoursLabel = `${number.format(hours)} ${hours === 1 ? "hour" : "hours"} fasted`;
        const layerValue = valuesByDate.get(cell.date);
        const intensity = layer === "fasting" ? cell.intensity : layerValue?.intensity ?? 0;
        const description = layer === "fasting"
          ? `${hoursLabel}, ${intensityLabel(cell.intensity)}`
          : layerValue?.description ?? "no data";
        return (
          <button
            type="button"
            className={`month-cell heat-${intensity}${cell.date === today ? " is-today" : ""}`}
            key={cell.date}
            aria-label={`${dateLabel}, ${description}`}
            onClick={() => onSelect(cell.date)}
          >
            <span>{day}</span>
            {layer === "fasting" ? (hours > 0 ? <small>{Math.round(hours)}h</small> : null) : <>
              {layerValue?.primary ? <small>{layerValue.primary}</small> : null}
              {layerValue?.secondary ? <small>{layerValue.secondary}</small> : null}
            </>}
          </button>
        );
      })}
    </div>
  );
}
