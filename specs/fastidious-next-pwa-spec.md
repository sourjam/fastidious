# Fastidious Vinext PWA — Implementation Specification

**Status:** Approved product and architecture decisions
**Target:** Cloudflare Workers free tier
**Application framework:** Vinext (Next.js-compatible App Router on Vite)
**Design references:** `specs/design_handoff_fastidious/Fastidious.dc.html` for the completed v1 foundation and `specs/design_handoff_fastidious/Fastidious-v2.html` for FAS-017 through FAS-024. The v2 handoff wins where the two differ.

## 1. Product summary

Fastidious is an offline-first fasting and daily-health tracker delivered as an installable mobile PWA. It supports intermittent and extended fasts, meals and nutrition, exercise, recurring checklists, groceries, calendar history, statistics, weight tracking, push reminders, data import/export, and cross-device synchronization without conventional user accounts.

A high-entropy secret URL is the sole credential for a log. Anyone with the URL has full read/write access. There is no email recovery and no administrator recovery path.

The complete design handoff is in scope for v1. The production implementation should preserve its visual hierarchy, spacing, typography, colors, blueprint registration marks, and interactions unless this specification explicitly changes behavior.

## 2. Confirmed product decisions

- Secret-link identity; no account or login.
- A lost secret is not recoverable.
- An authenticated user can rotate the secret; the old secret is invalid immediately.
- The secret remains visible in the URL fragment so browser-synced bookmarks can transfer access.
- One active log is stored per browser/PWA installation.
- One active fast exists per log across all devices.
- Full offline editing with queued synchronization.
- Automatic last-arriving-write-wins conflict resolution per record.
- Cloudflare D1 is the authoritative store.
- IndexedDB is the complete local working store.
- Standard server-readable D1 data; no end-to-end encryption.
- Push reminders fire 30 minutes before the goal and when the goal is reached by default.
- All subscribed devices receive reminders, with per-device opt-out.
- Notification permission is requested contextually after the first fast starts.
- No in-app quiet hours.
- Detailed notification text is allowed on the lock screen.
- The complete original mockup feature set is included in v1.
- The v2 handoff adds the Today log, foods/meals, activities/exercise, recurring checklists, groceries, nutrition targets, and calendar layers.
- User-provided v2 images are part of the release and use Cloudflare Images; image implementation is intentionally the final v2 slice.
- The app opens directly; there is no marketing landing page.
- Production uses a Cloudflare-provided `*.workers.dev` origin initially.
- Production-only Cloudflare environment; local development is separate.
- The architecture must operate within Cloudflare's free tier initially.
- D1 is placed in North America.
- D1 Time Travel is the only server backup mechanism.
- Logs expire after 12 months without a successful access or sync.
- Expired links show an explicit expiration screen and offer a new log.
- No pre-expiration push warning.
- No external telemetry or error-monitoring service.
- Minimal happy-path unit/integration tests; no initial Playwright suite.

## 3. Functional scope

### 3.1 Fast tracking

- Start a fast from a preset or custom goal.
- Presets: 13h, 16:8, 18:6, 20:4, OMAD 23:1, 36h, 48h, and 72h.
- Custom goals: 1–168 hours in 0.5-hour increments.
- Display elapsed time to the second while the app is visible.
- Derive elapsed time from timestamps; do not persist a ticking counter.
- Display progress, goal, projected end, fasting stage, and stage descriptions.
- Edit an active fast's start time and goal.
- End an active fast immediately and show the completion sheet.
- The completion sheet provides **Undo / Resume fast** for accidental completion.
- Log, edit, and delete past fasts.
- Prevent future starts/ends, non-positive durations, and overlapping completed or active fasts.
- Use only the general fasting disclaimer in Help/About; do not add a special extended-fast interstitial.

### 3.2 Calendar

- Day, month, and year modes from the handoff.
- Day view includes completed and active fasting overlap for that day.
- Month/year shading uses hours overlapping each calendar day.
- First weekday is locale-derived.
- Calendar boundaries use the log's configured timezone, not the current device timezone.
- The timezone is detected at log creation and editable in Settings.

### 3.3 Statistics

- Current streak, longest streak, number of fasts, average duration, longest fast, and total hours.
- Streak definition: consecutive calendar days in the configured log timezone on which a fast ended and met its goal. Count backward from today, or from yesterday if today has no qualifying completed fast.
- Active fasts do not count as completed statistics until ended.
- Last-14-fasts chart and goal-hit summary.

### 3.4 Weight tracking

- Add and delete weight entries.
- Store canonical values in kilograms.
- Display kg or lb based on the synced log preference.
- Initial unit is locale-derived: lb for US locales and kg elsewhere.
- Display latest value, 30-day change, sparkline, and recent entries.
- Individual deletion offers a brief Undo toast.

### 3.5 Settings and data controls

- Theme options: System, Light, and Dark; default System.
- Editable timezone.
- Editable weight unit.
- Full secret access link remains visibly displayed.
- Copy access link action only; no QR code or native Share action in v1.
- Rotate access link with a clear warning that every old device will be revoked.
- Remove this log from this device.
- Export JSON without the access secret.
- Import JSON by replacing current data after a summary and confirmation.
- Import preserves the current secret.
- Create a local automatic pre-import backup for an undo/recovery path.
- Clear all data while preserving the current log identity and secret.
- Clear-all requires explicit confirmation and has no brief toast-based undo.

### 3.6 Today log and recurring checklists

- Add a Today destination with Log, Foods, and Activities sub-tabs.
- Navigate daily records by civil day in the configured log timezone.
- Show daily calorie, protein, and fiber totals with optional targets.
- Support reusable checklist items with daily, weekly, or monthly cadence.
- Checklist, meal, exercise, and grocery writes remain available offline and synchronize later.

### 3.7 Foods, meals, and groceries

- Maintain categorized reusable foods with serving, nutrition, optional price, link, and image.
- Log timestamped meals from reusable foods or one-off items using quantity snapshots.
- Food edits never rewrite historical meal nutrition.
- Logging a meal during an active fast may offer to end the fast at the meal time but never does so automatically.
- Maintain a shared grocery list with cart state and optional links to reusable foods.

### 3.8 Activities and exercise

- Maintain categorized reusable activities with optional detail, link, and image.
- Log exercise from quick actions, reusable activities, or free text.
- Activity edits/deletes never remove historical exercise text.

### 3.9 Calendar layers

- Extend Month and Year with Fasting, Food, Activity, and Checklist layers.
- Add meal markers and an Open Day Log action to Day view.
- Calendar selection can open a combined day detail or the matching Today log.
- Derived heat values are calculated locally and are not persisted aggregates.

### 3.10 Images

- Foods, whole meals, activities, checklist items, and grocery overrides may have images. A meal has at most one image; meal items do not have individual images.
- Binary assets use Cloudflare Images; D1 and ordinary sync payloads contain opaque references only.
- Offline image selection is staged locally and uploads after reconnection.
- Upload, delivery, ownership, quotas, replacement, deletion, and import/export behavior are completed in FAS-024.
- Ordinary JSON exports contain opaque image asset IDs only. They never embed image bytes, signed delivery URLs, pending local blobs, or credentials.
- Image binaries remain deployment-managed and are not a portable backup. Import preview counts image references that will be dropped; import clears every image asset ID because ownership cannot be transferred through JSON.
- Pending local image blobs are device-only and are excluded from export with explicit copy in the data screen. A separate bounded archive format would be required for portable binaries and is out of scope.

## 4. Identity and access

### 4.1 Secret format

- Generate 256 random bits with a cryptographically secure generator.
- Encode as unpadded base64url.
- Canonical URL shape:

```text
https://<deployment>.workers.dev/#/log/<secret>
```

The fragment is not included in HTTP requests or ordinary Cloudflare request logs. Client code reads it and sends the secret only in authenticated API requests over HTTPS.

### 4.2 Local credential behavior

- Persist the active secret locally so the installed PWA can launch from the manifest's fixed `/` start URL.
- Keep the secret fragment in the visible address bar when a log is active.
- A synced browser bookmark containing the fragment grants access on another device.
- When `/` opens without a fragment:
  - restore the locally remembered active log when present;
  - otherwise create a new log and replace the URL with its secret fragment.
- Opening a different valid secret link switches the single active local log.

### 4.3 Server authentication

- Send the secret as an `Authorization: Bearer <secret>` credential.
- Store only a one-way token digest in D1; never store the plaintext secret.
- Use constant-time digest comparison where applicable.
- Never log authorization headers, secret fragments, request bodies containing imported data, weights, or fasting records.
- Use generic unauthorized responses that do not reveal whether a candidate log exists, except for a separately encoded expired-link result where the server has retained an expiration marker.

### 4.4 Rotation

1. An authenticated device requests rotation.
2. A new 256-bit secret is generated and returned once.
3. D1 atomically replaces the stored digest and increments the credential generation.
4. The client updates its local credential and URL fragment.
5. Old devices receive a revoked response at their next network attempt.
6. Revoked devices erase the local Fastidious IndexedDB data and credential, then show a revoked-access screen.

An offline revoked device cannot be erased remotely until it reconnects.

### 4.5 Remove from device

- Best-effort unregister the current push subscription.
- Unsubscribe locally through `PushManager` even when the API is unavailable.
- Erase local IndexedDB data, queued mutations, and remembered secret.
- Remove the fragment and navigate to `/`, which creates a fresh log.
- Do not delete the original server log.

## 5. Data architecture

### 5.1 Authoritative and local stores

**Cloudflare D1** is authoritative after synchronization. **IndexedDB** is the app's immediate working database and contains:

- a local copy of the current log's fasts, weights, settings, foods, meals, activities, exercise, checklists, groceries, and nutrition targets;
- the active fast;
- device-local pending image blobs and upload state until Cloudflare Images attachment succeeds;
- sync cursor and server generation;
- pending idempotent mutations;
- local device metadata;
- local pre-import backup;
- install-prompt dismissal state and other device-only preferences.

Use Dexie for IndexedDB transactions, reactive reads, and schema migrations.

### 5.2 D1 access

Use raw D1 prepared statements and checked-in, sequential SQL migrations. Do not introduce an ORM.

All multi-record state transitions—sync batches, secret rotation, clear/replace, and active-fast conflict resolution—must run in D1 transactions where supported by the chosen D1 API pattern.

### 5.3 Proposed D1 tables

Exact SQL types and indexes belong in the migration, but the logical schema is:

#### `logs`

- `id` — internal random identifier, primary key
- `secret_digest` — unique credential digest
- `credential_generation`
- `data_generation` — increments after clear or replacement import
- `revision` — monotonically increasing per-log sync revision
- `timezone`
- `theme` — `system | light | dark`
- `weight_unit` — `kg | lb`
- `default_goal_hours`
- `created_at`
- `updated_at`
- `last_access_at`
- `expires_at`

#### `fasts`

- `id` — client-generated UUID
- `log_id`
- `start_at` — UTC epoch milliseconds
- `end_at` — nullable UTC epoch milliseconds; null means active
- `goal_hours`
- `revision`
- `updated_at`
- `deleted_at` — tombstone when non-null

Enforce at most one non-deleted row with `end_at IS NULL` per log using a supported unique/partial-index strategy or transactional application invariant.

#### `weights`

- `id` — client-generated UUID
- `log_id`
- `measured_at` — UTC epoch milliseconds
- `kilograms`
- `revision`
- `updated_at`
- `deleted_at`

#### `push_subscriptions`

- `id`
- `log_id`
- `device_id`
- Web Push endpoint and encrypted key material required by the Web Push protocol
- `enabled`
- `advance_minutes` — default 30
- `created_at`
- `last_success_at`
- `failed_at`

#### `notification_jobs`

- `id`
- `log_id`
- `fast_id`
- `kind` — `advance | goal`
- `due_at`
- `status` — `pending | processing | sent | cancelled`
- claim/attempt timestamps
- uniqueness across `fast_id + kind`

#### `mutation_receipts`

- `log_id`
- `mutation_id`
- `applied_revision`
- `created_at`

This makes retries idempotent. Receipts may be pruned after a conservative period shorter than log expiration only if retry safety remains guaranteed.

#### `changes`

- `log_id`
- `revision`
- entity type and entity ID
- operation type
- compact current payload or tombstone
- `created_at`

This supports cursor-based delta pulls. Changes and deletion tombstones must remain available long enough for a device that can be offline for most of the 12-month log lifetime. If pruning is introduced later, clients with an older cursor must receive a full snapshot.

#### V2 daily-log tables

FAS-018 adds explicit, independently mutable tables for food/activity categories, foods, meals and meal items, activities, exercise entries, checklist items/completions, grocery items, and nutrition targets. Each synchronized record uses stable client IDs, per-log revisions, and tombstones where deletion is supported. Meal and exercise rows retain historical snapshots when reusable library records change.

Cloudflare image bytes never enter these tables. Records may hold only opaque asset references after FAS-024 verifies ownership.

#### `expired_logs`

- digest or non-reversible lookup marker sufficient to distinguish a recently expired link
- `expired_at`
- purge-after timestamp

Keep this marker only for a bounded period. It contains no user health data.

### 5.4 Time and numeric representation

- Store instants as UTC epoch milliseconds.
- Interpret calendar days through the configured IANA timezone.
- Store goal hours and kilograms as validated numeric values.
- Use `Intl` for locale-aware date, time, number, and first-weekday presentation.

## 6. Offline-first synchronization

### 6.1 Client write path

1. Validate the operation locally.
2. Apply it to IndexedDB in the same transaction that appends a mutation.
3. Render immediately from IndexedDB.
4. Attempt sync when online.
5. Retry safely after startup, `online`, visibility regain, and ordinary foreground activity.
6. Use Background Sync only as an optional enhancement where supported; never depend on it, especially on iOS.

### 6.2 Mutation envelope

Each mutation includes:

- globally unique `mutationId`;
- stable local `deviceId`;
- entity type and ID;
- operation and validated payload;
- known `dataGeneration`;
- client-created timestamp for diagnostics only.

Client timestamps do not decide conflicts.

### 6.3 Sync API behavior

`POST /api/sync` accepts:

- the client's server cursor;
- data generation;
- an ordered mutation batch.

The server:

1. authenticates the secret;
2. updates `last_access_at` and expiration;
3. rejects mismatched data generations with a reset/full-snapshot instruction;
4. ignores already-receipted mutation IDs;
5. applies new mutations in arrival order;
6. increments the per-log revision for accepted changes;
7. records receipts and change rows;
8. returns accepted mutation IDs, the latest cursor, and server changes after the supplied cursor.

### 6.4 Conflict policy

- Last mutation accepted by the server wins per record.
- Do not compare device clocks.
- Never replace an entire log during ordinary sync.
- A late offline edit may overwrite an earlier server edit to the same record; unrelated records are unaffected.
- The resulting server changes flow back to every device.

### 6.5 Active-fast conflicts

There is exactly one active fast per log.

If separate offline devices create competing active fasts, the last accepted start mutation becomes active. The previous active state is superseded through the normal revision journal so the transition is diagnosable, but v1 does not present a conflict-selection UI.

Ending or editing the authoritative active fast updates every device on its next sync.

### 6.6 Clear and import replacement

Clear-all and replacement import:

- increment `data_generation` atomically;
- remove or tombstone prior fast and weight data as appropriate;
- emit a generation-reset change;
- cancel notification jobs tied to removed fasts;
- force other devices to discard stale local records and queued mutations from the old generation.

Clear-all retains log settings and identity. Import replaces fasts, weights, and imported preferences while retaining identity.

### 6.7 Sync status UI

Keep successful sync invisible. Display only:

- the mockup's **Offline** tag while offline;
- a persistent, actionable error when sync is blocked or repeatedly failing.

Do not display routine “Syncing” or “Synced” states.

## 7. API surface

Use explicit JSON API routes rather than Server Actions for synchronized state.

Proposed routes:

- `POST /api/logs` — create a log and return its secret once
- `POST /api/sync` — push mutations and pull deltas/snapshot
- `POST /api/secret/rotate` — rotate the current secret
- `POST /api/data/clear` — generation-reset clear
- `POST /api/data/replace` — validated import replacement
- `POST /api/push/subscriptions` — register/update a device subscription
- `DELETE /api/push/subscriptions/:deviceId` — unregister a device

The final implementation may consolidate clear and replace into privileged sync mutation types if atomicity and validation remain explicit.

All request and response payloads require shared runtime validation. Use a small schema-validation library or focused hand-written validators; do not trust TypeScript types at runtime.

## 8. Push notifications

### 8.1 Delivery model

Reliable closed-app reminders are server-scheduled:

1. Starting or editing a fast syncs the active record.
2. The server upserts `advance` and `goal` notification jobs.
3. A separate scheduled Cloudflare Worker runs once per minute.
4. It atomically claims due jobs and sends Web Push to every enabled subscription for the log.
5. The installed PWA's service worker displays the notification.
6. Invalid/expired subscriptions are disabled or deleted.

Ending, deleting, replacing, or changing a fast cancels or recalculates its jobs.

The visible timer itself remains client-derived and requires no server ticking process.

### 8.2 Default reminders

- Advance reminder: enabled, 30 minutes before goal.
- Goal reminder: enabled at projected goal time.
- Users can adjust advance timing to 15, 30, or 60 minutes and can disable notifications per device.
- Every opted-in device receives each reminder.
- No quiet-hours feature.

### 8.3 Permission flow

- Never prompt on initial page load.
- After the first fast starts, show an in-app explanation and “Remind me” action.
- Trigger the browser permission prompt only from that user action.
- On iOS/iPadOS, explain that Web Push requires installation to the Home Screen on 16.4+.
- Denial must not block any other app behavior.

### 8.4 Notification copy

Detailed copy is allowed:

- `30 minutes until your 16:8 goal.`
- `Your 16-hour fast is complete.`

Clicking a notification opens/focuses the Fast screen at `/`; the registered device already has the locally stored secret.

Do not include the secret, weights, or other historical data in push payloads.

### 8.5 Offline limitation

If a fast begins offline and the device does not reconnect before a due reminder, no reliable closed-app push can be delivered. The app should schedule notification jobs as soon as synchronization resumes. It must not imply that offline closed-app alarms are guaranteed.

### 8.6 Worker implementation constraints

- Use VAPID Web Push credentials stored as Cloudflare secrets.
- Keep the scheduled notification Worker separate from the Vinext fetch entrypoint while sharing D1 bindings.
- Query an indexed `due_at/status` range.
- Claim jobs idempotently to avoid duplicate sends after retries.
- Keep the once-per-minute schedule and database work within free-tier quotas.

## 9. PWA implementation

### 9.1 Supported platforms

Official baseline:

- iOS/iPadOS 16.4+ for installed Web Push;
- current Android Chrome, Edge, and Samsung Internet;
- current desktop Chrome, Edge, Firefox, and Safari.

Older iOS versions may run the app with reduced offline behavior and no Web Push guarantee.

### 9.2 Web app manifest

Configure:

- `name`: Fastidious
- `short_name`: Fastidious
- `display`: `standalone`
- `start_url`: `/`
- `scope`: `/`
- `orientation`: `portrait`
- theme/background colors matching the Industry light theme
- standard 192px and 512px icons
- maskable icon variants
- monochrome icon where supported

### 9.3 Icon direction

Create a condensed **F** monogram in the steel-blue Industry palette with blueprint registration-mark influence. Produce source artwork and exported manifest, maskable, Apple touch, favicon, and monochrome variants. Verify safe-zone behavior rather than merely padding a square icon.

### 9.4 iOS metadata

Provide:

- `apple-mobile-web-app-capable`;
- standalone status-bar styling compatible with both themes;
- Apple touch icon;
- viewport-fit cover;
- safe-area padding for the header, sheets, and tab bar.

Use the manifest's portrait orientation, acknowledging that iOS may not honor every manifest field identically to Android.

### 9.5 Service worker and caching

Because the repository uses Vinext/Vite, select PWA tooling compatible with that build pipeline rather than a Next.js-only integration. Validate plugin compatibility in a small implementation spike before committing to it. A Vite-compatible inject-manifest/workbox-style flow is preferred if it can reliably discover Vinext's hashed client assets.

Required behavior:

- Precache the minimum app shell, manifest-linked icons, and self-hosted fonts.
- Cache immutable hashed assets cache-first.
- Use network-first navigation with a cached app-shell fallback.
- Do not cache authenticated API responses as the data source; data belongs in IndexedDB.
- Do not cache secrets in arbitrary request URLs or cache keys.
- Version caches and remove obsolete caches after activation.
- Preserve offline startup after one successful online load.

### 9.6 Updates

- Install new service workers in a waiting state.
- Show an in-app “A new version is available” prompt.
- Update and reload only after user confirmation.
- Preserve IndexedDB and pending mutations across reloads.
- Force update only for documented incompatible or security-critical releases.

### 9.7 Installation guidance

- Android/Chromium: use the captured native install prompt when available.
- iOS/iPadOS: show concise **Share → Add to Home Screen** instructions.
- Hide guidance when already running standalone or after dismissal.
- Explain the installation requirement before offering iOS push permission.

### 9.8 Fonts

Self-host optimized WOFF2 subsets/weights for Barlow and Barlow Condensed. Include them in the service-worker asset strategy. Do not call Google Fonts at runtime.

## 10. UI and design implementation

### 10.1 Styling

- Use plain CSS, design tokens, and component classes.
- Do not use Tailwind for the application UI.
- Move repeated inline prototype styles into semantic classes without changing final rendering.
- Preserve the `max-width: 440px` centered shell.
- Preserve square corners and blueprint registration marks.
- Preserve the single steel-blue accent and light technical ground.
- Recreate charts and the day clock with accessible SVG/HTML rather than canvas when practical.

### 10.2 Accessibility

- Meet WCAG 2.2 AA contrast for body text and actionable controls.
- Do not communicate status only by color.
- Provide text alternatives/summaries for charts.
- Use semantic dialog behavior for sheets: focus trap, initial focus, Escape handling where available, labelled title, and focus restoration.
- Ensure 44px touch targets where the design permits.
- Support keyboard operation and visible focus styles.
- Respect `prefers-reduced-motion`.
- Keep date/time inputs at 16px or larger to prevent iOS zoom.
- Verify layout with dynamic text scaling even though the visual shell is narrow.

### 10.3 Destructive and reversible actions

- Individual fast/weight deletion: apply immediately and show a brief Undo toast.
- End fast: apply immediately and offer Undo/Resume in the completion sheet.
- Clear all data: explicit confirmation; no toast-only protection.
- Rotate secret: explicit confirmation explaining that old devices will be revoked and eventually erased.

## 11. Import and export

### 11.1 Export format

Export a versioned JSON document containing:

- app identifier and schema version;
- export timestamp;
- timezone, preferences, and nutrition targets;
- completed and active fast data;
- weight entries;
- foods/categories and meal snapshots;
- activities/categories and exercise history;
- checklist items/completions;
- grocery items;
- opaque image asset IDs for disclosure only; imported IDs are reported and dropped because image ownership cannot be transferred.

Do not include:

- the secret or secret digest;
- push subscriptions;
- device IDs;
- mutation receipts;
- notification jobs.

Export works from local IndexedDB and therefore remains available offline.

### 11.2 Import

- Parse and validate the entire file before changing data.
- Show counts, date range, timezone, and preferences in a confirmation summary.
- Reject unsupported or malformed payloads with a useful error.
- Save an automatic local pre-import backup.
- Replace the current log's data and imported preferences while preserving identity.
- Apply locally first, then queue/sync the generation-reset replacement.
- If imported offline, clearly indicate that replacement remains pending synchronization.
- Import preview reports how many image references will be dropped. Pending device-local blobs are neither exported nor replaced silently: the export UI warns that they remain only on this device, and clear/import explicitly removes them.

## 12. Expiration and deletion

### 12.1 Inactivity policy

- A log expires after 12 months without a successful authenticated access or sync.
- Any successful authenticated app access resets `last_access_at` and `expires_at`.
- Do not send warning notifications before expiration.

### 12.2 Cleanup

A daily scheduled cleanup task:

1. identifies expired logs through an indexed expiration field;
2. deletes fasts, weights, subscriptions, jobs, receipts, changes, and log settings;
3. stores only a bounded expired-link marker;
4. ensures an expired secret is not silently reused.

Opening an expired link shows an explicit expiration screen and offers to create a new log with a new secret.

## 13. Security and privacy

- Treat the URL secret as a password in UI copy and implementation.
- Enforce HTTPS; Cloudflare provides transport termination.
- Apply strict CSP, frame-ancestor restrictions, MIME protections, and conservative referrer policy.
- Do not load third-party fonts, analytics, session replay, or error tracking.
- Use Cloudflare-only operational logs and metrics.
- Redact authorization and sensitive payloads from logs.
- Validate body sizes and apply practical per-IP/per-log throttling to creation, sync, import, rotation, and push-registration endpoints.
- Validate Web Push endpoint protocols and payload sizes.
- Protect mutations against cross-origin abuse by requiring bearer authorization and validating request origin/content type where appropriate.
- Escape all imported/displayed text even though current schemas are mostly numeric.
- Provide Privacy and Help/About pages explaining server-readable storage, secret-link access, expiration, export, and the general health disclaimer.
- No advertising or behavioral analytics.

## 14. Cloudflare deployment

### 14.1 Runtime

Retain the current Vinext architecture:

- `vinext`
- Vite
- `@cloudflare/vite-plugin`
- Cloudflare Worker fetch entrypoint

Do not migrate to official Next.js/OpenNext in this release.

### 14.2 Bindings

The app Worker needs:

- D1 binding for the production database;
- static asset binding from the Vinext build;
- Cloudflare Images account/binding configuration for the v2 image slice;
- environment metadata such as app version;
- secrets required for digest hardening, signed image delivery, and image API access where used.

The scheduled Worker needs:

- the same D1 binding;
- the same Images binding so daily cleanup can remove expired assets;
- VAPID public/private key material and sender subject;
- scheduled triggers for per-minute notifications and daily expiration cleanup.

### 14.3 Environments

- One Cloudflare production environment only.
- Use local Wrangler/Miniflare D1 and local secrets for development and tests.
- Never point local development at production D1.
- Deploy to the generated `*.workers.dev` URL.
- Make origin-dependent constants configurable so a custom domain can be added later.

### 14.4 Migrations and release order

- Check every migration into version control.
- Prefer backward-compatible schema additions.
- Apply migrations before deploying code that requires them.
- Keep the previous Worker build available for rollback where Cloudflare supports it.
- Verify service-worker updates against the deployed `workers.dev` origin after each release.

### 14.5 Free-tier budget

Design Workers and D1 for the free tier, while treating Cloudflare Images as a separately metered approved service with explicit quotas and cost documentation. Design for:

- one notification cron invocation per minute;
- one expiration cleanup per day;
- indexed, bounded D1 queries;
- batched foreground sync;
- compact change records;
- no R2 backup and no paid external service.

Image deployment requirements and application limits:

- Cloudflare Images is separately metered; check the account dashboard and current Cloudflare Images pricing before release because provider storage and delivery allowances can change.
- Configure private named variants `thumbnail` (square list thumbnail, approximately 96×96 cover) and `preview` (edit/detail preview, at most approximately 1,600×1,600 fit) before deploying.
- The application accepts JPEG, PNG, and WebP source files up to 5 MB and 16 megapixels, removes source metadata through decode/re-encode, bounds the long edge to 1,600 pixels, and stores WebP at quality 82.
- The application allows at most 100 live assets per log and 20 new uploads per log per rolling hour. It reports a specific quota message without damaging the record or pending local image.
- Replaced, removed, cleared, and expired assets enter a 24-hour deletion grace period. Daily cleanup deletes at most 25 due assets per invocation and is safe to retry.

Document current Cloudflare quotas at implementation time and fail gracefully if scale exceeds them. Free-tier operation is a launch constraint, not a guarantee at arbitrary usage.

## 15. Observability

Use Cloudflare-only operational visibility:

- Worker exceptions and request failures;
- aggregate API status and latency;
- D1 query failures;
- notification attempts and invalid-subscription counts;
- scheduled-worker failures;
- current application version.

Do not record secret values, URLs containing fragments, request bodies, fast times, durations, weights, or detailed user histories. No Sentry and no session replay.

## 16. Testing strategy

Testing is intentionally minimal and happy-path focused.

Use Vitest-compatible unit/integration tooling within the Vite/Vinext project. Use fake IndexedDB or an isolated IndexedDB implementation for local-store tests and local D1/Miniflare for narrow API integration where practical.

Minimum automated coverage:

1. Duration, stage, calendar-overlap, and streak calculations.
2. Local mutation and IndexedDB transaction behavior.
3. Successful sync applies mutations idempotently and returns deltas.
4. A queued offline fast syncs after reconnection.
5. Secret rotation rejects the old secret.
6. Notification job times update when a goal changes.
7. Export excludes the secret and import replacement increments generation.

Do not build a Playwright suite initially.

Maintain a short manual release checklist for:

- installability on iOS and Android;
- first online load followed by offline launch;
- service-worker update prompt;
- notification permission and a real Web Push delivery;
- safe-area layout and portrait orientation;
- secret bookmark transfer to a second browser/device.

## 17. Suggested client/module boundaries

A possible organization:

```text
app/
  api/
  about/
  help/
  privacy/
  layout.tsx
  page.tsx
components/
  fast/
  today/
  foods/
  activities/
  grocery/
  calendar/
  stats/
  settings/
  sheets/
  shell/
lib/
  domain/          # pure fasting, calendar, stats calculations
  local-db/        # Dexie schema and repositories
  sync/            # mutation queue and sync coordinator
  api/             # shared contracts and client
  server/          # D1 repositories, auth, transactions
  notifications/   # subscription and job logic
  validation/
public/
  icons/
  manifest.webmanifest
  service-worker source/build output
migrations/
workers/
  scheduled.ts
```

Keep domain calculations framework-independent and shared where appropriate. Keep D1 code server-only. Keep service-worker code isolated from React rendering code.

## 18. Acceptance criteria

The release is complete when:

1. The production UI closely matches every supplied mockup screen and sheet.
2. A first visit creates a secret-linked log and leaves the secret visible in the fragment.
3. The same bookmarked secret opens and synchronizes the same log on another device.
4. All core actions work offline and reconcile automatically after reconnection.
5. Record-level conflicts follow server-arrival last-write-wins without replacing unrelated data.
6. Only one active fast remains authoritative across devices.
7. The PWA installs on supported iOS and Android platforms and launches offline after initial load.
8. The app prompts before applying a waiting service-worker update.
9. Opted-in installed devices receive advance and goal Web Push notifications after the start has synced.
10. Secret rotation immediately invalidates old online sessions and old devices erase local data when they reconnect.
11. Import/export, clear-all, remove-device, and undo flows behave as specified.
12. Theme, unit, timezone, locale-first weekday, statistics, and calendar calculations are correct.
13. The deployment uses Vinext on Cloudflare Workers, North American D1, production-only configuration, and free-tier-conscious scheduling.
14. Sensitive values do not appear in Cloudflare application logs.
15. The minimal automated tests and manual release checklist pass.
16. V2 foods/meals, activities/exercise, checklists, groceries, targets, and calendar layers work offline-first and synchronize across devices.
17. V2 image controls use authorized Cloudflare Images upload/delivery, support offline staging, and clean up replaced/deleted assets.

## 19. Explicit non-goals for v1

- Conventional accounts, email recovery, passkeys, or social login.
- Multiple saved logs within one browser/PWA.
- End-to-end encryption.
- Marketing site.
- QR-code or native-share link transfer.
- In-app notification quiet hours.
- Local closed-app alarm guarantees while fully offline.
- Custom extended-fast warning interstitial.
- Multiple Cloudflare deployment environments.
- R2 backups.
- External analytics, Sentry, or session replay.
- Playwright/E2E automation.
- Desktop-native or App Store/Play Store wrapper.
