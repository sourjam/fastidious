import { describe, expect, it } from "vitest";

import { MAX_SYNC_MUTATIONS, parseSyncRequest } from "./contract";

const DEVICE_ID = "50000000-0000-4000-8000-000000000001";

function mutation(index: number) {
  return {
    id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sequence: index + 1,
    entity: "fast",
    operation: "upsert",
    payload: {},
    dataGeneration: 1,
  };
}

describe("sync contract", () => {
  it("accepts a bounded ordered mutation batch", () => {
    const parsed = parseSyncRequest({
      protocolVersion: 1,
      deviceId: DEVICE_ID,
      cursor: 0,
      dataGeneration: 1,
      mutations: Array.from({ length: MAX_SYNC_MUTATIONS }, (_, index) => mutation(index)),
    });
    expect(parsed.mutations).toHaveLength(MAX_SYNC_MUTATIONS);
  });

  it("accepts v2 entities and rejects unknown entity names", () => {
    const request = {
      protocolVersion: 1,
      deviceId: DEVICE_ID,
      cursor: 0,
      dataGeneration: 1,
      mutations: [{ ...mutation(0), entity: "checklistCompletion" }],
    };

    expect(parseSyncRequest(request).mutations[0]?.entity).toBe("checklistCompletion");
    expect(() => parseSyncRequest({ ...request, mutations: [{ ...mutation(0), entity: "imageBytes" }] }))
      .toThrow("mutation");
  });

  it("rejects oversized or out-of-order batches", () => {
    const request = {
      protocolVersion: 1,
      deviceId: DEVICE_ID,
      cursor: 0,
      dataGeneration: 1,
      mutations: Array.from({ length: MAX_SYNC_MUTATIONS + 1 }, (_, index) => mutation(index)),
    };
    expect(() => parseSyncRequest(request)).toThrow("metadata");
    expect(() => parseSyncRequest({ ...request, mutations: [{ ...mutation(1), sequence: 2 }, { ...mutation(0), sequence: 1 }] })).toThrow("mutation");
  });
});
