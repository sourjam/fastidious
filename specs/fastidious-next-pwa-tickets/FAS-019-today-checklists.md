# FAS-019 — Today log shell and recurring checklists

**Status:** Closed

## Objective

Add the v2 five-tab shell and implement the Today → Log date navigation, nutrition summary slots, and recurring checklist experience from `Fastidious-v2.html`.

## Dependencies

FAS-003, FAS-017, and FAS-018.

## Navigation and day state

- Add `Today` between Fast and Calendar in the bottom navigation.
- Keep the single 440px application column and fixed safe-area-aware navigation.
- Today has `Log`, `Foods`, and `Activities` sub-tabs; this ticket implements Log and provides stable routes/state for later tickets.
- Previous/next controls move by civil day in the log timezone.
- Opening Today defaults to the current log day.
- Do not allow navigation state to mutate records or reset draft work unexpectedly.

## Daily summary

Render Calories, Protein, and Fiber cards using FAS-017 calculations. Before FAS-020 adds meals, these correctly show zero/empty state. Show optional target text and progress only when a target exists.

## Checklist card

- Show completed count and total visible items.
- Toggle daily items for the selected day.
- Weekly/monthly items display cadence and one completion for the selected period.
- Completed state uses more than color and remains screen-reader readable.
- Rows may expose safe external links.
- Individual Edit opens a sheet for name, cadence, URL, and later image controls.

## Checklist management

The card-level Edit sheet supports:

- adding and removing items;
- opening an item editor;
- cycling or selecting Daily/Weekly/Monthly cadence;
- preserving item order;
- clear empty state;
- keyboard and screen-reader operation.

Deletion removes the item and its synced completions after explicit confirmation when history exists. Do not rely on a tiny unlabeled × control in production.

Image controls are completed in FAS-024. This ticket keeps the layout ready for them without fake uploads.

## Offline behavior

Every toggle and item edit commits locally before success UI. Routine sync remains invisible. An offline user can navigate dates and edit checklists from local data.

## Test plan

Minimum tests:

1. Today opens on the configured timezone's civil day.
2. Previous/next navigation crosses a DST date correctly.
3. A daily toggle is committed with its mutation atomically.
4. A weekly item completed on one day appears complete on another day in that week.
5. A monthly item cannot create two completions in one month.
6. Checklist add/edit/delete and cadence changes are keyboard reachable.

## Acceptance criteria

- Bottom navigation and Today sub-tabs match the v2 handoff at 320px, 390px, and 440px widths.
- Selected-day summary and checklist state render entirely from IndexedDB.
- Daily/weekly/monthly semantics match FAS-017.
- Offline toggles survive reload and later synchronize.
- Empty, populated, partial, complete, light, and dark states are visually checked.

## Out of scope

Meal logging, food library, activity library, exercise, grocery behavior, and actual image upload.

## Completion note

Implemented the five-tab shell, Today sub-tabs, timezone-aware civil-day navigation, IndexedDB-backed nutrition summaries, and daily/weekly/monthly checklist management with atomic offline mutations, safe links, and history-aware deletion confirmation.

Validation: 159 Vitest tests, TypeScript typecheck, production build, and `git diff --check` passed. Compared the implementation with `Fastidious-v2.html` and exercised empty, populated, partial, complete, light, dark, sheet, and deletion-confirmation states at 320×720, 390×844, and 440×900 Chrome viewports.
