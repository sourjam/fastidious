# FAS-021 — Activity library and exercise logging

**Status:** Closed

## Objective

Implement the v2 reusable Activities library and Today exercise log.

## Dependencies

FAS-017, FAS-018, and FAS-019.

## Activity library

Today → Activities provides:

- search by activity name;
- categorized groups with counts;
- create, edit, delete, and move activity;
- create, rename, and delete categories;
- permanent `Other` fallback category;
- optional detail, safe external link, and image reference;
- usage count and most recent logged date;
- one-tap `Log`/`Logged` action for the selected day.

Category deletion moves activities to `Other`. Deleting an activity preserves historical exercise text and removes only its library link.

The New Activity sheet supports `Save` and `Save & log`. Image controls become functional in FAS-024.

## Today exercise log

- Show frequently used activities as quick-add chips.
- Accept free-text exercise entries.
- Optionally save a free-text entry to Activities.
- Timestamp entries in the selected civil day, using current time for today and a deterministic local default for past days.
- Show logged exercise rows with delete action and media when linked.
- Allow an unlinked historical entry to be promoted into the activity library.
- Prevent duplicate invocation from repeated taps while a local transaction is pending.

## Calendar integration

Expose tested daily activity counts and day-detail rows for FAS-023. Do not persist derived calendar totals.

## Accessibility

- Log buttons announce current logged state.
- Quick-add chips and delete controls have explicit accessible names.
- Category and activity sheets follow existing focus/keyboard conventions.

## Test plan

Minimum tests:

1. Logging a library activity creates one exercise entry and increments usage.
2. Repeated rendering does not duplicate an entry.
3. A free-text entry can be saved to the library in the same local transaction.
4. Deleting an activity preserves exercise history and clears its link.
5. Category deletion moves activities to `Other`.
6. Search filtering and empty states remain usable by keyboard.

## Acceptance criteria

- Activities library and exercise log match the v2 handoff at mobile widths.
- All writes are available offline and synchronize later.
- Usage/last-used metadata derives from exercise records rather than mutable counters.
- Historical exercise remains readable after library edits/deletes.
- Light/dark, empty/populated, logged/unlogged, and sheet states are visually checked.

## Out of scope

Workout programming, timers, wearable integrations, calorie-burn estimates, and image upload/delivery.

## Completion note

Implemented categorized Activities CRUD, derived usage and last-used metadata, one-tap logged state, Today quick-add and free-text exercise, atomic optional library saves, historical promotion, and link-preserving deletion behavior.

Validation: 174 Vitest tests, TypeScript typecheck, production build, and `git diff --check` passed. Compared empty, populated, logged, unlogged, editor-sheet, light, and dark states with `Fastidious-v2.html` at 320×720, 390×844, and 440×900 Chrome viewports.
