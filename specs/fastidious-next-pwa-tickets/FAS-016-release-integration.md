# FAS-016 — Accessibility, integration, and production release

**Status:** Open

## Objective

Integrate all features, close cross-ticket gaps, verify accessibility and visual fidelity, and deploy the first production build to Cloudflare Workers.

## Dependencies

FAS-008 through FAS-015.

## Integration pass

Verify complete user journeys without introducing a new architecture:

1. First online visit creates a log and visible secret fragment.
2. Start a fast, enable notifications, background/close app, and receive reminders.
3. Edit goal/start and confirm calendar, stats, and scheduled jobs update.
4. Work offline, reload installed app, mutate data, reconnect, and sync.
5. Open bookmark on a second device and converge data.
6. Rotate secret; old online device revokes and erases.
7. Export, clear, and import replacement.
8. Remove log from one device without deleting server data.
9. Apply a waiting service-worker update without losing local mutations.
10. Open an expired-link fixture and receive the explicit expiration path.

Fix integration defects in the smallest owning module. Do not create a catch-all orchestration layer.

## Accessibility audit

### Keyboard and focus

- Tab order follows visual order.
- Every action is keyboard operable on desktop.
- Focus is visible.
- Sheets trap and restore focus.
- Confirmation/undo flows announce useful status.
- Sticky navigation exposes selected state.

### Semantics

- One sensible page heading structure per screen.
- Icon-only controls have labels.
- Form errors are associated with fields.
- Charts have text summaries.
- Timer is not a noisy per-second live region.
- Progress and tags expose meaning beyond color.

### Visual accessibility

- Check WCAG 2.2 AA contrast in light/dark themes.
- Check 200% browser zoom and mobile text scaling.
- Respect reduced motion.
- Verify touch targets.
- Verify safe-area insets on notched iPhone layouts.

Document any intentional visual-token adjustment needed for contrast.

## Visual fidelity audit

Compare every screen/sheet against the design handoff at a representative 390×844 and 440px-wide viewport:

- Fast idle and active
- Goal/edit/log/complete sheets
- Calendar day/month/year
- Stats and weight
- You/settings
- Install/update/offline/sync error states
- Light and dark themes

Preserve square corners, registration marks, typography, exact hierarchy, and narrow centered layout. Use browser screenshots only for visual verification, not DOM assertions.

## Minimal automated test gate

Run and keep only the focused tests established by earlier tickets. Required behavior coverage from `AGENTS.md` must pass:

- duration/overlap/stage/calendar/streak;
- local write + mutation atomicity;
- idempotent sync and one offline reconnection path;
- secret rotation rejection;
- reminder rescheduling;
- export excludes secret;
- import generation reset.

Do not add a broad Playwright suite to satisfy this ticket. Add a focused regression test only for an actual defect discovered during integration when the narrow layer can prove it.

## Manual device matrix

At minimum:

### iOS/iPadOS 16.4+

- Safari browser use
- Add to Home Screen guidance
- standalone launch
- repeat offline launch
- push permission and closed-app notification
- portrait request and safe areas

### Android current Chrome

- native install prompt
- standalone launch
- repeat offline launch
- push permission and closed-app notification
- update prompt

### Desktop current Chromium + Safari/Firefox smoke

- ordinary browser use
- keyboard navigation
- bookmark transfer
- unsupported capability fallbacks

Record platform/version/date and pass/fail notes in a release checklist file.

## Production configuration

- Create one North American D1 database.
- Apply checked-in migrations.
- Configure app and scheduled Workers with the same D1 binding.
- Generate production VAPID key pair; store private key and digest pepper only as Cloudflare secrets.
- Configure per-minute notification and daily cleanup schedules.
- Deploy app to its generated `*.workers.dev` URL.
- Confirm manifest/start URL/scope use that origin without hard-coded local URLs.
- Confirm no local/test database identifiers are in production config.

There is no staging environment. Use local Wrangler/Miniflare for migration rehearsal before touching production.

## Release commands and rollback

Document exact current commands for:

- local migration rehearsal;
- production migration;
- app Worker deploy;
- scheduled Worker deploy;
- tailing redacted logs;
- checking cron execution;
- Worker version rollback;
- D1 Time Travel restore.

Prefer a simple numbered runbook in `docs/release.md` or the root README.

## Free-tier verification

Before release, estimate/document:

- 1,440 notification cron invocations/day;
- one cleanup invocation/day;
- worst expected D1 reads/writes per active fast and sync;
- maximum batch sizes;
- service-worker/static asset delivery behavior.

If current Cloudflare free limits cannot support the selected minute cron, stop and present one clear adjustment rather than silently changing notification behavior.

## Final quality gates

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Then execute the manual release checklist and inspect production Cloudflare logs for redaction and errors.

## Acceptance criteria

- All parent-spec acceptance criteria are satisfied.
- Production deploy succeeds on the `workers.dev` origin.
- D1 migrations and both Workers are operational.
- Offline launch, update prompt, and real iOS/Android push pass manually.
- Visual screens match the handoff at target widths.
- Keyboard/focus/contrast/text-scaling checks pass or have explicit documented residual issues.
- Minimal automated tests pass without a coverage-percentage target.
- Release and restore commands are documented for a human maintainer.
- No secret or health value appears in inspected logs.

## Out of scope

New product features, custom domain, App Store packaging, broad browser automation, paid Cloudflare services, and architecture refactors.

## Progress note

Release preparation added a numbered production/migration/rollback/restore runbook, a platform and visual manual checklist, the missing production digest-pepper binding, and a focused heading-structure accessibility regression. Validation passed for type checking, all 117 tests, the production build, both deployment dry runs, and all three migrations in isolated local D1 state.

This ticket remains open. Production infrastructure is now deployed and smoke-tested, but real iOS/Android push and installed-PWA offline/update checks, the remaining multi-device/destructive journeys, scheduled invocation evidence, and the unfinished accessibility/visual checklist rows still require manual evidence. Do not mark it closed until every acceptance criterion and pending checklist row has evidence.

Parent-session follow-up validation:

- Chrome at 390×844 checked Fast idle/active, goal sheet, Calendar day/month, empty Stats/Weight, Settings, and light/dark themes against the HTML mockup.
- Chrome at 440×956 checked the active Fast layout, stage card, sticky navigation, and blueprint geometry.
- Local D1 migrations 0001–0003 applied and the browser completed new-log creation plus an offline-first local fast write.
- `npm run check` passed with 117 tests; app and notification Worker dry runs passed.
- Local release configuration now accepts `D1_DATABASE_ID` through the environment so production and local databases do not require a committed ID.

Production deployment follow-up (2026-10-30):

- Created North American D1 `fastidious` in `ENAM`, applied production migrations 0001–0003, and confirmed the expected remote schema.
- Deployed the app and notification Workers against the same D1. The app used the generated private deployment origin; notification schedules are `* * * * *` and `0 3 * * *`.
- Generated production digest/VAPID secrets, uploaded them as Cloudflare secrets, and deleted the temporary permission-restricted local secret files.
- Production Chrome passed new-log creation/sync, clean service-worker registration, start/edit/end/complete, Calendar day/year, manifest, and API smoke checks without application errors.
- Fixed a production-discovered first-install defect so a new device activates its initial service worker silently instead of showing a false update prompt; focused coverage raises the suite to 118 tests.
- Inspected a live app Worker tail sample: the request completed successfully with no application logs, exceptions, access fragment, authentication value, payload, fast time, or weight.
- Production smoke testing found that the scheduled-only Worker's public route threw a platform exception; it now returns a deliberate 404.
- User QA on an installed iOS 18.1.1 Home Screen app found that Add Weight and Custom Hours fields would not summon the keyboard although Safari worked. Touch focus, fixed-body removal, native-only focus, a non-fixed modal layer, and a fresh Home Screen installation did not resolve it. This exactly matches WebKit bug 279904, a critical iOS 18 platform defect affecting all installed web-app input types while Safari remains functional. The ineffective app-side experiments were reverted to preserve the validated focus/accessibility baseline. Restarting iOS is the safest reported device workaround; clearing Safari website data is a more destructive alternative.
- The same QA pass found that installing from the saved secret link launched a blank new log because the shared manifest forced `start_url: "/"`. iOS Safari now switches to a manifest that omits `start_url`, making Add to Home Screen fall back to the exact current document URL and preserve its fragment without exposing the secret in a manifest or request. Android/Chromium retains the root-start manifest for native installability. Focused manifest/platform coverage raises the suite to 122 tests; fresh iOS install retest remains pending.

Still pending: remaining log-sheet and failure-state visuals, installed-app offline and waiting-update mutation checks, scheduled minute/daily tail evidence and metrics, second-device/rotation/import/expiration journeys, accessibility matrix completion, and physical iOS/Android push testing.
