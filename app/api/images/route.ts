import { env } from "cloudflare:workers";

import type { WorkerBindings } from "@/lib/server/bindings.server";
import { identityErrorResponse, jsonNoStore, validateSameOriginRequest } from "@/lib/server/http.server";
import { authenticateRequest } from "@/lib/server/identity.server";
import { ImageUploadError, MAX_IMAGE_BYTES, uploadOwnedImage } from "@/lib/server/images.server";

const bindings = env as unknown as WorkerBindings;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    validateSameOriginRequest(request);
    const auth = await authenticateRequest(request, bindings.DB, bindings.SECRET_DIGEST_PEPPER);
    const uploadKey = request.headers.get("x-fastidious-upload-key") ?? "";
    const mimeType = (request.headers.get("content-type") ?? "").split(";", 1)[0]!;
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new ImageUploadError("image_too_large", "Images must be 5 MB or smaller.");
    const bytes = await request.arrayBuffer();
    const asset = await uploadOwnedImage({ db: bindings.DB, images: bindings.IMAGES, logId: auth.log.id, uploadKey, bytes, mimeType, now: Date.now() });
    return jsonNoStore({ assetId: asset.id }, 201, requestId);
  } catch (cause) {
    if (cause instanceof ImageUploadError) {
      const status = cause.code === "image_quota" ? 429 : 400;
      return jsonNoStore({ error: { code: cause.code, message: cause.message } }, status, requestId);
    }
    return identityErrorResponse(cause, requestId);
  }
}
