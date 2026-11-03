# FAS-009 — Calendar day, month, and year views

**Status:** Closed

## Objective

Implement the Calendar tab with the handoff's day clock, month heatmap, and year heatmap. All calculations use local Dexie data and the configured log timezone.

## Dependencies

FAS-002, FAS-003, and FAS-005. Sync may be unfinished during initial UI work, but final acceptance requires synchronized local data.

## Shared behavior

- Three-segment Day/Month/Year control.
- Previous/next navigation appropriate to mode.
- Stable selected date/month/year in client state.
- Locale-aware labels and first weekday.
- Log timezone determines civil-day boundaries.
- Opening Calendar defaults to today in the configured timezone.
- Changing timezone recomputes grouping without mutating UTC records.

Avoid persisting derived day totals. Query relevant fast ranges from IndexedDB and calculate through FAS-002.

## Day view

### SVG clock

Create an accessible 300px SVG:

- midnight at top, clockwise;
- radius/stroke dimensions from handoff;
- 24 ticks, major ticks every six hours;
- labels 12a/6a/12p/6p, localized only where it remains legible;
- completed fast arcs in accent;
- live fast arc in accent-400;
- now hand only when viewing today;
- center total and FASTED label.

Split intervals crossing midnight to the day's clipped range. Handle DST days by mapping elapsed instants across the actual civil-day duration while maintaining understandable clock labels; document the chosen visual mapping.

Provide a text summary adjacent to or linked from the SVG for screen readers.

### Fast list

- time range;
- duration;
- date/meta/goal;
- Goal met, Short, or Live tag;
- row opens edit sheet from FAS-008;
- `+ Log a past fast` opens past-fast sheet;
- clear empty state.

## Month view

- Sunday/Monday-first based on locale.
- Seven-column grid and weekday headings.
- Cells use `aspect-ratio: 1 / 1.1`.
- Today's cell uses text-colored border.
- Show date and compact fasted hours.
- Heat scale:
  - under 8h → accent-100
  - under 14h → accent-200
  - under 18h → accent-300
  - under 22h → accent-400
  - 22h+ → accent-600 with suitable text
- Selecting a day switches to Day mode.
- Subtitle shows completed fast count and average for the displayed month.
- Include text/aria labels so color is not the sole information.

## Year view

- Twelve rows.
- Locale month label plus up to 31 cells.
- Invisible invalid date cells.
- Same heat scale.
- Selecting month label switches to Month mode.
- Tiny day cells may use title/aria labels but must not become an unusable 372-button keyboard trap; choose an accessible grouped representation and document it.

## Legend

Month and Year modes display the hours-fasted legend with labels and swatches. Ensure the strongest fill passes contrast in both themes.

## Performance

- Query only intervals overlapping the visible range.
- Calculate day totals in one pass rather than filtering all fasts once per cell.
- Memoize by visible range, timezone, and a stable local-data revision.
- Do not optimize with a persisted aggregate table in v1.

## Test plan

Minimal tests:

1. Month grid starts on locale-derived weekday and selects a day.
2. Overnight fast contributes to both dates.
3. Active fast appears Live in today's list.
4. Heat boundary labels/colors derive from the tested domain scale.
5. Changing timezone regroups without changing stored timestamps.

Do not pixel-test SVG paths. Unit-test arc input calculations and component-test visible labels/actions.

## File plan

```text
components/calendar/CalendarScreen.tsx
components/calendar/CalendarModeSwitch.tsx
components/calendar/CalendarNavigation.tsx
components/calendar/DayClock.tsx
components/calendar/DayFastList.tsx
components/calendar/MonthGrid.tsx
components/calendar/YearGrid.tsx
components/calendar/HeatLegend.tsx
components/calendar/*.css
```

## Acceptance criteria

- All three views visually match the handoff.
- Timezone, locale-first weekday, overnight ranges, active fast, and DST dates behave predictably.
- Month/year information is available without relying only on color.
- Visible-range calculation is responsive with years of realistic toy-app data.
- Fast rows reuse the established editor instead of creating a second edit implementation.

## Out of scope

Server aggregates, calendar export formats, and persisted heatmap caches.

## Completion note

Implemented the local-first Day, Month, and Year calendar views against synchronized Dexie fast records. The day clock maps elapsed instants linearly across each civil day's actual duration, so 23-hour and 25-hour DST days remain complete circles while the fixed 12a/6a/12p/6p labels stay legible. The year heatmap exposes twelve focusable month controls rather than hundreds of day buttons; each month is an accessible group with a text summary, and individual cells retain pointer titles.

Validation performed:

- `npm test -- lib/domain/calendar.test.ts components/calendar/CalendarScreen.test.tsx` — passed, 10 tests.
- `npm run typecheck` — passed.
- `npm test` — passed, 18 files and 85 tests.
- `npm run build` — passed; Vinext emitted its existing sourcemap and dynamic-import warnings.
- `git diff --check -- .` — passed.

Chrome tooling was not exposed to this worker, so no visual evidence is claimed. Defer handoff comparison to the browser-enabled parent/FAS-016 for light and dark themes at 320px, 390px, and 440px widths, covering Day empty/completed/live/DST states, Month empty/populated/today/locale-first-weekday states, Year populated/today states, navigation, editors, and keyboard focus.
