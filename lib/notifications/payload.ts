import type { ClaimedNotificationJob } from "../server/repositories/push.server";

export interface NotificationPayload {
  version: 1;
  kind: "advance" | "goal";
  title: "Fastidious";
  body: string;
  tag: string;
  openUrl: "/";
}

export function notificationPayload(job: Pick<ClaimedNotificationJob, "fastId" | "kind" | "advanceMinutes" | "goalHours">): NotificationPayload {
  const hours = formatHours(job.goalHours);
  return {
    version: 1,
    kind: job.kind,
    title: "Fastidious",
    body: job.kind === "advance"
      ? `${job.advanceMinutes} minutes until your ${goalLabel(job.goalHours)} goal.`
      : `Your ${hours}-hour fast is complete.`,
    tag: `fastidious-${job.fastId}-${job.kind}`,
    openUrl: "/",
  };
}

function goalLabel(hours: number): string {
  return hours < 24 ? `${formatHours(hours)}:${formatHours(24 - hours)}` : `${formatHours(hours)}-hour`;
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours).replace(/\.0$/, "");
}
