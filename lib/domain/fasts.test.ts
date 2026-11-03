import { describe, expect, it } from "vitest";
import {
  currentFastingStage,
  formatCompactDuration,
  formatTimerDuration,
  goalPosition,
  intervalsOverlap,
  isGoalReached,
  progressScaleMaximum,
  stageMarkerPositions,
  timerViewModel,
  validateGoalHours,
} from "./fasts";

const hour = 3_600_000;

describe("fast calculations", () => {
  it("counts the exact goal boundary as reached", () => {
    expect(isGoalReached(1_000, 16, 1_000 + 16 * hour)).toBe(true);
    expect(timerViewModel({ startAt: 1_000 as never, goalHours: 16 }, 1_000 + 16 * hour)).toMatchObject({
      goalReached: true,
      overGoalMs: 0,
      subline: "Goal reached · +0m",
    });
  });

  it("uses half-open intervals so intersections overlap but touching endpoints do not", () => {
    expect(intervalsOverlap(0, 10, 9, 20)).toBe(true);
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(10, 20, 0, 10)).toBe(false);
    expect(intervalsOverlap(0, null, 20, 30)).toBe(true);
  });

  it("accepts only half-hour goals from 1 through 168 hours", () => {
    expect(validateGoalHours(0.5).ok).toBe(false);
    expect(validateGoalHours(1).ok).toBe(true);
    expect(validateGoalHours(1.5).ok).toBe(true);
    expect(validateGoalHours(168).ok).toBe(true);
    expect(validateGoalHours(168.5).ok).toBe(false);
  });

  it.each([0, 4, 12, 18, 24, 48, 72])("changes stage exactly at %ih", (hours) => {
    expect(currentFastingStage(hours * hour).thresholdHours).toBe(hours);
    if (hours > 0) expect(currentFastingStage(hours * hour - 1).thresholdHours).toBeLessThan(hours);
  });

  it("builds deterministic progress positions and duration labels", () => {
    const maximum = progressScaleMaximum(16, 17 * hour);
    expect(maximum).toBe(18);
    expect(goalPosition(16, maximum)).toBeCloseTo(88.888);
    expect(stageMarkerPositions(maximum).map(({ stage }) => stage.thresholdHours)).toEqual([4, 12, 18]);
    expect(formatTimerDuration(25 * hour + 61_000)).toBe("25:01:01");
    expect(formatCompactDuration(61 * 60_000)).toBe("1h 01m");
  });
});
