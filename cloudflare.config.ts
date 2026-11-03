import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

const database = () => bindings.d1({
  id: process.env.D1_DATABASE_ID ?? "00000000-0000-0000-0000-000000000000",
  name: "fastidious",
});

const appWorker = defineWorker({
  name: "fastidious",
  entrypoint: "vinext/server/fetch-handler",
  compatibilityDate: "2026-10-30",
  compatibilityFlags: ["nodejs_compat"],
  assets: {
    htmlHandling: "none",
    notFoundHandling: "none",
    runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
  },
  env: {
    ASSETS: bindings.assets(),
    DB: database(),
    SECRET_DIGEST_PEPPER: bindings.secret(),
    VAPID_PUBLIC_KEY: bindings.secret(),
    VERSION_METADATA: bindings.versionMetadata(),
    IMAGES: bindings.images(),
  },
});

const notificationWorker = defineWorker({
  name: "fastidious-notifications",
  entrypoint: "workers/notifications.ts",
  compatibilityDate: "2026-10-30",
  compatibilityFlags: ["nodejs_compat"],
  triggers: [
    triggers.scheduled({ schedule: "* * * * *" }),
    triggers.scheduled({ schedule: "0 3 * * *" }),
  ],
  env: {
    DB: database(),
    VAPID_PUBLIC_KEY: bindings.secret(),
    VAPID_PRIVATE_KEY: bindings.secret(),
    VAPID_SUBJECT: bindings.secret(),
    VERSION_METADATA: bindings.versionMetadata(),
    IMAGES: bindings.images(),
  },
});

export default defineConfig({
  worker: process.env.FASTIDIOUS_WORKER === "notifications" ? notificationWorker : appWorker,
});
