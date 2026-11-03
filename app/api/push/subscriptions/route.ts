import { env } from "cloudflare:workers";

import { asUpsertInput, parseDeviceId, parsePushSubscription } from "@/lib/notifications/subscription";
import type { WorkerBindings } from "@/lib/server/bindings.server";
import { RepositoryError } from "@/lib/server/errors.server";
import { allowRequest, identityErrorResponse, jsonNoStore, readJsonBody, validateSameOriginRequest } from "@/lib/server/http.server";
import { authenticateRequest } from "@/lib/server/identity.server";
import { PushRepository } from "@/lib/server/repositories/push.server";

const bindings = env as unknown as WorkerBindings;
const MAX_BODY_BYTES = 8_192;

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    validateSameOriginRequest(request);
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    if (!bindings.VAPID_PUBLIC_KEY) throw new RepositoryError("transient_database_failure", "Push reminders are not configured.");
    const deviceId = new URL(request.url).searchParams.get("deviceId");
    const subscription = deviceId
      ? (await new PushRepository(bindings.DB).listSubscriptions(auth.log.id)).find((item) => item.deviceId === parseDeviceId(deviceId))
      : undefined;
    return jsonNoStore({
      vapidPublicKey: bindings.VAPID_PUBLIC_KEY,
      preferences: subscription ? {
        enabled: subscription.enabled,
        advanceEnabled: subscription.advanceEnabled,
        advanceMinutes: subscription.advanceMinutes,
        goalEnabled: subscription.goalEnabled,
      } : undefined,
    }, 200, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = parsePushSubscription(await readJsonBody(request, MAX_BODY_BYTES));
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowRequest("push-registration", ip, 30, 60 * 60_000)) {
      return jsonNoStore({ error: { code: "rate_limited", message: "Try again later." } }, 429, requestId);
    }
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const saved = await new PushRepository(bindings.DB).upsertSubscription(asUpsertInput(input, {
      id: crypto.randomUUID(),
      logId: auth.log.id,
      now: Date.now(),
    }));
    return jsonNoStore({
      deviceId: saved.deviceId,
      preferences: {
        enabled: saved.enabled,
        advanceEnabled: saved.advanceEnabled,
        advanceMinutes: saved.advanceMinutes,
        goalEnabled: saved.goalEnabled,
      },
    }, 201, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}
