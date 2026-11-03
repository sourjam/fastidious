import { expireInactiveLogs } from "../lib/expiration/cleanup.server";
import { sendDueNotifications } from "../lib/notifications/scheduled.server";
import { cleanupPendingImages } from "../lib/server/images.server";
import type { WorkerBindings } from "../lib/server/bindings.server";
import { logOperationalEvent } from "../lib/server/observability.server";
import { sendWebPush } from "./web-push";

interface NotificationWorkerBindings extends WorkerBindings {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

const EXPIRATION_CRON = "0 3 * * *";

export default {
  fetch(): Response {
    return new Response("Not found.", {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },

  async scheduled(controller: ScheduledController, env: NotificationWorkerBindings): Promise<void> {
    const version = env.VERSION_METADATA?.id ?? "local";
    if (controller.cron === EXPIRATION_CRON) {
      try {
        const result = await expireInactiveLogs(env.DB, controller.scheduledTime);
        const imagesDeleted = await cleanupPendingImages(env.DB, env.IMAGES, controller.scheduledTime);
        logOperationalEvent("expiration_cleanup", { ...result, imagesDeleted, success: true, version });
      } catch {
        logOperationalEvent("expiration_cleanup", { success: false, version });
        throw new Error("Expiration cleanup failed.");
      }
      return;
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      logOperationalEvent("notification_schedule", { success: false, version });
      throw new Error("Web Push VAPID secrets are not configured.");
    }
    try {
      const result = await sendDueNotifications(env.DB, async (job, payload) => {
        const response = await sendWebPush(
          { endpoint: job.endpoint, p256dh: job.p256dh, auth: job.auth },
          payload,
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT,
          },
        );
        return { status: response.status };
      }, controller.scheduledTime);
      logOperationalEvent("notification_schedule", { ...result, success: true, version });
    } catch {
      logOperationalEvent("notification_schedule", { success: false, version });
      throw new Error("Notification schedule failed.");
    }
  },
};
