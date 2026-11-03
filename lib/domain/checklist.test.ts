import { describe, expect, it } from "vitest";
import {
  checklistItemState,
  checklistPeriodKey,
  dailyChecklistProgress,
  toggleChecklistCompletion,
} from "./checklist";
import type { ChecklistCompletionRecord, ChecklistItemRecord, IanaTimezone } from "./types";

const newYork = "America/New_York" as IanaTimezone;

describe("checklist periods", () => {
  it("derives daily, Sunday-week, and monthly identities in the log timezone", () => {
    const lateSaturday = Date.parse("2026-11-01T03:30:00Z");
    const earlySunday = Date.parse("2026-11-01T05:30:00Z");

    expect(checklistPeriodKey("daily", lateSaturday, newYork)).toBe("day:2026-10-31");
    expect(checklistPeriodKey("weekly", lateSaturday, newYork)).toBe("week:2026-10-25");
    expect(checklistPeriodKey("monthly", lateSaturday, newYork)).toBe("month:2026-10");
    expect(checklistPeriodKey("weekly", earlySunday, newYork)).toBe("week:2026-11-01");
    expect(checklistPeriodKey("monthly", earlySunday, newYork)).toBe("month:2026-11");
  });

  it("calculates daily calendar progress without weekly or monthly items", () => {
    const logId = "00000000-0000-4000-8000-000000000001" as never;
    const item = (id: string, cadence: "daily" | "weekly" | "monthly", deletedAt: number | null = null): ChecklistItemRecord => ({
      id: id as never,
      logId,
      name: id,
      cadence,
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: deletedAt as never,
    });
    const dailyOne = item("00000000-0000-4000-8000-000000000511", "daily");
    const dailyTwo = item("00000000-0000-4000-8000-000000000512", "daily");
    const weekly = item("00000000-0000-4000-8000-000000000513", "weekly");
    const deleted = item("00000000-0000-4000-8000-000000000514", "daily", 1);
    const at = Date.parse("2026-11-01T17:00:00Z");
    const completion: ChecklistCompletionRecord = {
      id: "00000000-0000-4000-8000-000000000515" as never,
      logId,
      checklistItemId: dailyOne.id,
      periodKey: checklistPeriodKey("daily", at, newYork),
      completedAt: at as never,
      revision: 0,
      updatedAt: at as never,
      deletedAt: null,
    };

    expect(dailyChecklistProgress([dailyOne, dailyTwo, weekly, deleted], [completion], at, newYork)).toEqual({
      completed: 1,
      total: 2,
      ratio: 0.5,
    });
  });

  it("reports checklist completion state for the selected period", () => {
    const item: ChecklistItemRecord = {
      id: "00000000-0000-4000-8000-000000000521" as never,
      logId: "00000000-0000-4000-8000-000000000001" as never,
      name: "Weekly weigh-in",
      cadence: "weekly",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };
    const completedAt = Date.parse("2026-11-02T17:00:00Z");
    const completion: ChecklistCompletionRecord = {
      id: "00000000-0000-4000-8000-000000000522" as never,
      logId: item.logId,
      checklistItemId: item.id,
      periodKey: checklistPeriodKey("weekly", completedAt, newYork),
      completedAt: completedAt as never,
      revision: 0,
      updatedAt: completedAt as never,
      deletedAt: null,
    };

    expect(checklistItemState(item, [completion], Date.parse("2026-11-06T17:00:00Z"), newYork)).toEqual({
      completed: true,
      completedAt,
      periodKey: "week:2026-11-01",
    });
  });

  it("toggles at most one weekly completion inside a Sunday–Saturday period", () => {
    const item: ChecklistItemRecord = {
      id: "00000000-0000-4000-8000-000000000501" as never,
      logId: "00000000-0000-4000-8000-000000000001" as never,
      name: "Weekly weigh-in",
      cadence: "weekly",
      externalUrl: null,
      imageAssetId: null,
      sortOrder: 0,
      revision: 0,
      updatedAt: 0 as never,
      deletedAt: null,
    };
    const completedAt = Date.parse("2026-11-02T17:00:00Z");
    const completion: ChecklistCompletionRecord = {
      id: "00000000-0000-4000-8000-000000000502" as never,
      logId: item.logId,
      checklistItemId: item.id,
      periodKey: checklistPeriodKey(item.cadence, completedAt, newYork),
      completedAt: completedAt as never,
      revision: 0,
      updatedAt: completedAt as never,
      deletedAt: null,
    };

    expect(toggleChecklistCompletion(item, [completion], Date.parse("2026-11-06T17:00:00Z"), newYork, "unused" as never)).toEqual([]);
    expect(toggleChecklistCompletion(item, [completion], Date.parse("2026-11-08T17:00:00Z"), newYork, "00000000-0000-4000-8000-000000000503" as never)).toEqual([
      completion,
      expect.objectContaining({ periodKey: "week:2026-11-08" }),
    ]);
  });
});
