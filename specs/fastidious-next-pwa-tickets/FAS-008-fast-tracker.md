# FAS-008 — Fast timer and editing flows

**Status:** Closed

## Objective

Implement the Fast tab and every related sheet/action at high visual fidelity, backed by Dexie operations and the sync coordinator.

## Dependencies

FAS-002, FAS-003, FAS-005, and FAS-007.

## Screen states

### Active fast

Render:

- kicker with started time;
- goal button;
- `HH:MM:SS` elapsed clock;
- time-to-goal or over-goal subline;
- progress bar with stage ticks and goal marker;
- Started and Goal blueprint cells;
- End Fast primary action;
- fasting stages card with current stage and description.

### Idle

Render:

- NOT FASTING state;
- elapsed eating time where previous completed fast permits it;
- Last Fast and Ended cells;
- eight preset tiles;
- selected default goal;
- Start `<goal>` Fast primary action;
- fasting stages card.

Use domain view models rather than embedding calculations in JSX.

## Timer implementation

- Store only timestamps.
- Use one foreground interval aligned approximately to second boundaries.
- Recompute from `Date.now()` every tick; never increment a counter.
- Pause/reduce work while document is hidden and recompute immediately when visible.
- Avoid rerendering the entire app every second; isolate the timer readout/progress.
- Respect reduced motion for progress transitions.

## Sheets

### Fast length

- eight presets;
- custom number input 1–168, step 0.5;
- Set validates and updates default/active goal;
- active-fast goal edits trigger sync and reminder rescheduling after FAS-014.

### Edit start

- `datetime-local` input in log timezone presentation;
- reject future starts and overlap;
- display live duration/validation note;
- Discard Fast destructive secondary action;
- Save disabled/no-op when invalid.

### Edit completed/past fast

- started and ended fields;
- live duration;
- overlap validation excluding the edited ID;
- Delete with Undo toast;
- Save mutation.

### Log past fast

- sensible local defaults;
- same validation;
- no future end;
- writes locally then queues sync.

### Fast complete

- duration, goal result, start/end summary;
- Edit Times;
- Done;
- Undo / Resume Fast.

Undo creates a compensating mutation. If a newer active fast has since started, show a conflict message instead of violating one-active-fast.

## Optimistic behavior

Every action succeeds locally first through FAS-005. Do not block Start/End on a network request. After commit, request foreground sync opportunistically. Display persistent sync failure separately without reverting valid local data.

## Accessibility

- Timer uses tabular numerals and an accessible label that does not announce every second as a live region.
- Progress bar has semantic value text.
- Stage marker meaning is available in text, not color alone.
- Preset selection exposes selected state.
- Error messages are associated with fields.
- Destructive actions have clear names.

## Visual details

Match the handoff:

- 80px condensed timer where it fits, scaling safely at narrow/text-zoom widths;
- 30px progress frame;
- tick and goal overhang;
- exact two-column cells;
- 56px primary button;
- registration marks and square corners;
- stage reached/current visual hierarchy.

## Test plan

Minimal component/integration tests:

1. Starting the selected preset calls one local `startFast` operation and shows active state.
2. Elapsed display derives from start timestamp under fake time.
3. Ending opens completion; Undo resumes when no newer active fast exists.
4. Invalid overlapping edit shows an error and does not call save.
5. Goal change updates the local record.

Rely on FAS-002 tests for calculation boundaries and FAS-005 for transaction mechanics. Do not retest them through every component.

## File plan

```text
components/fast/FastScreen.tsx
components/fast/FastReadout.tsx
components/fast/FastProgress.tsx
components/fast/FastInfoCells.tsx
components/fast/FastPresets.tsx
components/fast/FastingStages.tsx
components/fast/FastLengthSheet.tsx
components/fast/EditFastSheet.tsx
components/fast/FastCompleteSheet.tsx
components/fast/*.css
```

## Acceptance criteria

- Active and idle screens match the handoff.
- Timer remains correct after sleep/backgrounding.
- Every write works offline and enters the sync queue.
- Validation prevents all specified invalid intervals.
- End and delete actions are reversible as approved.
- No API call is required before local UI success.

## Out of scope

Calendar, aggregate stats, service-worker caching, and push delivery UI beyond a future hook.

## Completion note

Implemented the active and idle Fast tab, a timestamp-derived foreground timer, semantic progress and stage presentation, preset/custom goal selection, start/end flows, active-start editing and discard, past-fast logging/edit/delete, completion summary, and compensating Undo/Resume and restore actions. Every successful write uses the existing Dexie local operations and mutation queue before requesting opportunistic foreground sync; no network response gates local success. Runtime validation prevents future, non-positive, out-of-range, and overlapping intervals.

Validation: `npm test -- components/fast/FastScreen.test.tsx` passed (5 tests covering selected-preset start, timestamp-derived elapsed time, end/resume, overlap rejection, and active-goal changes); the complete `npm test` suite passed (17 files, 79 tests); `npm run typecheck`, `npm run build`, and `git diff --check -- .` passed. The production build completed with its existing Vinext/Rolldown sourcemap and dynamic-import warnings. Browser tooling was unavailable in this child session, so no Chrome visual evidence is claimed. Matching-viewport checks of light/dark active and idle states, empty/populated history, all fast sheets, Undo/conflict notices, narrow mobile/text zoom, reduced motion, and background/visibility timer recovery are deferred to the browser-enabled parent or FAS-016.