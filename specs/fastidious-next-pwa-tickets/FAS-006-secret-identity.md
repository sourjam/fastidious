# FAS-006 — Secret-link identity lifecycle

**Status:** Closed

## Objective

Implement log creation, visible fragment credentials, local restoration, API authentication, secret rotation, switching logs, revocation, and explicit remove-from-device behavior.

## Dependencies

FAS-004 and FAS-005.

## URL and token contract

Canonical active URL:

```text
/#/log/<unpadded-base64url-256-bit-secret>
```

The fragment never reaches the Worker automatically. A client bootstrap module parses and validates it. Reject malformed length/alphabet before making API requests.

The active secret is stored separately from ordinary Dexie domain tables in the smallest practical local credential store. Document why it is not exported. Do not place it in service-worker cache keys.

## Server routes

### `POST /api/logs`

- Rate-limit best effort by IP.
- Generate the token with Worker Web Crypto.
- Create an internal log ID and digest.
- Detect timezone/unit defaults sent by the client but validate timezone server-side.
- Set default theme `system`, goal `16`, last access, and 12-month expiration.
- Return the plaintext secret once with a bootstrap snapshot.
- Mark response `Cache-Control: no-store`.

### Authentication helper

- Read exact Bearer syntax.
- Validate token shape before hashing.
- Look up digest and distinguish valid, revoked/unknown, and bounded expired-marker states.
- Touch `last_access_at` and expiration only for meaningful successful authenticated requests; avoid excessive writes by coalescing touches to a reasonable interval.
- Return typed auth context with internal log ID and generations.

### `POST /api/secret/rotate`

- Requires current auth and explicit confirmation flag/version.
- Generate a new secret server-side.
- Atomically replace digest and increment credential generation.
- Cancel nothing else: data, push subscriptions, and preferences remain tied to the log.
- Return new secret once with `no-store`.

Old requests must fail immediately after the commit.

## Client bootstrap state machine

Use an explicit, readable state machine rather than nested effects:

1. `reading-location`
2. `opening-fragment-log` or `restoring-local-log`
3. `creating-log` when neither exists
4. `loading-local`
5. `ready`
6. terminal/actionable states: `offline-first-load`, `expired`, `revoked`, `invalid-link`, `fatal`

### Fragment present

- If it matches the locally active secret, open local data immediately and sync in background.
- If it differs, authenticate before destroying the existing local log.
- On success, switch local log and snapshot atomically.
- On offline first open of an unknown secret, show that an initial connection is required; do not overwrite the existing log.

### No fragment

- Restore locally remembered secret and rewrite the visible fragment.
- If none, create a log online.
- A never-loaded app cannot create a server log offline; show a clear retry state.

## Rotation client flow

- Explain that old devices lose access and erase local data after reconnecting.
- Call rotate while old credential is valid.
- Store the returned credential before replacing the fragment.
- If local storage fails after server rotation, show the new link prominently and offer Copy; do not hide the only returned secret.
- Update credential generation and resume sync.

## Revocation

Any authenticated call may return a stable revoked code. On receipt:

1. stop sync retries;
2. unsubscribe local PushManager best effort;
3. erase Dexie and remembered credential;
4. remove secret fragment;
5. show a revoked screen with Create new log.

Coordinate tabs with `BroadcastChannel` so one tab's revocation/rotation updates the others.

## Remove from device

- Ask for confirmation.
- Unsubscribe push locally and call unregister best effort.
- Erase local data/credential.
- Remove fragment and navigate to `/`.
- Create a fresh log when online.
- Never delete the original D1 log.

## Security details

- `Referrer-Policy: no-referrer` or equally strict policy.
- APIs use `Cache-Control: no-store`.
- Never interpolate secret into server-rendered markup, page title, logs, or error reports.
- Full secret remains visible in the client URL and Settings by approved product decision.
- Warn in UI that anyone with the link can edit/delete data.

## Test plan

Minimum tests:

1. New-log creation stores only a digest and returns a canonical secret.
2. Bootstrap restores local secret and fragment when URL is `/`.
3. Unknown fragment does not erase current local data before successful auth.
4. Rotation makes old token unauthorized and new token valid.
5. Revoked response triggers local erase.
6. Expired marker renders expired rather than silently creating an empty log.

Mock true boundaries only: location/history, credential storage, and API transport.

## Acceptance criteria

- Bookmarking the fragment transfers access to another online browser.
- Installed PWA start URL restores the locally active secret.
- Rotation is atomic and old credentials fail immediately.
- Revoked devices erase data on reconnect.
- No credential appears in logs, exports, or API caches.
- First-load offline states are understandable.

## Out of scope

Syncing domain mutations, PWA installation, and Web Push registration.

## Completion note

Implemented secret generation/digest-only persistence, exact Bearer authentication with coalesced access touches, full bootstrap snapshots, atomic rotation with stable revoked markers, no-store API responses, client credential restoration/switching, explicit offline/expired/revoked/invalid states, cross-tab rotation/revocation coordination, and confirmed remove-from-device cleanup. The active secret is kept outside exportable Dexie tables and is never placed in an API URL or cache key.

Validation: focused identity/server/shell tests passed (21 tests); the complete Vitest suite passed (63 tests); `npm run typecheck`, `npm run build`, and `git diff --check` passed. The production build included `/api/logs` and `/api/secret/rotate`. Automated DOM validation covered the access-link warning and rotate/remove actions. The Chrome harness was unavailable in this child session, so no visual comparison is claimed; final Chrome verification of the identity, error, and settings states is deferred to the browser-enabled FAS-016 release gate.