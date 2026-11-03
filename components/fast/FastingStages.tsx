import { currentFastingStage } from "@/lib/domain/fasts";
import { FASTING_STAGES } from "@/lib/domain/stages";
import { Blueprint } from "../ui/Blueprint";
import { Tag } from "../ui/Tag";

export function FastingStages({ elapsedMs, active }: { elapsedMs: number; active: boolean }) {
  const current = active ? currentFastingStage(elapsedMs) : undefined;
  return (
    <Blueprint className="fasting-stages">
      <div className="fasting-stages-heading">
        <h2>Fasting stages</h2>
        <span>Approximate, varies by person</span>
      </div>
      {FASTING_STAGES.map((stage) => {
        const reached = active && elapsedMs >= stage.thresholdHours * 3_600_000;
        const isCurrent = current === stage;
        return (
          <div className={`fasting-stage ${reached ? "fasting-stage-reached" : ""}`} key={stage.thresholdHours}>
            <strong>{stage.thresholdHours}h</strong>
            <div>
              <span className="fasting-stage-name">{stage.name}</span>
              {isCurrent ? <Tag variant="accent">Now</Tag> : null}
              {isCurrent ? <p>{stage.description}</p> : null}
            </div>
          </div>
        );
      })}
    </Blueprint>
  );
}
