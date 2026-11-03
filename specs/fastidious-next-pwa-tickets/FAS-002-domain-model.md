# FAS-002 — Domain types, validation, and calculations

**Status:** Closed

## Objective

Implement framework-independent domain models and pure calculations used by every UI and persistence layer. This ticket must contain no React, D1, Dexie, or network code.

## Dependencies

FAS-001.

## Domain contracts

Define branded or clearly named types for:

- `LogId`, `FastId`, `WeightId`, `DeviceId`, `MutationId`
- `EpochMs`
- `IanaTimezone`
- `ThemePreference = "system" | "light" | "dark"`
- `WeightUnit = "kg" | "lb"`
- `FastRecord` with nullable `endAt`
- `WeightRecord`
- `LogPreferences`
- preset and fasting-stage definitions

Persist UTC epoch milliseconds. Never persist locale-formatted strings.

### Fast invariants

- `startAt` is finite and not in the future when submitted.
- Completed `endAt` is finite, later than `startAt`, and not in the future.
- `goalHours` is 1–168 inclusive, in 0.5-hour increments.
- At most one active fast exists per log.
- A new/edited interval cannot overlap any non-deleted completed fast or the active fast, excluding the record being edited.

### Weight invariants

- canonical storage is kilograms;
- value is finite and greater than zero;
- input parsing rejects empty, malformed, infinite, and implausibly large values using a documented upper safety bound;
- conversion does not round canonical storage unnecessarily.

## Required pure modules

### `fasts`

- elapsed duration from `now - startAt`
- projected goal instant
- goal reached and over-goal duration
- timer/subline view model
- interval overlap detection with half-open interval semantics `[start, end)`
- preset lookup and custom goal validation
- current fasting stage from elapsed hours
- progress-scale maximum, marker positions, and goal position
- duration formatting for timer and compact display

Use the handoff stage data exactly. Keep health copy in one source file.

### `calendar`

- start/end of a civil day for an IANA timezone, including DST transitions
- split a fast's overlap across calendar days
- total fasted milliseconds for a day, clipping active fast at `now`
- month cell intensity buckets: `<8`, `<14`, `<18`, `<22`, `>=22` hours
- locale-derived first weekday
- month grid generation and year heatmap values

Use a timezone-capable approach that works in supported runtimes. If native `Temporal` is unavailable, use a small approved library or carefully tested `Intl` conversion helper; do not perform timezone math by adding fixed 24-hour milliseconds.

### `statistics`

- completed-fast average, longest, total hours, and count
- goal-met predicate
- current/longest streak using configured timezone and the approved end-day rule
- last 14 completed fasts
- goal-hit count

### `weight`

- kg/lb conversions
- locale-derived initial unit
- latest entry and 30-day delta
- last 24 sparkline normalization
- stable display rounding (one decimal)

### `locale`

- locale-safe date/time formatters
- locale-derived Sunday/Monday first weekday
- timezone detection with validation/fallback

## Validation API

Return discriminated results rather than throwing for expected user errors:

```ts
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; field?: string };
```

Separate raw API/import validation from domain construction. Unknown object input must be narrowed before domain functions receive it.

## Test plan

Write one failing test at a time. Minimum cases:

1. Exact goal boundary counts as reached.
2. Overlap rejects intersecting ranges but permits touching endpoints.
3. A 0.5-hour goal is rejected while 1, 1.5, and 168 pass.
4. Stage changes exactly at 4h, 12h, 18h, 24h, 48h, and 72h.
5. A fast crossing midnight contributes only its overlap to each day.
6. DST spring-forward and fall-back dates produce correct civil-day overlap.
7. Month intensity boundaries map correctly.
8. Streak begins from yesterday when today has no qualifying completed fast.
9. Streak ignores a completed fast that misses its goal.
10. kg/lb round trips remain within documented precision.
11. Locale unit and first-weekday defaults have deterministic fixtures.

Use fake `now` values and explicit timezones. Tests must not depend on the developer machine's current date, locale, or timezone.

## File plan

```text
lib/domain/types.ts
lib/domain/presets.ts
lib/domain/stages.ts
lib/domain/fasts.ts
lib/domain/calendar.ts
lib/domain/statistics.ts
lib/domain/weight.ts
lib/domain/locale.ts
lib/validation/domain.ts
lib/domain/*.test.ts
```

## Acceptance criteria

- All calculations are pure and deterministic given explicit `now`, locale, and timezone inputs.
- No framework/storage imports exist in `lib/domain`.
- DST behavior is covered.
- Validation codes are stable enough for UI/API mapping.
- The design handoff's presets, stage thresholds, and streak definition are represented once.
- Tests pass under a non-local timezone in CI or explicit timezone fixtures.

## Out of scope

Persistence, API schemas, visual components, sync, and push scheduling.

## Completion note

Implemented framework-independent domain records, stable discriminated validation, handoff presets and fasting-stage copy, fast/timer/progress calculations, timezone-aware calendar overlap and heatmaps, completed-fast statistics and streaks, weight conversion and trends, and locale/timezone helpers. The weight safety bound is documented in code as 1,000 kg. No UI changed, so Chrome comparison was not applicable.

Validation performed:

- `npm test` — 6 test files and 24 tests passed.
- `TZ=Pacific/Honolulu npm test -- lib/domain lib/validation/domain.test.ts` — 5 domain/validation test files and 23 tests passed under a non-local process timezone.
- `npm run typecheck` — passed.
- `npm run build` — passed; only the known Vinext sourcemap and ineffective-dynamic-import warnings were emitted.
- `git diff HEAD --check` — passed.