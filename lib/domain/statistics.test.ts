import { describe, expect, it } from "vitest";
import { completedFastStatistics, goalHitCount, lastCompletedFasts, streakStatistics } from "./statistics";
import type { FastRecord, IanaTimezone } from "./types";

function fast(end: string, durationHours: number, goalHours = 16): FastRecord {
  const endAt = Date.parse(end);
  return {
    id: "00000000-0000-4000-8000-000000000002" as never,
    logId: "00000000-0000-4000-8000-000000000001" as never,
    startAt: (endAt - durationHours * 3_600_000) as never,
    endAt: endAt as never,
    goalHours,
    revision: 1,
    updatedAt: endAt as never,
    deletedAt: null,
  };
}

describe("completed-fast statistics", () => {
  it("starts the current streak yesterday when today has no qualifying fast", () => {
    const records = [
      fast("2024-01-08T18:00:00Z", 16),
      fast("2024-01-09T18:00:00Z", 16),
      fast("2024-01-10T18:00:00Z", 15),
    ];
    expect(streakStatistics(records, "UTC" as IanaTimezone, Date.parse("2024-01-10T20:00:00Z"))).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it("ignores completed fasts that miss their goals in streaks and goal hits", () => {
    const records = [fast("2024-01-08T18:00:00Z", 16), fast("2024-01-09T18:00:00Z", 15)];
    expect(streakStatistics(records, "UTC" as IanaTimezone, Date.parse("2024-01-10T12:00:00Z")).current).toBe(0);
    expect(goalHitCount(records)).toBe(1);
  });

  it("summarizes completed fasts and returns the latest 14 chronologically", () => {
    const records = Array.from({ length: 15 }, (_, index) => fast(`2024-01-${String(index + 1).padStart(2, "0")}T18:00:00Z`, index + 1, 1));
    expect(completedFastStatistics(records)).toEqual({ count: 15, averageHours: 8, longestHours: 15, totalHours: 120 });
    expect(lastCompletedFasts(records)).toHaveLength(14);
    expect(lastCompletedFasts(records)[0]?.endAt).toBe(Date.parse("2024-01-02T18:00:00Z"));
  });
});
