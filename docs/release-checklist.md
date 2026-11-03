# Fastidious production release checklist

Copy this file into the release record and fill in the exact platform version, date, tester, result, and notes. **Pending** is not a pass. Use only synthetic test data and never record an access link or health value here.

## Release record

- App commit: `<commit>`
- App Worker version: `<version>`
- Notification Worker commit/version: `<commit>` / `<version>`
- Production `workers.dev` origin: `https://<deployment>.workers.dev`
- Production D1 ID and primary region: `<database-id>`, `<region>`
- Release date/tester: `<date>`, `<tester>`

## Automated and configuration gates

| Check | Result | Evidence / notes |
|---|---|---|
| `npm run typecheck` | Pass | Final `npm run check` completed without TypeScript errors. |
| `npm test` | Pass | 28 files and 122 focused tests passed. |
| `npm run build` | Pass | Vinext production build completed; expected app and API routes emitted. |
| App deploy dry run | Pass | Dry run passed during release preparation; final app deploy also completed successfully. |
| Scheduled Worker deploy dry run | Pass | Notification-worker dry run completed with the production D1 binding. |
| Local migration rehearsal | Pass | Applied `0001_initial.sql`, `0002_revoked_secrets.sql`, and `0003_web_push.sql`. |
| Production migrations | Pass | Applied migrations 0001–0003 successfully to the release-record D1. |
| Both Workers share production D1 | Pass | Both deploy outputs reported `env.DB (fastidious)`; remote schema contains all migration tables. |
| No local/test D1 identifier deployed | Pass | Both Workers were deployed with the release-record database ID supplied through `D1_DATABASE_ID`. |
| Minute and daily cron triggers present | Pass | Notification deploy reported `* * * * *` and `0 3 * * *`. |
| Manifest/start URL/scope use deployed origin | Pass | Production manifest returned 200 with relative `/` id, start URL, and scope. |
| Redacted production logs inspected | Pass | Live app tail showed an `ok` root request, no exceptions, and no application logs, secret fragment, auth value, payload, fast time, or weight. |

## Complete product journey

| Journey | Result | Evidence / notes |
|---|---|---|
| First online visit creates a log and leaves its secret fragment visible | Pass | Production Chrome created and synchronized a synthetic log; the secret remained in the fragment and is intentionally not recorded here. |
| Start fast and enable reminders contextually | Partial | Production start/end and the contextual reminder card passed; physical-device permission and delivery remain pending. |
| Edit start/goal; timer, calendar, stats, and scheduled jobs update | Partial | Edit and completion sheets, timer, Calendar day/year, API writes, and sync passed; real push-job rescheduling remains pending. |
| Offline reload opens installed app; local mutation survives and syncs after reconnect | Pending | |
| Bookmarked link opens on second device and both devices converge | Pending | |
| Secret rotation rejects old online device and erases its local Fastidious data | Pending | |
| Export excludes secret; clear and confirmed import replacement work | Pending | |
| Remove from one device leaves server data available on another | Pending | |
| Waiting service-worker update applies without losing a queued mutation | Pending | |
| Expired-link fixture shows expiration screen and can create a new log | Pending | |

## iOS/iPadOS 16.4+

Record device, OS, Safari version, installed/not installed state, date, and tester.

| Check | Result | Evidence / notes |
|---|---|---|
| Safari browser use and first log creation | Partial | User confirmed Safari input behavior; full journey remains pending. |
| Share → Add to Home Screen guidance | Pending | Requires Safari. |
| Standalone launch and visible active secret fragment behavior | Partial | Fixed loss of the active log during Add to Home Screen: iOS now receives a manifest without `start_url`, so installation falls back to the exact current secret-fragment page without sending the secret over the network. Fresh-install retest remains pending. Separately blocked by WebKit bug 279904 on iOS 18.1.1 keyboards. |
| Repeat launch while offline | Pending | Test only after one successful online load. |
| Push explanation precedes browser permission | Pending | |
| Closed-app advance and goal Web Push | Pending | Requires production VAPID and scheduled Worker. |
| Portrait request, notch safe areas, and 200% text scaling | Pending | Check header, sheets, toast, and tab bar. |
| Service-worker update prompt | Pending | Requires two deployed versions. |

## Current Android Chrome

Record device, Android version, Chrome version, date, and tester.

| Check | Result | Evidence / notes |
|---|---|---|
| Native install prompt and standalone launch | Pending | Requires a physical supported Android device. |
| Repeat launch while offline | Pending | Test only after one successful online load. |
| Push explanation and permission | Pending | |
| Closed-app advance and goal Web Push | Pending | Requires production VAPID and scheduled Worker. |
| Waiting service-worker update prompt and confirmed reload | Pending | Requires two deployed versions. |
| Mobile text scaling and touch targets | Pending | Check every interactive screen and sheet. |

## Desktop browser and accessibility matrix

Record OS, browser version, viewport, zoom, date, and tester.

| Browser/check | Result | Evidence / notes |
|---|---|---|
| Current Chromium ordinary use and bookmark transfer | Partial | Production ordinary use, clean service-worker registration, fast lifecycle, and Calendar smoke passed at 390px; second-device bookmark transfer remains pending. |
| Current Safari ordinary use and capability fallbacks | Pending | |
| Current Firefox ordinary use and capability fallbacks | Pending | |
| Keyboard visual-order tab sequence on every screen/sheet | Pending | |
| All actions operable by keyboard | Pending | |
| Visible focus; sheet initial focus, trap, Escape, and restoration | Pending | |
| Confirmation and undo announcements | Pending | |
| One page heading per tab; labels, field errors, chart summaries, progress meaning | Pending | Automated heading regression exists; manually inspect the rest. |
| Timer does not announce once per second | Pending | Inspect with a screen reader. |
| Light/dark WCAG 2.2 AA contrast | Pending | Measure rendered colors, including text mixed with backgrounds. |
| 200% browser zoom and reduced motion | Pending | |

## Visual fidelity

Compare implementation and `specs/design_handoff_fastidious/Fastidious.dc.html` side by side. Capture screenshots for visual evidence only.

Test both **390×844** and **440px-wide** viewports in light and dark themes:

- [x] Fast idle
- [x] Fast active
- [ ] Goal, edit, log, and complete sheets (goal/edit/complete checked; log remains)
- [x] Calendar day, month, and year
- [x] Stats and weight
- [x] You/settings
- [ ] Install guidance
- [ ] Update available
- [ ] Offline
- [ ] Persistent sync error
- [ ] Square corners, registration marks, typography, hierarchy, and centered 440px maximum shell

Result: Partial — Chrome comparisons passed for the checked states at 390×844 and 440×956 in light/dark themes. Remaining states and physical-device rendering still require manual QA.

## Production operations

- [ ] Scheduled tail shows a successful minute reminder invocation with version metadata and aggregate counts only.
- [ ] Scheduled tail/dashboard shows a successful daily cleanup invocation.
- [ ] Worker exception and request-failure metrics are normal after smoke testing.
- [ ] D1 read/write metrics are within the launch estimate in `release.md`.
- [x] Previous compatible app version `a83e3a12-c2e2-4ce6-86d8-d8a696f0e613` is recorded; rollback commands are documented.
- [ ] Current D1 Time Travel retention/bookmark is recorded.

## Sign-off

- Overall result: **Pending**
- Blockers/residual issues: physical iOS/Android push, installed-PWA offline/update testing, second-device/rotation/import/expiration journeys, remaining visual/accessibility states, scheduled invocation tails, and post-smoke platform metrics must be completed before sign-off.
- Sign-off name/date: Pending
