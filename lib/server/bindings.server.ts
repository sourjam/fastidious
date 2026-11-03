export interface WorkerBindings {
  DB: D1Database;
  IMAGES: ImagesBinding;
  SECRET_DIGEST_PEPPER?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
}
