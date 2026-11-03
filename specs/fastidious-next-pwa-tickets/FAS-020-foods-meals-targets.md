# FAS-020 — Food library, meal logging, and nutrition targets

**Status:** Closed

## Objective

Implement the v2 Foods library and Today meal log, including nutrition aggregation, reusable categories, one-off foods, optional targets, and active-fast integration.

## Dependencies

FAS-017, FAS-018, and FAS-019.

## Food library

Today → Foods provides:

- search by food name;
- categorized food groups and counts;
- create, edit, delete, and move food;
- create, rename, and delete categories;
- permanent `Other` fallback category;
- serving, calories, protein, fiber, optional price, and safe external link;
- add/remove grocery-list action, completed by FAS-022;
- empty and filtered-empty states.

Category deletion moves foods to `Other`. Food deletion does not alter historical meal snapshots.

The New Food sheet supports `Save` and `Save & log`. Image controls become functional in FAS-024.

## Meal logging

Today → Log supports:

- log/edit/delete a meal at a selected timestamp;
- search the food library and add items;
- increment/decrement quantity in 0.5 steps;
- show live meal calories/protein/fiber totals;
- add a one-off named item with editable nutrition;
- optionally save a one-off item to the library;
- show daily meals with time, item summary, and macros;
- distinguish no-meal and all-day-fast empty copy where applicable.

Meal validation and writes use FAS-017/FAS-018. A food library edit never rewrites an existing meal.

## Active-fast integration

When a new meal is logged after the active fast's start and not in the future, offer:

- `End fast` at the meal timestamp; or
- `Keep fasting`.

Do not end the fast automatically. Ending uses the existing overlap validation and completion/Undo behavior.

When idle and the latest meal is after the last completed fast and recent enough under the domain rule, Fast may offer `Start from last meal`.

## Daily targets

Add optional Calories, Protein, and Fiber targets to You.

- Empty means no target, not zero.
- Writes are local-first field-level mutations.
- Today cards show totals, target copy, and bounded progress.
- Food calendar intensity uses calories against target when available; FAS-023 completes the calendar UI.

## Accessibility

- Search results and quantity controls have explicit labels.
- Nutrition is available as text, not progress color alone.
- Sheets trap focus, return focus, respect reduced motion, and remain usable with the software keyboard open.

## Test plan

Minimum tests:

1. Adding a library food to a meal updates daily totals.
2. Quantity changes use 0.5 steps and cannot reach an invalid negative value.
3. One-off food can remain meal-only or be saved to the library.
4. Editing/deleting a food preserves historical meal nutrition.
5. Logging a meal during an active fast offers, but does not force, an end time.
6. Confirming the offer ends at the meal timestamp and remains undoable.
7. Targets persist offline and empty target fields remain null.
8. Category deletion moves foods to `Other`.

## Acceptance criteria

- Foods and meal sheets match the v2 handoff in light/dark mobile states.
- Meal and daily nutrition totals are deterministic and tested.
- Food/meal writes are local-first and synchronize across devices.
- Active-fast integration never silently changes fasting history.
- Search, category CRUD, empty states, and one-off flows are keyboard accessible.

## Out of scope

Barcode scanning, external nutrition APIs, recipes, image upload/delivery, and grocery completion behavior.

## Completion note

Implemented searchable category-based Foods CRUD, meal logging with immutable nutrition snapshots and half-serving controls, one-off items, Save & log, active-fast confirmation/Undo, recent-meal fast starts, and offline nutrition targets in You.

Validation: 168 Vitest tests, TypeScript typecheck, production build, and `git diff --check` passed. Compared Foods and meal sheets with `Fastidious-v2.html` in light and dark modes at 320×720, 390×844, and 440×900, including empty, filtered-empty, populated, editor, and software-keyboard-sized sheet layouts.
