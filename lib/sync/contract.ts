import type { DeviceId, MutationId } from "../domain/types";
import type { MutationEntity, ServerChange, ServerSnapshot } from "../local-db/schema";

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_SYNC_MUTATIONS = 50;
export const MAX_SYNC_CHANGES = 100;
export const MAX_SYNC_BODY_BYTES = 256_000;

export interface SyncMutation {
  id: MutationId;
  sequence: number;
  entity: Exclude<MutationEntity, "log"> | "data";
  operation: string;
  payload: unknown;
  dataGeneration: number;
}

export interface SyncRequest {
  protocolVersion: 1;
  deviceId: DeviceId;
  cursor: number;
  dataGeneration: number;
  mutations: SyncMutation[];
}

export interface SyncResponse {
  protocolVersion: 1;
  cursor: number;
  dataGeneration: number;
  credentialGeneration: number;
  serverGeneration: number;
  acknowledgedMutationIds: MutationId[];
  changes: ServerChange[];
  hasMore: boolean;
  snapshot?: ServerSnapshot;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYNC_ENTITIES = new Set<SyncMutation["entity"]>([
  "fast",
  "weight",
  "preferences",
  "nutritionTargets",
  "category",
  "food",
  "meal",
  "activity",
  "exercise",
  "checklistItem",
  "checklistCompletion",
  "groceryItem",
  "data",
]);

export function parseSyncRequest(value: unknown): SyncRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Sync request must be an object.");
  const input = value as Record<string, unknown>;
  if (
    input.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    typeof input.deviceId !== "string" ||
    !UUID.test(input.deviceId) ||
    !nonNegativeInteger(input.cursor) ||
    !positiveInteger(input.dataGeneration) ||
    !Array.isArray(input.mutations) ||
    input.mutations.length > MAX_SYNC_MUTATIONS
  ) {
    throw new Error("Sync request metadata is invalid.");
  }
  let previousSequence = 0;
  const mutations = input.mutations.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Sync mutation is invalid.");
    const mutation = raw as Record<string, unknown>;
    if (
      typeof mutation.id !== "string" ||
      !UUID.test(mutation.id) ||
      !positiveInteger(mutation.sequence) ||
      mutation.sequence <= previousSequence ||
      typeof mutation.entity !== "string" ||
      !SYNC_ENTITIES.has(mutation.entity as SyncMutation["entity"]) ||
      typeof mutation.operation !== "string" ||
      mutation.operation.length === 0 ||
      mutation.operation.length > 40 ||
      !positiveInteger(mutation.dataGeneration)
    ) {
      throw new Error("Sync mutation is invalid.");
    }
    previousSequence = mutation.sequence;
    return {
      id: mutation.id as MutationId,
      sequence: mutation.sequence,
      entity: mutation.entity as SyncMutation["entity"],
      operation: mutation.operation,
      payload: mutation.payload,
      dataGeneration: mutation.dataGeneration,
    };
  });
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: input.deviceId as DeviceId,
    cursor: input.cursor,
    dataGeneration: input.dataGeneration,
    mutations,
  };
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
