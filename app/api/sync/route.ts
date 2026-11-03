import { env } from "cloudflare:workers";

import type { WorkerBindings } from "@/lib/server/bindings.server";
import { notificationStatementsForMutation } from "@/lib/notifications/jobs.server";
import { allowRequest, identityErrorResponse, jsonNoStore, readJsonBody } from "@/lib/server/http.server";
import { authenticateRequest } from "@/lib/server/identity.server";
import { logOperationalEvent } from "@/lib/server/observability.server";
import { synchronize } from "@/lib/server/sync.server";
import { MAX_SYNC_BODY_BYTES, parseSyncRequest } from "@/lib/sync/contract";

const bindings = env as unknown as WorkerBindings;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  try {
    const raw = await readJsonBody(request, MAX_SYNC_BODY_BYTES);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowRequest("sync", ip, 120, 60_000)) {
      return jsonNoStore({ error: { code: "rate_limited", message: "Try again shortly." } }, 429, requestId);
    }
    let input;
    try {
      input = parseSyncRequest(raw);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sync request is invalid.";
      return jsonNoStore({ error: { code: "validation_failure", message } }, 400, requestId);
    }
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const now = Date.now();
    const result = await synchronize(bindings.DB, auth, input, now, {
      notificationStatements: (mutation) => mutation.entity === "fast"
        ? notificationStatementsForMutation(bindings.DB, {
            logId: mutation.logId,
            operation: mutation.operation,
            payload: mutation.payload,
            now,
          })
        : [],
    });
    logOperationalEvent("sync_batch", {
      requestId,
      status: 200,
      durationMs: Date.now() - startedAt,
      syncMutations: input.mutations.length,
      syncChanges: result.changes.length,
      version: bindings.VERSION_METADATA?.id ?? "local",
    });
    return jsonNoStore(result, 200, requestId);
  } catch (cause) {
    const response = identityErrorResponse(cause, requestId);
    logOperationalEvent("sync_batch", {
      requestId,
      status: response.status,
      durationMs: Date.now() - startedAt,
      version: bindings.VERSION_METADATA?.id ?? "local",
    });
    return response;
  }
}
