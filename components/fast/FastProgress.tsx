import { goalPosition, progressScaleMaximum, stageMarkerPositions } from "@/lib/domain/fasts";

export function FastProgress({ elapsedMs, goalHours }: { elapsedMs: number; goalHours: number }) {
  const maximum = progressScaleMaximum(goalHours, elapsedMs);
  const elapsedHours = elapsedMs / 3_600_000;
  const progress = Math.min(100, (elapsedHours / maximum) * 100);
  const markers = stageMarkerPositions(maximum);
  return (
    <div className="fast-progress" role="progressbar" aria-valuemin={0} aria-valuemax={goalHours} aria-valuenow={Math.min(elapsedHours, goalHours)} aria-valuetext={`${elapsedHours.toFixed(1)} of ${goalHours} hours`}>
      <div className="fast-progress-frame">
        <span className="fast-progress-fill" style={{ width: `${progress}%` }} />
        {markers.map(({ stage, positionPercent }) => (
          <span className="fast-progress-tick" key={stage.thresholdHours} style={{ left: `${positionPercent}%` }} />
        ))}
        <span className="fast-progress-goal" style={{ left: `${goalPosition(goalHours, maximum)}%` }} />
      </div>
      <div className="fast-progress-labels" aria-hidden="true">
        {markers.map(({ stage, positionPercent }) => (
          <span className={elapsedHours >= stage.thresholdHours ? "stage-marker-reached" : ""} key={stage.thresholdHours} style={{ left: `${positionPercent}%` }}>
            <strong>{stage.thresholdHours}h</strong><small>{stage.shortName}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
