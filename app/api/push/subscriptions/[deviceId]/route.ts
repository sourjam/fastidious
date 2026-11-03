import { env } from "cloudflare:workers";

import { parseDeviceId } from "@/lib/notifications/subscription";
import type { WorkerBindings } from "@/lib/server/bindings.server";
import { allowRequest, identityErrorResponse, jsonNoStore, validateSameOriginRequest } from "@/lib/server/http.server";
import { authenticateRequest } from "@/lib/server/identity.server";
import { PushRepository } from "@/lib/server/repositories/push.server";

const bindings = env as unknown as WorkerBindings;

export async function DELETE(request: Request, context: { params: Promise<{ deviceId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    validateSameOriginRequest(request);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowRequest("push-registration", ip, 30, 60 * 60_000)) {
      return jsonNoStore({ error: { code: "rate_limited", message: "Try again later." } }, 429, requestId);
    }
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const { deviceId } = await context.params;
    await new PushRepository(bindings.DB).deleteSubscription(auth.log.id, parseDeviceId(deviceId));
    return jsonNoStore({ removed: true }, 200, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}
