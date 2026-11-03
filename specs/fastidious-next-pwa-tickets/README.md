# Fastidious implementation tickets

This directory decomposes [`../fastidious-next-pwa-spec.md`](../fastidious-next-pwa-spec.md) into implementation-sized tickets. Each ticket is intentionally self-contained and bounded for an agent with a 100k-token context window.

FAS-017 through FAS-024 add the product changes shown in [`../design_handoff_fastidious/Fastidious-v2.html`](../design_handoff_fastidious/Fastidious-v2.html). For those additions, the v2 handoff supersedes the original `Fastidious.dc.html` reference.

## Rules for every ticket

1. Read and follow the repository-root [`AGENTS.md`](../../AGENTS.md), especially its human-simple code, one-question-at-a-time communication, and minimal happy-path testing guidance.
2. The parent specification remains the product source of truth. If a ticket conflicts with it, stop and reconcile the conflict before coding.
3. Keep the existing Vinext/Vite/Cloudflare architecture. Do not migrate to official Next.js/OpenNext.
4. Follow a narrow specify → failing test → minimum implementation → refactor loop for tested behavior.
5. Use plain CSS and design tokens, raw D1 SQL, Dexie for IndexedDB, explicit JSON APIs, and Cloudflare-only runtime services.
6. Do not introduce Playwright, Tailwind UI, an ORM, external analytics, Sentry, R2, accounts, or end-to-end encryption.
7. Never log access secrets, authorization headers, weights, fast timestamps, import payloads, or exported data.
8. Preserve offline writes. UI actions must commit to IndexedDB and the mutation queue atomically before reporting success.
9. Run `npm test`/the narrowest relevant Vitest command, `npm run build`, type checking, and `git diff --check` as appropriate for the ticket.
10. Update this index when a ticket is split, merged, or materially re-scoped.

## Delivery order

| ID | Ticket | Depends on | Parallel notes |
|---|---|---|---|
| FAS-001 | [Project foundation and test harness](./FAS-001-project-foundation.md) | — | First |
| FAS-002 | [Domain types, validation, and calculations](./FAS-002-domain-model.md) | FAS-001 | Can overlap late FAS-003 |
| FAS-003 | [Industry design system and app shell](./FAS-003-design-system-shell.md) | FAS-001 | Can overlap FAS-002 |
| FAS-004 | [D1 schema, migrations, and repositories](./FAS-004-d1-schema-repositories.md) | FAS-001, FAS-002 | Server foundation |
| FAS-005 | [Dexie local database and mutation queue](./FAS-005-local-database.md) | FAS-001, FAS-002 | Client foundation |
| FAS-006 | [Secret-link identity lifecycle](./FAS-006-secret-identity.md) | FAS-004, FAS-005 | Bootstrap/auth/rotation |
| FAS-007 | [Offline synchronization protocol](./FAS-007-sync-engine.md) | FAS-004, FAS-005, FAS-006 | Critical path |
| FAS-008 | [Fast timer and editing flows](./FAS-008-fast-tracker.md) | FAS-002, FAS-003, FAS-005, FAS-007 | Core product |
| FAS-009 | [Calendar day/month/year](./FAS-009-calendar.md) | FAS-002, FAS-003, FAS-005 | Can overlap FAS-008 |
| FAS-010 | [Statistics and weight tracking](./FAS-010-stats-weight.md) | FAS-002, FAS-003, FAS-005, FAS-007 | Can overlap FAS-009 |
| FAS-011 | [Settings, import/export, and destructive actions](./FAS-011-settings-data.md) | FAS-003, FAS-005, FAS-006, FAS-007 | App management |
| FAS-012 | [PWA manifest, icons, fonts, and install UX](./FAS-012-pwa-install.md) | FAS-003 | Can start before sync |
| FAS-013 | [Service worker, offline shell, and updates](./FAS-013-service-worker.md) | FAS-005, FAS-012 | Requires build spike |
| FAS-014 | [Web Push and scheduled Worker](./FAS-014-web-push.md) | FAS-004, FAS-006, FAS-007, FAS-012 | Server + SW |
| FAS-015 | [Expiration, security, privacy, and operations](./FAS-015-security-operations.md) | FAS-004, FAS-006, FAS-014 | Hardening |
| FAS-016 | [Accessibility, integration, and production release](./FAS-016-release-integration.md) | FAS-008 through FAS-015 | V1 release gate |
| FAS-017 | [V2 daily-log domain contracts](./FAS-017-v2-domain-contracts.md) | FAS-002 | Pure types, validation, calculations |
| FAS-018 | [V2 persistence, synchronization, and data portability](./FAS-018-v2-persistence-sync.md) | FAS-004, FAS-005, FAS-007, FAS-011, FAS-017 | Local/server foundation |
| FAS-019 | [Today log shell and recurring checklists](./FAS-019-today-checklists.md) | FAS-003, FAS-017, FAS-018 | First v2 UI slice |
| FAS-020 | [Food library, meal logging, and nutrition targets](./FAS-020-foods-meals-targets.md) | FAS-017–FAS-019 | Food and active-fast integration |
| FAS-021 | [Activity library and exercise logging](./FAS-021-activities-exercise.md) | FAS-017–FAS-019 | Can overlap FAS-020 |
| FAS-022 | [Grocery list and food linkage](./FAS-022-grocery-list.md) | FAS-017–FAS-020 | Depends on food identity |
| FAS-023 | [V2 calendar layers and day details](./FAS-023-v2-calendar-layers.md) | FAS-009, FAS-017–FAS-022 | Integrates all daily data |
| FAS-024 | [Cloudflare Images and v2 release integration](./FAS-024-cloudflare-images-v2-release.md) | FAS-016–FAS-023 | Images intentionally implemented last |

## Recommended milestones

### Milestone 1 — foundations

FAS-001 through FAS-007. Exit when a secret-linked log can be created, mutated offline, and synchronized through local D1.

### Milestone 2 — complete application

FAS-008 through FAS-011. Exit when every screen and data-management flow in the handoff works against IndexedDB and sync.

### Milestone 3 — installability and reminders

FAS-012 through FAS-014. Exit when the app installs, launches offline after first load, updates safely, and receives a real push.

### Milestone 4 — v1 production readiness

FAS-015 and FAS-016. Exit when retention, security, privacy, accessibility, manual device verification, and Workers deployment pass.

### Milestone 5 — v2 daily log

FAS-017 through FAS-024. Exit when foods/meals, activities/exercise, recurring checklists, groceries, nutrition targets, calendar layers, and Cloudflare Images work offline-first and synchronize across devices.

## Cross-ticket contracts

These contracts must not drift across tickets:

- **IDs:** client-generated UUIDs for fasts, weights, devices, and mutations.
- **Time:** UTC epoch milliseconds in persistence; IANA log timezone for calendar boundaries.
- **Auth:** `Authorization: Bearer <256-bit base64url secret>`; D1 stores only a digest.
- **Conflict rule:** last mutation accepted by the server wins per record; device clocks never decide.
- **Sync reset:** `dataGeneration` mismatch requires snapshot/reset and discards stale queued mutations.
- **Local-first:** IndexedDB change and queued mutation share one Dexie transaction.
- **Server cursor:** monotonically increasing per-log revision.
- **Push:** server scheduled; device-only timing is not a closed-app guarantee.
- **PWA start:** manifest starts at `/`; local credential restores the active log; visible active URLs use `#/log/<secret>`.
- **One active fast:** enforced both locally and transactionally on the server.
- **Historical snapshots:** meal and exercise history does not change when a reusable food/activity changes.
- **V2 local-first:** foods, meals, activities, exercise, checklists, groceries, targets, and image attachment metadata use the existing mutation queue.
- **Images:** binaries use Cloudflare Images and are implemented in FAS-024; D1/sync carry opaque references only.

## Definition of done for an individual ticket

- All listed behavior and acceptance criteria are implemented.
- New runtime inputs have validation and typed contracts.
- Required tests pass and test names describe observable behavior.
- Error, loading, offline, and empty states are not left implicit.
- Visual work has been compared with the mockup in Chrome at matching viewports and relevant states.
- No unrelated refactor or dependency is included.
- Documentation and migrations/configuration are updated with the code.
- Residual risks or deferred follow-ups are recorded in the ticket or pull request.
- The ticket file is marked `**Status:** Closed` with a short completion/validation note.
- The completed chunk is committed separately with a detailed message that includes the ticket ID when practical.
