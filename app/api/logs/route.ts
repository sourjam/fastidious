import { env } from "cloudflare:workers";

import type { WorkerBindings } from "@/lib/server/bindings.server";
import { allowLogCreation, identityErrorResponse, jsonNoStore, readJsonBody, validateSameOriginRequest } from "@/lib/server/http.server";
import { authenticateRequest, createLog, loadSnapshot } from "@/lib/server/identity.server";

const bindings = env as unknown as WorkerBindings;
const MAX_CREATE_BODY_BYTES = 1_024;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = await readJsonBody(request, MAX_CREATE_BODY_BYTES);
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!allowLogCreation(ip)) return jsonNoStore({ error: { code: "rate_limited", message: "Try again shortly." } }, 429, requestId);
    return jsonNoStore(await createLog(bindings.DB, input, bindings.SECRET_DIGEST_PEPPER), 201, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    validateSameOriginRequest(request);
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    return jsonNoStore({ snapshot: await loadSnapshot(bindings.DB, auth.log) }, 200, requestId);
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}
