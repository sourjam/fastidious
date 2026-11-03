# FAS-023 — V2 calendar layers and day details

**Status:** Closed

## Objective

Extend the existing Day/Month/Year calendar with the v2 Food, Activity, and Checklist layers and connect calendar selections to the Today log.

## Dependencies

FAS-009 and FAS-017 through FAS-022.

## Shared layer switch

Month and Year modes display:

- Fasting;
- Food;
- Activity;
- Checklist.

Keep the selected layer while switching Month/Year where practical. Day mode remains a chronological day summary rather than four separate heatmaps.

## Fasting layer

Preserve FAS-009 behavior and accessibility. Do not regress timezone, DST, overlap, active-fast, or locale-first-weekday handling.

## Food layer

- Cell primary value is daily calories.
- Month may show compact protein as secondary text where legible.
- Heat intensity compares calories to the configured target; without a target it compares to the highest visible day.
- Empty days remain distinguishable from low-value days.

## Activity layer

- Cell value is daily exercise-entry count.
- Intensity compares with the highest visible day.

## Checklist layer

- Cell value is completed daily items over visible daily-item count.
- Weekly/monthly items appear in day details but do not inflate the daily heat denominator.
- Intensity is the completion ratio.

## Day and detail behavior

- Day clock includes meal markers at their local times.
- `Open day log` navigates to Today → Log for that date and includes meal count/calories when available.
- Selecting a non-fasting Month cell opens that day log or a concise day-detail sheet consistently.
- Year day selection opens a sheet with fasted duration, calories, protein, fiber, meals, checklist state, and exercise.
- Day-detail sheet offers `Open day log` and `Day view`.

## Performance

- Query each visible range once per entity type.
- Aggregate in one pass and memoize by visible range, timezone, layer, targets, and local revision.
- Do not persist heatmap aggregates.
- Avoid exposing hundreds of tiny keyboard stops; preserve the accessible grouped approach from FAS-009.

## Test plan

Minimum tests:

1. Food layer uses target intensity when configured and visible maximum otherwise.
2. Activity layer counts entries by configured timezone day.
3. Checklist heat excludes weekly/monthly items from its denominator.
4. Meal markers map to the correct day-clock angle on a DST day.
5. Month/year selection opens the correct civil-day detail.
6. Open Day Log lands on Today with the selected date.
7. Existing fasting heat and overnight overlap tests remain green.

## Acceptance criteria

- All four layer controls and legends match the v2 handoff in Month and Year.
- Layer information is available as text/aria labels, not color alone.
- Day details contain consistent local data from every implemented v2 feature.
- Existing calendar correctness and responsiveness do not regress.
- Light/dark Month and Year states are visually checked at 320px, 390px, and 440px.

## Out of scope

Persisted aggregates, server analytics, and calendar export formats.

## Completion note

Added Food, Activity, and daily-Checklist Month/Year heat layers, target-aware intensity, local-time meal clock markers, multi-feature day details, and Calendar-to-Today civil-date navigation while preserving fasting behavior and grouped Year accessibility.

Validation: 182 Vitest tests, TypeScript typecheck, production build, and `git diff --check` passed. Compared light/dark Month, Year, empty/populated heat, day-clock, and detail-sheet states with `Fastidious-v2.html` at 320×720, 390×844, and 440×900 Chrome viewports.
