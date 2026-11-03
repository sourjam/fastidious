# FAS-010 — Statistics and weight tracking

**Status:** Closed

## Objective

Implement the Stats tab: six summary cells, last-14-fasts chart, and weight card with offline add/delete behavior.

## Dependencies

FAS-002, FAS-003, FAS-005, and FAS-007.

## Statistics section

Render a 2×3 blueprint grid:

- Current streak
- Longest streak
- Fasts logged
- Average
- Longest fast
- Total hours

Use only completed, non-deleted fasts. Use the configured timezone for streaks and locale formatters for values. Display explicit empty values rather than `NaN` or misleading zero-duration text.

### Last 14 fasts chart

- Select the last 14 completed fasts by end time.
- Chart height 120px.
- Scale bars against the longest `max(duration, goal)` in the set.
- Goal-met bars use accent; missed goals use neutral-400.
- Display `N of 14 hit goal`, adjusted sensibly when fewer than 14 exist.
- Every bar has accessible text containing date, duration, goal, and result.
- Use semantic HTML/SVG; no chart dependency.

## Weight card

Render:

- latest value in selected unit;
- 30-day delta;
- 24-entry sparkline/bar chart;
- latest four entries;
- delete action per entry;
- `+ Add` button.

### Add weight sheet

- decimal input with current-unit label;
- parse locale-conservatively; do not accept ambiguous grouping separators;
- convert to canonical kg before local storage;
- reject empty, zero, negative, infinite, or out-of-range value;
- choose `measuredAt = now` in v1 unless the handoff provides date editing;
- save through one Dexie transaction and queue sync.

### Delete and Undo

- Delete locally immediately.
- Show Undo toast.
- Undo writes a compensating restore mutation.
- Sync errors do not remove the valid local optimistic result.

## Sparkline behavior

- Use last 24 non-deleted entries sorted chronologically.
- Normalize within observed min/max with a visible minimum bar height.
- Equal values render equal middle/usable bars rather than divide by zero.
- Labels/tooltips expose date and formatted value.
- No trend claims beyond the numeric 30-day delta.

## React/data flow

Read local fasts and weights through focused Dexie hooks. Keep calculations in FAS-002 pure functions. Do not recalculate on the timer's one-second tick; aggregate stats only need to react to record/preference changes.

## Test plan

Minimal behavior tests:

1. Summary renders deterministic values from known completed fasts.
2. A missed-goal bar receives missed status and accessible label.
3. Adding lb converts once to canonical kg and queues one mutation.
4. Deleting then Undo restores the entry through a compensating operation.
5. Empty weight data displays a useful state and Add action.

Do not duplicate pure calculation tests already in FAS-002.

## File plan

```text
components/stats/StatsScreen.tsx
components/stats/StatGrid.tsx
components/stats/RecentFastsChart.tsx
components/stats/WeightCard.tsx
components/stats/WeightSparkline.tsx
components/stats/AddWeightSheet.tsx
components/stats/*.css
```

## Acceptance criteria

- Layout and type hierarchy match the handoff.
- All calculations use local authoritative view data and approved domain helpers.
- kg/lb conversion is stable and canonical storage remains kg.
- Add/delete/Undo work offline and synchronize later.
- Charts have useful accessible descriptions and no third-party chart library.

## Out of scope

Editing weight timestamps/values, advanced trends, server analytics, and health recommendations.

## Completion note

Implemented the Stats tab from local Dexie fast, weight, and preference records. It includes the six-cell summary, accessible last-14-fasts chart, canonical-kg weight add flow, 30-day delta, 24-entry accessible sparkline, latest four entries, and immediate delete with compensating Undo. Focused component tests cover deterministic summaries, missed-goal chart semantics, one-time lb conversion with one queued mutation, delete/restore mutations, and the empty weight state.

Validation performed:

- `npm test -- components/stats/StatsScreen.test.tsx` — passed, 4 tests.
- `npm run typecheck` — passed.
- `npm test` — passed, 19 files and 89 tests.
- `npm run build` — passed; Vinext emitted its existing sourcemap and dynamic-import warnings.
- `git diff --check -- .` — passed.

Chrome tooling was not exposed to this worker, so no visual evidence is claimed. Defer handoff comparison to the browser-enabled parent/FAS-016 for light and dark themes at 320px, 390px, and 440px widths, covering empty and populated stats/weight states, goal-met and missed bars, equal-value and 24-entry sparklines, kg/lb display, the Add sheet and validation errors, delete/Undo, keyboard focus, and reduced motion.
