import { formatDate } from "@/lib/domain/locale";
import type { IanaTimezone, WeightId, WeightRecord, WeightUnit } from "@/lib/domain/types";
import { convertWeight, latestWeight, roundWeightForDisplay, thirtyDayWeightDelta } from "@/lib/domain/weight";
import { Blueprint } from "../ui/Blueprint";
import { Button } from "../ui/Button";
import { WeightSparkline } from "./WeightSparkline";

function displayWeight(kilograms: number, unit: WeightUnit, locale: string): string {
  const value = roundWeightForDisplay(convertWeight(kilograms, "kg", unit));
  return `${value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
}

export function WeightCard({ weights, unit, locale, timezone, now, onAdd, onDelete }: {
  weights: readonly WeightRecord[];
  unit: WeightUnit;
  locale: string;
  timezone: IanaTimezone;
  now: number;
  onAdd: () => void;
  onDelete: (id: WeightId) => void;
}) {
  const latest = latestWeight(weights);
  const deltaKg = thirtyDayWeightDelta(weights, now);
  const recent = [...weights].sort((first, second) => second.measuredAt - first.measuredAt).slice(0, 4);
  const delta = deltaKg === null
    ? latest ? "One entry in 30 days" : "No entries yet"
    : `${deltaKg > 0 ? "+" : deltaKg < 0 ? "−" : ""}${displayWeight(Math.abs(deltaKg), unit, locale)} in 30 days`;

  return (
    <Blueprint className="weight-card">
      <div className="stats-card-heading">
        <h2>Weight</h2>
        <Button className="compact-button" onClick={onAdd}>+ Add</Button>
      </div>
      {latest ? (
        <>
          <div className="weight-summary">
            <strong>{displayWeight(latest.kilograms, unit, locale)}</strong>
            <span>{delta}</span>
          </div>
          <WeightSparkline weights={weights} unit={unit} locale={locale} timezone={timezone} />
          <div className="weight-list" aria-label="Recent weights">
            {recent.map((weight) => {
              const date = formatDate(weight.measuredAt, locale, timezone);
              return (
                <div className="weight-row" key={weight.id}>
                  <span>{date}</span>
                  <span>
                    <strong>{displayWeight(weight.kilograms, unit, locale)}</strong>
                    <button aria-label={`Delete weight from ${date}`} className="weight-delete" onClick={() => onDelete(weight.id)} type="button">×</button>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="weight-empty">
          <strong>No weight entries yet.</strong>
          <p>Add your first entry to see change over time.</p>
        </div>
      )}
    </Blueprint>
  );
}
