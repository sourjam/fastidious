import type { MutationId } from "../domain/types";
import { applyServerState, markMutationsSending, setMutationStatus } from "../local-db/apply-server-state";
import type { FastidiousDatabase } from "../local-db/database";
import { META_KEY, type LocalMeta, type LocalMutation } from "../local-db/schema";
import {
  MAX_SYNC_BODY_BYTES,
  MAX_SYNC_MUTATIONS,
  SYNC_PROTOCOL_VERSION,
  type SyncRequest,
  type SyncResponse,
} from "./contract";

const MAX_SYNC_ITERATIONS = 10;

export class SyncTransportError extends Error {
  constructor(readonly kind: "offline" | "transient" | "validation" | "revoked" | "expired", message: string) {
    super(message);
    this.name = "SyncTransportError";
  }
}

export interface SyncTransport {
  send(secret: string, request: SyncRequest): Promise<SyncResponse>;
}

export interface SyncRunResult {
  status: "idle" | "synced" | "offline" | "error" | "revoked" | "expired";
  iterations: number;
}

export async function runSync(
  db: FastidiousDatabase,
  secret: string,
  transport: SyncTransport,
  now = () => Date.now(),
): Promise<SyncRunResult> {
  let synced = false;
  for (let iteration = 1; iteration <= MAX_SYNC_ITERATIONS; iteration += 1) {
    const meta = await db.meta.get(META_KEY);
    if (!meta?.logId) return { status: "idle", iterations: iteration - 1 };
    const pending = await db.mutations.where("status").equals("pending").sortBy("sequence");
    const batch = boundedBatch(meta, pending);
    const ids = batch.map((mutation) => mutation.mutationId);
    await markMutationsSending(db, ids);
    try {
      const response = await transport.send(secret, requestFrom(meta, batch));
      assertResponse(response);
      await applyServerState(db, {
        acknowledgedMutationIds: response.acknowledgedMutationIds,
        changes: response.changes,
        cursor: response.cursor,
        serverGeneration: response.serverGeneration,
        dataGeneration: response.dataGeneration,
        credentialGeneration: response.credentialGeneration,
        snapshot: response.snapshot,
        now: now(),
      });
      synced = true;
      const remaining = await db.mutations.where("status").equals("pending").count();
      if (!response.hasMore && remaining === 0) return { status: "synced", iterations: iteration };
    } catch (cause) {
      const error = classify(cause);
      if (error.kind === "validation") {
        await setMutationStatus(db, ids, "quarantined");
        await db.meta.update(META_KEY, { syncError: "validation", syncErrorCount: meta.syncErrorCount + 1 });
        return { status: "error", iterations: iteration };
      }
      await setMutationStatus(db, ids, "pending");
      if (error.kind === "offline") return { status: "offline", iterations: iteration };
      if (error.kind === "revoked") return { status: "revoked", iterations: iteration };
      if (error.kind === "expired") return { status: "expired", iterations: iteration };
      await db.meta.update(META_KEY, { syncError: "transient", syncErrorCount: meta.syncErrorCount + 1 });
      return { status: "error", iterations: iteration };
    }
  }
  return { status: synced ? "synced" : "idle", iterations: MAX_SYNC_ITERATIONS };
}

function requestFrom(meta: LocalMeta, mutations: LocalMutation[]): SyncRequest {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: meta.deviceId,
    cursor: meta.cursor,
    dataGeneration: meta.dataGeneration,
    mutations: mutations.map((mutation) => ({
      id: mutation.mutationId,
      sequence: mutation.sequence,
      entity: mutation.entityType === "log" ? "data" : mutation.entityType,
      operation: mutation.operation,
      payload: mutation.payload,
      dataGeneration: mutation.dataGeneration,
    })),
  };
}

function boundedBatch(meta: LocalMeta, pending: LocalMutation[]): LocalMutation[] {
  const batch: LocalMutation[] = [];
  for (const mutation of pending.slice(0, MAX_SYNC_MUTATIONS)) {
    const candidate = [...batch, mutation];
    const bytes = new TextEncoder().encode(JSON.stringify(requestFrom(meta, candidate))).byteLength;
    if (bytes > MAX_SYNC_BODY_BYTES) {
      if (batch.length === 0) batch.push(mutation);
      break;
    }
    batch.push(mutation);
  }
  return batch;
}

function assertResponse(response: SyncResponse): void {
  if (
    response.protocolVersion !== SYNC_PROTOCOL_VERSION ||
    !Number.isInteger(response.cursor) ||
    response.cursor < 0 ||
    !Number.isInteger(response.dataGeneration) ||
    !Array.isArray(response.acknowledgedMutationIds) ||
    !Array.isArray(response.changes) ||
    typeof response.hasMore !== "boolean"
  ) {
    throw new SyncTransportError("validation", "Sync response is invalid.");
  }
}

function classify(cause: unknown): SyncTransportError {
  if (cause instanceof SyncTransportError) return cause;
  return new SyncTransportError("transient", cause instanceof Error ? cause.message : "Sync failed.");
}

export function mutationIds(mutations: readonly LocalMutation[]): MutationId[] {
  return mutations.map((mutation) => mutation.mutationId);
}
