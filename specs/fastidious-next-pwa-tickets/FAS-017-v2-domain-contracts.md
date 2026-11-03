# FAS-017 — V2 daily-log domain contracts

**Status:** Closed

## Objective

Define the framework-independent domain types, validation, calculations, and cross-feature behavior introduced by `specs/design_handoff_fastidious/Fastidious-v2.html`.

This ticket establishes contracts only. It must not contain React, Dexie, D1, network, or Cloudflare Images code.

## Dependencies

FAS-002. The v2 handoff supersedes the original handoff where the two differ.

## Domain records

Add clearly named UUID-backed IDs and records for:

- food categories and foods;
- meals and meal items;
- activity categories and reusable activities;
- exercise log entries;
- checklist items and completions;
- grocery items;
- optional nutrition targets;
- nullable image asset references used later by FAS-024.

Persist instants as UTC epoch milliseconds and evaluate civil days, weeks, and months in the log's configured IANA timezone.

## Required contracts

### Foods and meals

A food contains name, serving label, category, calories, optional protein/fiber/price, optional external URL, and optional image reference.

A meal contains a timestamp and at least one item. Each meal item stores a nutrition snapshot plus an optional food ID. Editing or deleting a library food must not rewrite historical meals.

Support:

- half-unit quantity steps;
- deterministic calorie/protein/fiber totals;
- one-off meal items;
- optionally saving a one-off item into the food library;
- category rename and deletion, moving affected foods to `Other`;
- normalized safe `http`/`https` links only.

### Activities and exercise

An activity contains name, category, optional detail, URL, and image reference. An exercise entry stores its own text snapshot and optional activity ID. Deleting an activity leaves historical exercise text intact and clears only the link.

Calculate activity usage count and most recent use.

### Checklists

A checklist item contains name, cadence (`daily | weekly | monthly`), optional URL, and optional image reference.

Completion semantics:

- daily items may be completed once per civil day;
- weekly items may be completed once per locale-independent Sunday–Saturday product week, matching the v2 handoff;
- monthly items may be completed once per calendar month;
- toggling from another day in the same weekly/monthly period moves or removes the single completion rather than creating duplicates.

Expose pure helpers for visibility, completion state, display metadata, and daily completion ratios.

### Grocery

A grocery item contains name, completion/cart state, optional food link, optional URL/image override, and stable ID. A linked food supplies price/media when the grocery item has no override.

Deleting a food clears grocery links without deleting grocery items. Matching by name may assist initial linking but must not become persistent identity.

### Targets and calendar layers

Optional daily targets are calories, protein grams, and fiber grams. Missing targets are distinct from zero.

Add pure calculations for:

- daily meal nutrition;
- daily activity count;
- daily checklist completion count and denominator;
- relative heat intensity against a configured target or the visible range's highest day;
- day-detail summaries used by month/year calendar selection.

## Validation

Use the existing discriminated `ValidationResult<T>` pattern. Reject:

- empty names;
- non-finite or negative nutrition and prices;
- empty meals;
- non-positive or non-half-step quantities;
- unsupported cadence/category values;
- malformed URLs or non-HTTP protocols;
- timestamps outside existing product safety bounds;
- image references that do not match the opaque asset-reference schema.

Set practical length limits for names, serving labels, details, and URLs before persistence/API work begins.

## Test plan

Minimum tests:

1. Editing a food does not change a meal item's stored nutrition snapshot.
2. Half-unit quantities aggregate calories, protein, and fiber correctly.
3. Deleting a category moves its foods/activities to `Other`.
4. Deleting an activity preserves historical exercise text.
5. Daily, weekly, and monthly checklist toggles enforce one completion per period.
6. Week/month boundaries are correct in an explicit timezone.
7. Grocery food deletion clears the link but keeps the item.
8. Missing nutrition targets remain `null`, not zero.
9. Heat intensity uses a target when present and visible-range maximum otherwise.
10. Unsafe URLs and invalid numeric input are rejected.

## Acceptance criteria

- Every v2 record has an explicit invariant and stable ID.
- Historical meal/exercise records survive library edits and deletes.
- Timezone-sensitive checklist/calendar calculations are deterministic.
- Pure modules have no framework, storage, or network imports.
- Focused domain tests pass under at least two explicit timezones.

## Out of scope

Persistence, synchronization, UI, image upload/delivery, and migration of existing databases.

## Completion note

Added branded v2 record contracts, runtime validators, timezone-aware meal/activity/checklist calculations, immutable historical snapshots, category and library-delete helpers, grocery fallback metadata, nutrition targets, and relative calendar intensity. Validated with 140 passing Vitest tests across the full suite, `npm run typecheck`, `npm run build`, and `git diff --check`; timezone-focused tests cover UTC and America/New_York.
