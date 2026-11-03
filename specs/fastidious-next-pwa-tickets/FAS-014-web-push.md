# FAS-014 — Web Push and scheduled Cloudflare Worker

**Status:** Closed

## Objective

Deliver reliable server-scheduled reminders 30 minutes before a fasting goal and at goal completion to every opted-in device.

## Dependencies

FAS-004, FAS-006, FAS-007, FAS-012, and the service-worker integration seam from FAS-013.

## Architecture

- The Vinext app Worker registers subscriptions and creates/cancels notification jobs as fast mutations commit.
- A separate Cloudflare scheduled Worker runs once per minute and sends due Web Push messages.
- Both Workers share the production D1 binding.
- VAPID keys are Worker secrets; only the public application server key reaches clients.
- The phone's service worker displays pushes. It does not schedule reliable closed-app alarms locally.

## Client permission flow

After the first fast starts:

1. Show an in-app explanation, not the browser prompt.
2. On **Remind me**, verify support and installation requirements.
3. On iOS non-standalone, direct the user to Add to Home Screen rather than requesting permission.
4. Request `Notification` permission from the user gesture.
5. Register service worker if needed.
6. Create `PushManager` subscription with the VAPID public key.
7. Send subscription with stable device ID and preferences.

Denial does not block fasting. Do not repeatedly nag after denial/dismissal.

## Per-device preferences

- enabled/disabled
- advance reminder enabled, default 30 minutes
- allowed choices 15, 30, 60
- goal reminder enabled by default

Preferences belong to a push subscription/device, not globally to the log. Every enabled device receives reminders.

## Registration API

`POST /api/push/subscriptions`:

- authenticate log;
- validate endpoint protocol/length and Web Push keys;
- upsert by `(log_id, device_id)`;
- never log endpoint/key material;
- mark `no-store`.

`DELETE /api/push/subscriptions/:deviceId`:

- authenticate;
- delete only the matching log/device subscription.

Handle endpoint rotation by replacing stale subscription data.

## Notification job lifecycle

When an active fast is created or its start/goal changes:

- calculate goal `startAt + goalHours`;
- upsert `advance` due at goal minus selected interval conceptually per subscription;
- upsert `goal` due at goal;
- cancel jobs already irrelevant or in the past according to clear rules;
- allow a newly synced offline start to send only still-useful reminders; do not send a burst of stale notifications.

Because advance intervals are per device, choose one simple schema strategy:

1. create one job per subscription/kind, or
2. claim one log-level due event and filter/send subscriptions whose interval matches.

Prefer explicit per-subscription jobs if it keeps claiming and deduplication easier within free-tier scale. Update the FAS-004 schema migration if required.

Ending/deleting/clearing/replacing a fast cancels pending jobs. Goal edits recalculate jobs transactionally with the fast mutation where possible.

## Scheduled Worker

Every minute:

1. query a bounded indexed batch of `pending` jobs with `due_at <= now`;
2. claim jobs idempotently using status/claim token;
3. load matching subscription and minimal fast goal metadata;
4. send Web Push;
5. mark sent on success;
6. delete/disable subscription on permanent 404/410;
7. retry transient failures with capped attempts/backoff;
8. release/repair stale processing claims.

Loop only within a strict invocation work limit. Remaining jobs wait for the next minute.

Do not guarantee second-level delivery. Product copy may say reminders arrive around the selected time.

## Payload and service-worker handling

Payload contains only:

- version
- kind
- title/body
- stable notification tag
- relative open URL `/`

Approved copy:

- `30 minutes until your 16:8 goal.`
- `Your 16-hour fast is complete.`

Do not include secret, weight, full history, start timestamp, or internal log ID.

Service worker:

- displays notification with app icon/badge where supported;
- uses a stable tag to prevent duplicates;
- on click, closes notification and focuses an existing Fastidious client or opens `/`;
- does not offer End Fast action buttons in v1.

## Offline limitation

If the start has not synchronized before a reminder is due, no push is guaranteed. On later sync, create only future/useful jobs. Reflect this in Help copy.

## Tests

Minimal tests:

1. First successful start exposes the contextual permission CTA.
2. Goal change recalculates pending job times.
3. Ending cancels jobs.
4. Scheduled claim is idempotent and sends one notification after retry.
5. Permanent push failure removes/disables subscription.
6. Notification click focuses or opens `/`.

Mock the external Web Push send boundary; test D1 job transitions with local D1.

## Manual checks

- Real Android installed push with app closed.
- Real iOS 16.4+ Home Screen push with app closed.
- Two subscribed devices both receive one reminder.
- Denied permission leaves app fully usable.
- Edited goal prevents the old-time reminder.

## Acceptance criteria

- Contextual permission flow follows platform requirements.
- Advance and goal reminders reach all opted-in devices after sync.
- Duplicate scheduled invocations do not duplicate user-visible pushes.
- Secrets and health history never enter payload/logs.
- Queue work stays bounded and free-tier-conscious.

## Out of scope

Quiet hours, start-fast schedules, offline local alarms, notification action buttons, and inactivity-expiration warnings.

## Completion note

Implemented contextual post-start permission guidance, iOS installation gating, per-device preferences and authenticated subscription APIs; transactional per-subscription reminder jobs; a bounded, idempotent scheduled Worker with retry/permanent-failure handling; encrypted VAPID Web Push delivery; and service-worker display/click behavior. Added D1 migration `0003_web_push.sql` and separate `fastidious-notifications` deployment configuration sharing D1.

Validation performed on 2026-10-30: `npm test` (25 files, 108 tests), `npm run typecheck`, `npm run build`, `npm run deploy:notifications -- --dry-run`, and `git diff --check -- .` passed. Focused tests cover the contextual CTA, goal-time recalculation, ending cancellation, transient retry/idempotent claim, permanent subscription disablement, and notification click focus/open behavior. Browser tooling was not connected, so visual comparison of the light/dark contextual CTA and reminder settings at mobile/440px widths is deferred to the browser-enabled FAS-016 pass. Real Android closed-app push, iOS 16.4+ Home Screen push, and two-device delivery remain production-device checks for FAS-016; they were not fabricated here.