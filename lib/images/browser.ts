import type { EpochMs } from "../domain/types";
import { attachUploadedImage } from "../local-db/operations";
import { openLocalDatabase, type FastidiousDatabase } from "../local-db/database";
import type { PendingImage } from "../local-db/schema";

export type PreparedImage = Pick<PendingImage, "blob" | "mimeType" | "width" | "height">;

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size <= 0 || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image no larger than 5 MB.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > 16_000_000) throw new Error("Images may contain at most 16 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image could not be prepared.")), "image/webp", 0.82));
    return { blob, mimeType: "image/webp", width, height };
  } finally {
    bitmap.close();
  }
}

export class PendingImageCoordinator {
  private db: FastidiousDatabase | null = null;
  private stopped = false;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly online = () => this.request();

  constructor(private readonly readSecret: () => string | null, private readonly onAttached: () => void) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.db = await openLocalDatabase();
    window.addEventListener("online", this.online);
    this.request();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("online", this.online);
    if (this.timer) clearTimeout(this.timer);
    this.db?.close();
    this.db = null;
  }

  request(): void { void this.run(); }

  private async run(): Promise<void> {
    if (!this.db || this.running || this.stopped || !navigator.onLine) return;
    const secret = this.readSecret();
    if (!secret) return;
    this.running = true;
    const pending = await this.db.pendingImages.where("status").anyOf("pending", "failed").sortBy("createdAt");
    for (const item of pending) {
      try {
        await this.db.pendingImages.update(item.id, { status: "uploading", attempts: item.attempts + 1, error: null, updatedAt: Date.now() });
        const response = await fetch("/api/images", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": item.mimeType, "x-fastidious-upload-key": item.id }, body: item.blob, cache: "no-store" });
        const body = await response.json() as { assetId?: string; error?: { message?: string } };
        if (!response.ok || !body.assetId) throw new Error(body.error?.message ?? "Image upload failed.");
        const attached = await attachUploadedImage(this.db, item.id, body.assetId, Date.now() as EpochMs);
        if (!attached.ok) throw new Error(attached.message);
        this.onAttached();
      } catch (cause) {
        await this.db.pendingImages.update(item.id, { status: "failed", error: cause instanceof Error ? cause.message : "Image upload failed.", updatedAt: Date.now() });
      }
    }
    this.running = false;
    if (!this.stopped) this.timer = setTimeout(() => this.request(), 60_000);
  }
}
