import { formatDate } from "@/lib/domain/locale";
import type { IanaTimezone, WeightRecord, WeightUnit } from "@/lib/domain/types";
import { convertWeight, normalizeWeightSparkline, roundWeightForDisplay } from "@/lib/domain/weight";

function formatWeight(kilograms: number, unit: WeightUnit, locale: string): string {
  return `${roundWeightForDisplay(convertWeight(kilograms, "kg", unit)).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${unit}`;
}

export function WeightSparkline({ weights, unit, locale, timezone }: {
  weights: readonly WeightRecord[];
  unit: WeightUnit;
  locale: string;
  timezone: IanaTimezone;
}) {
  const points = normalizeWeightSparkline(weights);
  if (!points.length) return null;

  return (
    <div className="weight-sparkline" role="group" aria-label={`Weight history, ${points.length} entries`}>
      {points.map(({ weight, y }) => {
        const label = `${formatDate(weight.measuredAt, locale, timezone)}: ${formatWeight(weight.kilograms, unit, locale)}`;
        return <span aria-label={label} className="weight-sparkline-bar" key={weight.id} role="img" style={{ height: `${20 + y * 80}%` }} title={label} />;
      })}
    </div>
  );
}
