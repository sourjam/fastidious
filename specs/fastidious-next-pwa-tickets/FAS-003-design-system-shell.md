# FAS-003 — Industry design system and application shell

**Status:** Closed

## Objective

Recreate the shared visual system and responsive shell from the HTML handoff before implementing feature screens. Establish accessible primitives for blueprint cards, buttons, tags, segmented controls, sheets, fields, tab navigation, toasts, and status notices.

## Dependencies

FAS-001. It may proceed in parallel with FAS-002.

## Visual source of truth

- `specs/design_handoff_fastidious/Fastidious.dc.html`
- `specs/design_handoff_fastidious/styles.css`
- `specs/design_handoff_fastidious/README.md`

Do not reinterpret the design into a generic component library. Match its square geometry, hairlines, typography, spacing, steel-blue accent, and registration marks.

## Implementation details

### 1. Tokens

Create global custom properties for:

- light/dark background, surface, text, divider, accent, accent ramp, and neutral ramp;
- Barlow and Barlow Condensed font families;
- documented sizes and weights;
- spacing, shadow, safe-area values, focus rings, and motion durations.

Theme behavior:

- `system` follows `prefers-color-scheme`;
- explicit light/dark overrides system;
- set `color-scheme` correctly;
- prevent a flash of the wrong theme using a tiny pre-hydration preference application that does not expose secrets.

### 2. Shell

Build a client-aware shell with:

- centered single column, `max-width: 440px`, `min-height: 100dvh` with safe fallbacks;
- safe-area-aware header;
- wordmark, current date, and optional Offline/error tag;
- main content spacing from the handoff;
- sticky four-tab bottom navigation;
- Fast, Calendar, Stats, and You routes/state without server round trips;
- scroll content that is never hidden behind the sticky tab bar.

The root must remain usable during local database initialization. Render an intentional loading shell instead of hydration mismatch or blank content.

### 3. Primitives

Implement focused components/classes:

- `Blueprint`
- primary, secondary, ghost, and icon buttons
- outline/accent/status tags
- segmented control
- form field/input
- bottom sheet/dialog
- stat/info cell
- confirmation dialog
- toast/undo toast
- inline error/status notice
- visually hidden utility

Blueprint marks may use four decorative elements or pseudo-elements. Mark them `aria-hidden` and ensure they never intercept pointer events.

### 4. Bottom sheets

The shared sheet must:

- render through an appropriate portal;
- use semantic `dialog` labeling;
- trap focus;
- restore focus to its trigger;
- close on backdrop and Escape unless a destructive operation is actively committing;
- avoid closing when clicking inside;
- honor safe-area bottom inset;
- prevent background scrolling without jumping the page;
- support reduced motion.

Do not depend on a large component framework. A small focus-management dependency is acceptable only if native/in-house behavior cannot be made reliable.

### 5. Navigation and accessibility

- Navigation buttons expose selected state.
- Icons are Lucide-compatible inline SVGs at the documented sizes/stroke widths.
- Every icon-only button has an accessible name.
- Visible focus uses the 2px accent outline and 2px offset.
- Touch targets are at least 44px where possible.
- Muted colors must still meet relevant contrast requirements; adjust only the minimum required and document deviations from prototype tokens.

### 6. Responsive behavior

- Primary target is portrait phone.
- Desktop/tablet shows the same centered 440px shell, not a stretched dashboard.
- Sheets max at 420px with 12px side inset.
- Support text scaling without horizontal clipping.
- Avoid fixed viewport-height assumptions that break iOS browser chrome.

## Test plan

Minimal component behavior tests:

1. Selecting a tab updates selected state and visible panel.
2. Opening a sheet moves focus inside; closing restores trigger focus.
3. Escape closes a non-blocked sheet.
4. Undo toast invokes its callback once and expires under fake timers.
5. Explicit dark preference overrides system preference.

Do not snapshot large DOM trees or test CSS implementation details.

## File plan

```text
app/globals.css
app/layout.tsx
app/page.tsx
components/shell/AppShell.tsx
components/shell/Header.tsx
components/shell/TabBar.tsx
components/ui/Blueprint.tsx
components/ui/Button.tsx
components/ui/Tag.tsx
components/ui/SegmentedControl.tsx
components/ui/Sheet.tsx
components/ui/Field.tsx
components/ui/Toast.tsx
components/ui/*.module.css (if useful)
```

Prefer semantic shared classes in global/component CSS over inline style objects.

## Acceptance criteria

- Shell visually matches the handoff at 390–440px widths.
- All shared primitives have focus, disabled, pressed, and error states.
- Safe-area and sticky navigation do not obscure content.
- Theme supports System/Light/Dark without initial flashing.
- Sheet focus and keyboard behavior pass tests.
- No Tailwind classes or generic UI framework is introduced.

## Out of scope

Feature data, D1/IndexedDB, charts, PWA install prompt, and service worker.

## Completion note

Completed the Industry tokens, flash-free System/Light/Dark theming, responsive 440px shell, accessible tab state, loading/error/offline shell states, inline Lucide-compatible navigation icons, and the shared blueprint, button, tag, segmented control, field, sheet, confirmation, info-cell, toast, and status-notice primitives. Sheet behavior uses a portal, semantic labeling, focus containment/restoration, Escape/backdrop handling, committing protection, scroll locking, safe-area spacing, and reduced motion. No prototype color-token deviations were required; self-hosting the currently referenced Barlow fonts remains part of FAS-012.

Validation completed on October 30, 2026: `npm test` passed 10 files/30 tests; `npm run typecheck`, `npm run build`, and `git diff --check -- .` passed. Focused component coverage verifies tab selection/panel changes, sheet focus restoration and Escape/committing behavior, one-shot Undo with expiry, and explicit/system theme resolution. Chrome 156 comparisons used matching 390×844 viewports for the handoff and implementation in light mode, plus implementation checks at 390×844 dark and 440×900 dark; the 390px and 440px shells reported no horizontal overflow. The light 390×844 sheet was also checked open with focused input, backdrop, 12px side inset, and safe bottom spacing. Fast, Calendar, Stats, and You tab changes were exercised; light/dark Fast, empty shell, and open-sheet states were inspected.