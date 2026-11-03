# FAS-015 — Expiration, security, privacy, and operations

**Status:** Closed

## Objective

Implement 12-month inactivity expiration, harden the public Worker/API, add privacy/help pages, and provide Cloudflare-only operational visibility suitable for a free-tier toy app.

## Dependencies

FAS-004, FAS-006, and FAS-014.

## Inactivity expiration

### Semantics

- Expire 12 calendar months after the last meaningful successful authenticated access/sync.
- Coalesce touch writes so frequent timer use does not update D1 on every request.
- Push delivery alone does not reset inactivity.
- No pre-expiration warning.

### Daily cleanup

Add a daily trigger to the scheduled Worker:

1. query a bounded batch of logs where `expires_at <= now`;
2. claim each log for expiration idempotently;
3. delete fasts, weights, push subscriptions, notification jobs, receipts, changes, and settings/log row;
4. write a non-reversible bounded expired-link marker;
5. continue within invocation limits or pick up next day/run.

Keep expired markers for a documented short period, such as 30–90 days, then purge them. They contain no domain data and must not permit token recovery.

Opening a retained expired link returns a stable expired result. Client erases stale local data and offers Create new log. After the marker is purged, the link may appear invalid rather than expired; it must never silently recreate under the same token.

## HTTP/API hardening

- HTTPS-only assumptions documented; redirect/reject insecure origin if reachable.
- `Cache-Control: no-store` on identity, sync, import, and push APIs.
- strict JSON content type and bounded body sizes.
- prepared D1 statements only.
- shared runtime validation.
- request IDs that contain no user secret/data.
- generic production errors.
- CSP appropriate to self-hosted fonts/assets and Web Push/service worker.
- `frame-ancestors 'none'` or equivalent.
- `Referrer-Policy: no-referrer` to reduce URL leakage.
- `X-Content-Type-Options: nosniff`.
- restrictive permissions policy where compatible.
- CORS disabled for arbitrary origins; accept same-origin application requests.

Fragments do not reach the server, but Authorization does. Never log it.

## Abuse controls

Within Cloudflare free-tier capabilities:

- cap new-log creation per IP/time window best effort;
- cap sync/import sizes and mutation counts;
- cap rotation and push registration frequency;
- validate UUID/token formats before database work;
- cap date ranges and record counts in import;
- reject decompression bombs/unsupported file formats;
- bound scheduled-worker batches and retries.

Do not build an elaborate custom anti-abuse platform. Document where Cloudflare dashboard rate limiting could be added later.

## Privacy and help pages

### Privacy

Explain plainly:

- D1 stores server-readable fasting and weight data;
- secret link grants full access;
- no conventional account/recovery;
- data expires after 12 months of inactivity;
- operational logs exclude health values and secrets;
- no advertising/product analytics/external error tracker;
- export and clear controls.

### Help/About

Explain:

- installation;
- iOS push requirement;
- offline sync and its reminder limitation;
- link rotation/removal;
- general informational/health disclaimer;
- fasting stages are approximate and vary by person.

Keep copy concise and non-legalistic while accurate.

## Observability

Use Cloudflare-only logs/metrics for:

- Worker exceptions/status counts;
- D1 failure count/latency;
- sync batch/change counts without IDs/payloads;
- scheduled invocation success/failure;
- push success/permanent failure aggregates;
- expiration cleanup counts;
- deployed app version.

Create a redaction helper and use structured allowlisted fields. Never serialize arbitrary error/request objects in production because they may contain headers or payloads.

No Sentry, session replay, or behavioral analytics.

## Backup/restore

- Rely on D1 Time Travel only.
- Document how to inspect available restore points and perform a restore using current Cloudflare tooling.
- Do not add R2 backups.
- A database restore may resurrect data deleted after the restore point; document this operational/privacy limitation.

## Tests

Minimum tests:

1. Successful authenticated access extends expiration under coalescing rules.
2. Push send alone does not extend expiration.
3. Cleanup removes all related rows and leaves only the bounded marker.
4. Expired secret cannot authenticate or recreate the old log.
5. Logging helper drops non-allowlisted sensitive fields.
6. Oversized sync/import request is rejected before persistence.

## Acceptance criteria

- Expiration is idempotent, bounded, and complete.
- Security headers apply to application/API responses as appropriate.
- Sensitive data is absent from intentional operational logs.
- Privacy/Help copy matches actual behavior.
- Free-tier abuse limits are practical and readable.
- Time Travel recovery steps are documented.

## Out of scope

Formal compliance certification, external monitoring, paid WAF rules, R2 backup, and legal review.

## Completion note

Implemented coalesced 12-calendar-month access expiration, bounded daily cascading cleanup with 60-day digest markers, stable expired-link handling and local erasure, strict bounded same-origin JSON APIs, security headers, practical per-isolate abuse limits, allowlisted aggregate logs with Worker version metadata, concise Privacy and Help pages, and a Cloudflare/D1 operations and Time Travel recovery guide.

Validation performed on 2026-10-30: focused expiration/security/identity/import tests, the full `npm test` suite (26 files, 116 tests), `npm run typecheck`, `npm run build`, app and notification Worker deployment dry runs, and `git diff --check -- .` passed. Local production-preview checks confirmed `/help` and `/privacy` content, CSP/referrer/MIME/frame/permissions response headers, and API rejection of unsupported media types (415) and cross-origin mutations (403). Browser tooling was not connected, so screenshot comparison of the new information pages and settings links is deferred to the browser-enabled FAS-016 pass; no browser or production deployment result is claimed here.