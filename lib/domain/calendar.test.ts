import { describe, expect, it } from "vitest";
import {
  civilDay,
  dayClockSegments,
  firstWeekday,
  intensityBucket,
  intensityLabel,
  monthGrid,
  splitFastAcrossDays,
  totalFastedForDay,
  yearHeatmap,
} from "./calendar";
import type { FastRecord, IanaTimezone } from "./types";

const utc = "UTC" as IanaTimezone;
const newYork = "America/New_York" as IanaTimezone;

function fast(startAt: string, endAt: string | null): FastRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001" as never,
    logId: "00000000-0000-4000-8000-000000000002" as never,
    startAt: Date.parse(startAt) as never,
    endAt: endAt === null ? null : (Date.parse(endAt) as never),
    goalHours: 16,
    revision: 1,
    updatedAt: Date.parse("2024-01-03T00:00:00Z") as never,
    deletedAt: null,
  };
}

describe("calendar calculations", () => {
  it("splits a fast at civil midnight and totals each clipped overlap", () => {
    const record = fast("2024-01-01T22:00:00Z", "2024-01-02T02:00:00Z");
    expect(splitFastAcrossDays(record, utc, Date.parse("2024-01-03T00:00:00Z"))).toEqual([
      expect.objectContaining({ date: "2024-01-01", milliseconds: 2 * 3_600_000 }),
      expect.objectContaining({ date: "2024-01-02", milliseconds: 2 * 3_600_000 }),
    ]);
    expect(totalFastedForDay("2024-01-02", [record], utc, Date.parse("2024-01-03T00:00:00Z"))).toBe(2 * 3_600_000);
  });

  it("uses 23-hour and 25-hour civil days across New York DST transitions", () => {
    const spring = civilDay("2024-03-10", newYork);
    const fall = civilDay("2024-11-03", newYork);
    expect(spring.endAt - spring.startAt).toBe(23 * 3_600_000);
    expect(fall.endAt - fall.startAt).toBe(25 * 3_600_000);
    expect(splitFastAcrossDays({ startAt: spring.startAt as never, endAt: spring.endAt as never }, newYork, spring.endAt)[0]?.milliseconds).toBe(23 * 3_600_000);
  });

  it("maps month intensity boundaries to named heat levels", () => {
    const buckets = [0, 0.1, 7.99, 8, 13.99, 14, 17.99, 18, 21.99, 22].map(intensityBucket);
    expect(buckets).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect([1, 2, 3, 4, 5].map((bucket) => intensityLabel(bucket as 1 | 2 | 3 | 4 | 5))).toEqual([
      "under 8 hours",
      "8 to under 14 hours",
      "14 to under 18 hours",
      "18 to under 22 hours",
      "22 hours or more",
    ]);
  });

  it("maps clock arcs across the actual duration of a DST civil day", () => {
    const day = civilDay("2024-03-10", newYork);
    const segment = dayClockSegments(day, [fast(
      new Date(day.startAt).toISOString(),
      new Date(day.startAt + 11.5 * 3_600_000).toISOString(),
    )], day.endAt)[0];
    expect(segment).toEqual({ startFraction: 0, endFraction: 0.5, live: false });
  });

  it("derives first weekdays and generates complete month and year values", () => {
    expect(firstWeekday("en-US")).toBe(0);
    expect(firstWeekday("en-GB")).toBe(1);
    expect(monthGrid(2024, 2, [], utc, "en-US", Date.parse("2024-03-01T00:00:00Z"))).toHaveLength(42);
    expect(yearHeatmap(2024, [], utc, Date.parse("2025-01-01T00:00:00Z"))).toHaveLength(366);
  });
});
