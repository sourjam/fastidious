import type { ImageAssetId, LogId } from "../domain/types";
import { RepositoryError } from "./errors.server";
import { ImageAssetRepository, type ImageAssetRecord } from "./repositories/images.server";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGES_PER_LOG = 100;
export const MAX_IMAGE_UPLOADS_PER_HOUR = 20;
export const IMAGE_DELETE_GRACE_MS = 24 * 60 * 60 * 1_000;

export class ImageUploadError extends Error {
  constructor(readonly code: "invalid_image" | "image_too_large" | "image_quota", message: string) {
    super(message);
  }
}

export async function uploadOwnedImage(input: {
  db: D1Database;
  images: ImagesBinding;
  logId: LogId;
  uploadKey: string;
  bytes: ArrayBuffer;
  mimeType: string;
  now: number;
}): Promise<ImageAssetRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(input.uploadKey)) throw new ImageUploadError("invalid_image", "Upload key is invalid.");
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageUploadError("image_too_large", "Images must be 5 MB or smaller.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(input.mimeType)) throw new ImageUploadError("invalid_image", "Choose a JPEG, PNG, or WebP image.");
  const repository = new ImageAssetRepository(input.db);
  const existing = await repository.findByUploadKey(input.logId, input.uploadKey);
  if (existing) return existing;
  const [count, recent] = await Promise.all([
    repository.countForLog(input.logId),
    repository.countRecent(input.logId, input.now - 60 * 60 * 1_000),
  ]);
  if (count >= MAX_IMAGES_PER_LOG || recent >= MAX_IMAGE_UPLOADS_PER_HOUR) {
    throw new ImageUploadError("image_quota", "Image quota reached. Remove an image or try again later.");
  }
  let info: ImageInfoResponse;
  try {
    info = await input.images.info(stream(input.bytes));
  } catch {
    throw new ImageUploadError("invalid_image", "The selected file is not a valid image.");
  }
  if (!("width" in info) || !["image/jpeg", "image/png", "image/webp"].includes(info.format) || info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new ImageUploadError("invalid_image", "Images must be JPEG, PNG, or WebP and no larger than 16 megapixels.");
  }
  const recovered = await input.images.hosted.list({ creator: input.logId, limit: 1, filter: { metadata: { uploadKey: input.uploadKey } } });
  let metadata = recovered.images[0];
  let normalizedSize = input.bytes.byteLength;
  if (!metadata) {
    try {
      const transformed = await input.images.input(stream(input.bytes))
        .transform({ width: 1600, height: 1600, fit: "scale-down" })
        .output({ format: "image/webp", quality: 82, anim: false });
      const normalized = await transformed.response().arrayBuffer();
      normalizedSize = normalized.byteLength;
      metadata = await input.images.hosted.upload(normalized, {
        filename: "fastidious.webp",
        requireSignedURLs: true,
        creator: input.logId,
        metadata: { logId: input.logId, uploadKey: input.uploadKey },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLocaleLowerCase() : "";
      if (message.includes("quota") || message.includes("limit")) throw new ImageUploadError("image_quota", "Cloudflare Images quota reached. Existing records remain usable.");
      throw new RepositoryError("transient_database_failure", "Image upload is temporarily unavailable.");
    }
  }
  return repository.create({ id: metadata.id as ImageAssetId, logId: input.logId, uploadKey: input.uploadKey, width: info.width, height: info.height, byteSize: normalizedSize, now: input.now });
}

export async function cleanupPendingImages(db: D1Database, images: ImagesBinding, now = Date.now(), limit = 25): Promise<number> {
  const repository = new ImageAssetRepository(db);
  const pending = await repository.listPendingDeletion(now, limit);
  let deleted = 0;
  for (const asset of pending) {
    await images.hosted.image(asset.id).delete();
    await repository.removeDeleted(asset.id);
    deleted += 1;
  }
  return deleted;
}

function stream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream();
}
