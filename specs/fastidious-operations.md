# Fastidious operations

Fastidious uses only Cloudflare Workers, D1, Worker logs/metrics, and D1 Time Travel. It has no external monitoring, analytics, error tracker, or backup service.

## Retention and cleanup

A successful authenticated application access or sync extends the log expiration by 12 calendar months. Touches are coalesced to at most one D1 update per hour. Push delivery does not count as access.

The notification Worker has two triggers:

- every minute: send a bounded batch of up to 25 reminder jobs;
- daily at `03:00 UTC`: expire up to 25 logs and purge up to 25 old markers.

Expiration inserts a one-way secret digest marker and deletes the log in one D1 batch. Foreign-key cascades remove fasts, weights, push subscriptions, notification jobs, mutation receipts, and changes. The delete checks expiration again so a concurrent authenticated touch wins. Repeated cleanup is a no-op. Markers contain no domain data, cannot recover a secret, and are removed after 60 days. Bounded work left over is picked up by the next daily run.

## Request hardening and abuse limits

Cloudflare terminates public HTTPS. The Worker rejects non-HTTPS requests if they reach the application; plain HTTP is accepted only on `localhost`/`127.0.0.1` for development. Authenticated mutation routes accept JSON only, reject compressed request bodies, and reject a mismatched `Origin` or cross-site Fetch Metadata request. API responses use `no-store`; application and API responses include CSP, frame, MIME, referrer, and permissions headers. CORS is not enabled.

Limits are intentionally simple and best effort. Frequency counters are per Worker isolate, not a global anti-abuse system:

| Operation | Limit |
|---|---|
| Create log | 10 requests/IP/minute; 1 KiB JSON |
| Sync and replacement import | 120 requests/IP/minute; 256 KB JSON; 50 mutations |
| Rotate link | 5 requests/IP/hour; 1 KiB JSON |
| Register/remove push | 30 requests/IP/hour; 8 KiB registration JSON |
| Local import | 5 MiB JSON; 10,000 fasts and 10,000 weights; 100-year record span |
| Scheduled work | 25 notification jobs or expiration rows per invocation |

UUIDs, bearer secrets, push endpoints/keys, domain records, and imported preferences are validated before writes. Unsupported content encodings are rejected, so the app does not decompress uploaded data. If abuse becomes material, add Cloudflare dashboard rate-limiting rules for `/api/logs`, `/api/sync`, `/api/secret/rotate`, and `/api/push/subscriptions`; do not replace these readable application bounds with a custom platform.

## Observability and privacy

Cloudflare's Workers and D1 dashboards provide invocation status, exception, latency, and D1 usage/failure views. The scheduled Worker emits one structured aggregate event per run for notification outcomes or expiration cleanup, including the Cloudflare Worker version ID. The logging helper accepts only named aggregate fields. It must never receive or serialize request/error objects, authorization, endpoint URLs, record IDs, fasting times, weights, or payloads.

Useful checks after deployment:

1. Confirm both cron triggers in **Workers & Pages → fastidious-notifications → Triggers**.
2. Confirm scheduled aggregate events have `success: true` and a `version`.
3. Review Workers status/exception counts and D1 rows-read/rows-written in the Cloudflare dashboard.
4. If D1 errors rise, inspect aggregate platform metrics first; do not add payload logging.

Launch sizing uses the Workers/D1 Free limits documented by Cloudflare at implementation time: Workers Free allows 100,000 requests/day; D1 Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage; D1 Time Travel retains seven days on Free. Cloudflare can change limits, so verify the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before release. The bounded queries and two cron schedules are designed to fail gracefully within those budgets rather than promise arbitrary scale.

## D1 Time Travel restore

D1 Time Travel is the only backup/restore mechanism. Do not add R2 exports containing health data.

Use the current Wrangler CLI with an authenticated production account:

```bash
# Inspect retention and the current restore bookmark.
npx wrangler d1 time-travel info fastidious --remote

# Resolve a desired UTC restore time to an exact bookmark.
npx wrangler d1 time-travel info fastidious --timestamp="2026-01-01T12:00:00Z" --remote

# Restore in place using the bookmark printed by the previous command.
npx wrangler d1 time-travel restore fastidious --bookmark="<bookmark>" --remote
```

Before restore, stop or disable both Workers so writes do not race the operation. Record the deployed versions and restore bookmark, restore D1, then deploy/enable compatible Worker versions and verify log open, sync, and scheduled jobs. Consult Cloudflare's current [`d1 time-travel`](https://developers.cloudflare.com/d1/reference/time-travel/) documentation before executing production recovery because CLI flags can change.

A restore rewinds the whole database. It can resurrect fasting data, weights, subscriptions, revoked links, or logs that users deleted after the selected point. Treat that as a privacy incident risk: restore only for genuine disaster recovery, minimize the rewind, document the decision, and let normal expiration cleanup run afterward.
