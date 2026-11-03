import { notificationPayload } from "./payload";
import { PushRepository, type ClaimedNotificationJob } from "../server/repositories/push.server";

export interface PushSendResult {
  status: number;
}

export type PushSender = (job: ClaimedNotificationJob, payload: ReturnType<typeof notificationPayload>) => Promise<PushSendResult>;

export async function sendDueNotifications(
  db: D1Database,
  sender: PushSender,
  now = Date.now(),
  limit = 25,
): Promise<{ claimed: number; sent: number; permanentFailures: number; transientFailures: number }> {
  const repository = new PushRepository(db);
  const jobs = await repository.claimDueJobs(now, crypto.randomUUID(), limit);
  let sent = 0;
  let permanentFailures = 0;
  let transientFailures = 0;

  for (const job of jobs) {
    try {
      const response = await sender(job, notificationPayload(job));
      if (response.status >= 200 && response.status < 300) {
        if (await repository.markSent(job, now)) sent += 1;
      } else if (response.status === 404 || response.status === 410) {
        await repository.removePermanentFailure(job, now);
        permanentFailures += 1;
      } else {
        await repository.markTransientFailure(job, now);
        transientFailures += 1;
      }
    } catch {
      await repository.markTransientFailure(job, now);
      transientFailures += 1;
    }
  }

  return { claimed: jobs.length, sent, permanentFailures, transientFailures };
}
