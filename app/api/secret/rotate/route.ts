import { env } from "cloudflare:workers";

import type { WorkerBindings } from "@/lib/server/bindings.server";
import { allowRequest, identityErrorResponse, jsonNoStore, readJsonBody } from "@/lib/server/http.server";
import { authenticateRequest, rotateSecret } from "@/lib/server/identity.server";

const bindings = env as unknown as WorkerBindings;
const MAX_ROTATION_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const confirmation = await readJsonBody(request, MAX_ROTATION_BODY_BYTES);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowRequest("rotate", ip, 5, 60 * 60_000)) {
      return jsonNoStore({ error: { code: "rate_limited", message: "Try again later." } }, 429, requestId);
    }
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const result = await rotateSecret(bindings.DB, auth, confirmation, bindings.SECRET_DIGEST_PEPPER);
    return jsonNoStore(result, 200, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}
