import { env } from "cloudflare:workers";

import type { WorkerBindings } from "@/lib/server/bindings.server";
import { identityErrorResponse, validateSameOriginRequest } from "@/lib/server/http.server";
import { authenticateRequest } from "@/lib/server/identity.server";
import { ImageAssetRepository } from "@/lib/server/repositories/images.server";

const bindings = env as unknown as WorkerBindings;
const variants = new Set(["thumbnail", "preview"]);

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    validateSameOriginRequest(request);
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const { assetId } = await context.params;
    const variant = new URL(request.url).searchParams.get("variant") ?? "preview";
    if (!variants.has(variant)) return new Response("Unknown image variant.", { status: 400, headers: { "cache-control": "no-store" } });
    const asset = await new ImageAssetRepository(bindings.DB).requireOwned(auth.log.id, assetId);
    const url = await bindings.IMAGES.hosted.image(asset.id).signedUrl({ variant, expiresIn: 60 });
    const delivered = await fetch(url);
    if (!delivered.ok || !delivered.body) throw new Error("Image delivery failed.");
    return new Response(delivered.body, {
      status: 200,
      headers: {
        "content-type": delivered.headers.get("content-type") ?? "image/webp",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (cause) {
    return identityErrorResponse(cause, requestId);
  }
}
