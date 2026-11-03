# FAS-013 — Service worker, offline shell, and update flow

**Status:** Closed

## Objective

Add reliable repeat-visit offline startup, safe asset caching, and user-controlled service-worker updates without treating HTTP cache as the application database.

## Dependencies

FAS-005 and FAS-012.

## Tooling decision

Use the FAS-012 build spike to select a Vinext/Vite-compatible service-worker build. Prefer an inject-manifest/Workbox-style setup only if it correctly receives Vinext's final hashed client assets. Otherwise implement a small explicit service worker plus a generated precache manifest.

Keep service-worker source under version control. Do not hand-edit generated asset lists.

## Cache boundaries

### Precache

Precache only the repeat-visit shell:

- root navigation shell or dedicated offline shell required to boot the client;
- hashed client JS/CSS assets;
- manifest-linked icons;
- self-hosted WOFF2 fonts;
- any tiny static SVGs required by the shell.

Do not precache server/RSC internals that are not needed offline.

### Runtime policies

- hashed static assets: cache-first, immutable;
- fonts/icons: cache-first with versioned cache;
- navigations: network-first with a short timeout, then cached shell fallback;
- same-origin non-hashed static assets: stale-while-revalidate only when safe;
- `/api/**`: network-only, never cached;
- external requests: do not cache by default.

A URL fragment is not part of an HTTP cache key, but code must still avoid persisting secret values in custom cache metadata/messages.

## Offline startup

After one successful online load:

1. `/` navigation loads the cached shell when offline.
2. Client bootstrap restores local secret.
3. Dexie supplies the current log immediately.
4. UI shows Offline tag.
5. Writes continue into Dexie/mutation queue.

An unknown secret opened for the first time offline cannot authenticate; show the explicit state from FAS-006.

## Registration

- Register only in the browser and production-like environments where appropriate.
- Surface registration failure through non-sensitive development/operational logging, not a blocking user error unless offline capability is unavailable after previously working.
- Expose typed registration/update state to the app shell.

## Update lifecycle

- New worker installs and waits.
- App detects `waiting` and shows “A new version is available.”
- User chooses Update.
- App sends a narrowly defined `SKIP_WAITING` message.
- On `controllerchange`, reload once.
- Pending mutations remain in Dexie.
- Do not auto-reload while the user is editing a sheet; prompt remains available.
- Add a forced-update mechanism only as a documented future seam, not an active v1 feature.

Coordinate multiple tabs to avoid reload loops.

## Cache versioning and cleanup

- Prefix caches with `fastidious` and a build version.
- Delete obsolete app caches during activate.
- Do not delete unrelated origin caches.
- Claim clients after approved activation.
- Keep old shell until the new worker activates successfully.

## Offline error handling

- Navigation fallback must return a valid HTML response, not a failed RSC stream.
- Failed API calls remain the sync engine's responsibility.
- Never report a mutation as server-synced based on service-worker interception.
- Do not implement custom background sync in v1; foreground triggers are sufficient.

## Test plan

Keep automated tests narrow:

1. Cache-policy matcher classifies `/api` as network-only and hashed assets as cache-first.
2. Update coordinator shows prompt for a waiting worker and sends `SKIP_WAITING` on action.
3. Controller change triggers only one reload.

Use manual device/browser checks for actual install/offline lifecycle.

## Manual checks

- First online visit then airplane-mode launch from installed iOS PWA.
- Same on Android.
- Active log and pending mutation remain visible offline.
- API responses do not appear in Cache Storage.
- Deploy a changed build, observe waiting prompt, update, and retain data.
- Old caches are removed after activation.

## Acceptance criteria

- Repeat visits launch offline after one successful load.
- Offline UI reads/writes Dexie correctly.
- API/authenticated data is never served from Cache Storage.
- Updates require user confirmation and reload once.
- Build output supplies a deterministic asset manifest.
- Implementation works with Vinext rather than relying on Next-only PWA behavior.

## Out of scope

Web Push display/click handlers, offline first-ever setup, background sync, and periodic background fetch.

## Completion note

Implemented a small module service worker and a Vinext/Vite client-build plugin that emits a content-versioned worker plus a sorted `service-worker-assets.json` from the final browser bundle. The worker precaches the root shell, final hashed client JS/CSS, manifest-linked and document icons, and self-hosted fonts; uses cache-first assets, network-first HTML navigation with a cached `/` fallback, and network-only `/api/**`; and removes only obsolete `fastidious-*` caches on approved activation. It does not implement background sync or cache authenticated API data.

The app now registers the worker only in production builds, exposes typed waiting-worker state to `AppShell`, prompts with “A new version is available,” sends only `{ type: "SKIP_WAITING" }` after the user selects Update, and reloads once on `controllerchange`. A controller change in another tab is deferred while an accessible sheet dialog is open; pending Dexie data is untouched.

Validation evidence:

- TDD red: `npm test -- pwa/service-worker.test.ts lib/service-worker/update.test.ts pwa/build-service-worker.test.ts` failed first because the service-worker source, update coordinator, and build integration did not exist.
- `npm test -- pwa/service-worker.test.ts lib/service-worker/update.test.ts pwa/build-service-worker.test.ts components/shell/AppShell.test.tsx` — 4 files and 6 tests passed.
- `npm test` — 25 files and 103 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — passed with the Vinext/Cloudflare pipeline; it emitted a 23-entry, content-versioned precache manifest from final client assets.
- A second consecutive `npm run build` produced an identical `service-worker-assets.json` (`cmp` passed), confirming deterministic output for unchanged inputs.
- Production preview served `/service-worker.js` and `/service-worker-assets.json` with HTTP 200; source checks confirmed the API network-only matcher and generated hashed CSS/font entries.
- `node --check .cloudflare/output/v0/workers/default/assets/service-worker.js` — passed.
- `git diff --check -- .` — passed.

Chrome/browser tooling was unavailable in this worker, so no visual or real service-worker lifecycle evidence is claimed. FAS-016 should check the update notice at a 390×844 viewport in light/dark mode and perform the ticket's iOS/Android first-load-then-airplane launch, retained active log/pending mutation, Cache Storage API exclusion, waiting-update/data-retention, and obsolete-cache cleanup checks on browser/device builds.
