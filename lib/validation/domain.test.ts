import { describe, expect, it } from "vitest";
import { createFastRecord, validateFastRecord, validateLogPreferences } from "./domain";
import type { FastRecord } from "../domain/types";

const now = Date.parse("2024-01-03T00:00:00Z");
const logId = "00000000-0000-4000-8000-000000000001" as never;
const id = "00000000-0000-4000-8000-000000000002" as never;

describe("domain validation", () => {
  it("constructs a valid fast but rejects future, non-positive, and overlapping intervals", () => {
    const existing: FastRecord = {
      id: "00000000-0000-4000-8000-000000000003" as never,
      logId,
      startAt: Date.parse("2024-01-01T00:00:00Z") as never,
      endAt: Date.parse("2024-01-01T16:00:00Z") as never,
      goalHours: 16,
      revision: 1,
      updatedAt: now as never,
      deletedAt: null,
    };
    expect(createFastRecord({ id, logId, startAt: Date.parse("2024-01-02T00:00:00Z") as never, endAt: null, goalHours: 16 }, now, [existing])).toMatchObject({ ok: true });
    expect(createFastRecord({ id, logId, startAt: (now + 1) as never, endAt: null, goalHours: 16 }, now)).toMatchObject({ ok: false, code: "start_in_future" });
    expect(createFastRecord({ id, logId, startAt: now as never, endAt: now as never, goalHours: 16 }, now)).toMatchObject({ ok: false, code: "end_not_after_start" });
    expect(createFastRecord({ id, logId, startAt: Date.parse("2024-01-01T10:00:00Z") as never, endAt: Date.parse("2024-01-02T00:00:00Z") as never, goalHours: 16 }, now, [existing])).toMatchObject({ ok: false, code: "fast_overlap" });

    const active = { ...existing, id: "00000000-0000-4000-8000-000000000004" as never, endAt: null };
    expect(createFastRecord({ id, logId, startAt: Date.parse("2024-01-02T00:00:00Z") as never, endAt: null, goalHours: 16 }, now, [active])).toMatchObject({ ok: false, code: "active_fast_exists" });
  });

  it("narrows unknown records and preferences without throwing", () => {
    expect(validateFastRecord(null, now)).toMatchObject({ ok: false, code: "fast_not_object" });
    expect(validateLogPreferences({ timezone: "Not/AZone", theme: "system", weightUnit: "kg", defaultGoalHours: 16 })).toMatchObject({ ok: false, code: "invalid_timezone" });
    expect(validateLogPreferences({ timezone: "UTC", theme: "dark", weightUnit: "kg", defaultGoalHours: 16 })).toMatchObject({ ok: true });
  });
});
