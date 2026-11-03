# FAS-011 — Settings, import/export, and destructive actions

**Status:** Closed

## Objective

Implement the You tab and all data-management flows: visible secret link, preferences, export, replacement import, clear-all, secret rotation entry point, and remove-from-device.

## Dependencies

FAS-003, FAS-005, FAS-006, and FAS-007.

## Settings screen

### Your link card

- Explain that there is no login and anyone with the link can access/edit the log.
- Display the full canonical secret URL openly by approved decision.
- Copy Link button copies the URL and temporarily changes to Copied.
- Do not add QR or native Share.
- Never place the secret in analytics/log messages.

### Preferences

- Appearance segmented control: System / Light / Dark.
- Weight unit: kg / lb.
- Timezone: current IANA timezone with an editable searchable/selectable list or validated text selection that remains usable on mobile.
- Default goal may be changed through existing fast-goal UI if not duplicated here.
- Preference writes are local-first and field-level mutations to reduce conflicts.

### Data summary

Show counts of non-deleted fasts and weights from IndexedDB.

## Export

Build a versioned JSON object from local IndexedDB:

```ts
{
  app: "fastidious",
  version: 1,
  exportedAt: string,
  preferences: { timezone, theme, weightUnit, defaultGoalHours },
  fasts: [...],
  weights: [...]
}
```

Requirements:

- exclude secret, digest, internal log ID, device ID, sync cursor, mutations, push subscriptions, notification jobs;
- validate/serialize deterministic field names;
- create a Blob and user download with a date-based filename;
- work offline;
- include active fast when present;
- revoke temporary object URLs.

## Import replacement

### Parse and preview

- Hidden file input accepts JSON.
- Enforce a practical size limit before parsing.
- Parse unknown JSON and validate every field/version.
- Re-run domain validation for intervals, overlaps, one active fast, goals, weights, timezone, and preferences.
- Show summary: counts, date range, timezone, active-fast presence, and preferences.
- Reject malformed/unsupported data without changing local state.

### Apply

- Explicit confirmation says current data will be replaced but link remains.
- Save one bounded pre-import local backup.
- In one local transaction, increment pending generation state, replace records/preferences, and enqueue a replacement mutation.
- The server atomically increments `data_generation`, replaces data, cancels old reminder jobs, and returns a snapshot.
- Other devices reset on generation mismatch.
- If offline, show that replacement is saved locally and awaiting sync.
- Provide a recovery action from the automatic backup until the next successful replacement or a documented expiry.

## Clear all data

- Explicit confirmation.
- Preserve secret/log identity and approved settings.
- Locally clear fasts/weights and enqueue generation-reset clear.
- Server increments generation, deletes/tombstones records, and cancels reminder jobs.
- No brief Undo toast.

## Secret rotation

Link to FAS-006 rotation flow. Warning must state:

- old bookmarks stop working;
- old devices lose access;
- old devices erase cached Fastidious data when they reconnect;
- offline devices cannot be remotely erased before reconnecting.

Show and copy the new link after success.

## Remove from this device

- Confirm this does not delete the server log.
- Best-effort unregister push.
- Unsubscribe local PushManager.
- Erase local database and credential.
- Remove fragment and create/open a fresh log through bootstrap.

## Test plan

Minimum tests:

1. Export contains domain data and excludes secret/device/sync fields.
2. Malformed import changes nothing.
3. Valid import preview reports counts and replacement queues one generation-reset mutation.
4. Clear retains identity/preferences but removes fasts/weights.
5. Copy Link uses the canonical visible URL.
6. Remove-device invokes push cleanup before local erase on the happy path.

## Acceptance criteria

- Screen matches handoff while adding System and timezone controls cleanly.
- Export works offline and never contains the credential.
- Import is all-or-nothing locally and server-side.
- Clear/import invalidate stale device generations.
- Rotation and remove-device warnings are accurate.
- No destructive action relies on ambiguous copy.

## Out of scope

Merge import, encrypted backup, email recovery, QR sharing, and multiple local profiles.

## Completion note

Implemented the You screen, synced field-level preferences, offline JSON export, validated replacement import with one local backup and recovery, generation-reset clear/replace synchronization, accurate rotation/removal confirmations, and device cleanup ordering. Validation: `npm test` (20 files, 95 tests), `npm run typecheck`, `npm run build`, and `git diff --check -- fastidious` passed. The focused settings, identity, and server validation run passed 31 tests across four files. Browser tooling was unavailable in this worker, so visual comparison remains deferred to the browser-enabled parent/FAS-016 for 440×956 and 320×568 light/dark You states, import/clear/rotate/remove sheets, populated/empty summaries, copied state, and offline pending-replacement notice.