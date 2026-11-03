# Handoff: Fastidious — fasting tracker PWA

## Overview
Fastidious is a free, offline-first mobile web app (PWA) for tracking intermittent and extended fasts. There's no login: a UUID in the URL (`?u=<uuid>`) identifies the user's log. Features:
- Live fast timer
- Preset and custom fast lengths
- Editable start and end times
- Approximate fasting stages
- Day view: a 24h clock showing that day's fasts
- Month and year calendars shaded by hours fasted
- Streaks and stats
- Weight log
- JSON export/import
- Light and dark themes

## About the Design Files
The files here are **design references built in HTML**. They're a working prototype of the intended look and behavior, not production code. Recreate them in the target stack. If no stack exists yet, a small Vite + React (or Preact/Svelte) PWA with a service worker plugin is a good fit. `Fastidious.dc.html` runs in a browser alongside `support.js` (the prototype runtime), `styles.css`, `manifest.webmanifest` and `sw.js`. Serve the folder over HTTP to try it.

## Fidelity
**High-fidelity.** Colors, type, spacing and interactions are final. Match them using the tokens in `styles.css` (the "Industry" design system).

## Design language (Industry)
- Light technical ground; a single steel-blue accent; Barlow Condensed headings over Barlow body text.
- Cards, cells and the primary button are "blueprint" objects. They have square corners (radius 0), a 1px hairline border (`--color-divider`) and **"+" registration marks** at all four corners (`.blueprint` + four `<i class="corner tl|tr|bl|br">`). Each mark is 11×11px, offset −6px, drawn in text at 55% opacity.
- Cards have no fill. The primary button is the only solid object: an accent fill with bg-colored text.
- Icons are Lucide at stroke-width 1.5, 22px in the tab bar and 18px in buttons.
- Focus style: 2px accent outline with a 2px offset. Hover/pressed states use the accent ramp (600/700).

## Layout shell
- Single column, `max-width: 440px`, centered, `min-height: 100vh`.
- Header: padding `16px + safe-area-top` on top and 20px on the sides. The left side has the wordmark "FASTIDIOUS" (Barlow Condensed 600, 22px, letter-spacing .06em, uppercase) and an "Offline" outline tag when `navigator.onLine` is false. The right side has today's date (13px, text at 65%).
- Main: padding `18px 20px 28px`, with a 24px vertical gap between blocks.
- Bottom tab bar: sticky to the bottom, four equal columns, 60px tall, a 1px top divider, bg-colored, with safe-area bottom padding. The tabs are Fast (timer icon), Calendar (calendar), Stats (bar-chart-3) and You (user). Labels are 12px. The active tab is `--color-accent-700`; inactive tabs are text at 65%.

## Screens

### 1. Fast (timer)
- **Kicker row:** on the left, 12px uppercase text (.1em tracking) in accent-700: "FASTING · STARTED 8:14 PM" or "NOT FASTING". On the right, a secondary button "16:8 goal" (32px tall) that opens the Fast length sheet.
- **Clock:** `HH:MM:SS` elapsed in Barlow Condensed 600, 80px, line-height 1, tabular numbers.
- **Sub-line** (16px, text at 70%) shows one of:
  - "4h 12m to goal"
  - "Goal reached · +1h 02m"
  - "Eating for 6h 20m" (when idle)
- **Progress bar:** 30px tall with a 1px hairline frame.
  - The fill is solid accent, with a 0.6s width transition.
  - The scale runs from 0 to `ceil(max(goal, elapsed)/2)*2` hours.
  - Each stage threshold inside the scale gets a 1px tick in the text color that overhangs the bar by 5px.
  - The goal marker is a 2px accent-800 line that overhangs by 9px.
  - Labels sit under each tick, centered: the hour ("12h", 13px bold, accent-700 once reached) above the short stage name (11px, muted).
- **Info cells:** a 2-column grid with a 12px gap. Each cell is a blueprint with padding 12/14, an 11px uppercase key, a 20px condensed value and a 12px accent-700 hint.
  - While fasting: "Started" (tap to edit the start time) and "Goal" (the projected end time; tap to change the length).
  - While idle: "Last fast" (duration; tap to edit) and "Ended".
- **Presets** (idle only): the heading "Fast length", then a 4-column grid with an 8px gap. Each tile is 56px tall with a condensed 19px label and an 11px subtitle. The selected tile is accent-filled; the rest have a hairline border.
  - The presets are 13h Circadian, 16:8, 18:6, 20:4, OMAD 23:1, 36h, 48h and 72h.
- **Primary button:** full width, 56px tall, uppercase 19px text with .06em tracking, blueprint marks. It reads "Start 16:8 fast" or "End fast".
- **Stages card:** a blueprint with the title "Fasting stages" and the note "Approximate, varies by person". Each row has a 40px hour column and a name, separated by top dividers. The current stage gets a "Now" accent tag and its description; stages already reached use full text color.

| Hour | Stage | Short label |
| --- | --- | --- |
| 0h | Fed | Fed |
| 4h | Post-absorptive | Settle |
| 12h | Fat burning | Burn |
| 18h | Ketosis | Keto |
| 24h | Autophagy | Auto |
| 48h | Deep ketosis | Deep |
| 72h | Extended | Ext |

The description copy for each stage is in `STAGES` in the source.

### 2. Calendar
- **Mode switch:** Day / Month / Year as a 3-column segmented control. It's 38px tall with a hairline frame. The active segment is accent-filled with bg-colored text; labels are condensed uppercase 16px.
- **Navigation row:** 40px square ‹ › icon buttons, with a centered title (condensed 22px) and subtitle (13px, muted).
- **Day view:**
  - A 300px SVG clock with midnight at the top, running clockwise. The ring has radius 118 and stroke 22; the track is the divider color.
  - Fast arcs are clipped to the day. Completed fasts are drawn in accent; the live fast in accent-400.
  - There are 24 ticks outside the ring, with major ticks every 6h labeled 12a/6a/12p/6p. A "now" hand is drawn when viewing today.
  - The center shows the total fasted (condensed 40px) over "FASTED".
  - Below the clock is a list of that day's fasts. Each row shows the time range, the duration, a meta line and a "Goal met", "Short" or "Live" tag. Tapping a row opens the editor.
  - Then a "+ Log a past fast" button.
- **Month view:**
  - A Sunday-first 7-column grid with a 4px gap. Cells have aspect ratio 1/1.1 and a hairline border; today's cell gets a text-colored border.
  - Each cell shows the date (13px) and hours fasted (condensed 14px).
  - The cell fill comes from the hours of fasting that overlap that calendar day: <8 → accent-100, <14 → 200, <18 → 300, <22 → 400, ≥22 → accent-600 with bg-colored text.
  - Tapping a cell opens the Day view. The subtitle reads "18 fasts · avg 16h 40m".
- **Year view:** 12 rows, each a 28px month label followed by 31 square cells (2px gap), shaded with the same scale. Tapping a month label opens that month.
- **Legend** (Month and Year): "Hours fasted" followed by swatches.

### 3. Stats
- **Stat cells:** a 2×3 grid of blueprint cells (11px uppercase key, condensed 30px value): Current streak, Longest streak, Fasts logged, Average, Longest fast, Total hours.
  - Streak: count consecutive days on which a fast that met its goal ended. Count back from today, or from yesterday if today has none yet.
- **Last 14 fasts:** a bar chart 120px tall. Bars are scaled to the longest of (duration, goal). Bars that met their goal are accent; the rest are neutral-400. The note reads "N of 14 hit goal".
- **Weight card:**
  - The latest value (condensed 36px) and the 30-day change (accent-700).
  - A bar sparkline of the last 24 entries, 60px tall, in accent-300.
  - The last 4 entries, each with a × delete button.
  - A "+ Add" button opens the sheet. Weights are stored in kg and displayed in kg or lb.

### 4. You (settings)
- **"Your link" card:** a short explanation, the UUID in a surface-filled box, and a "Copy link" button that briefly changes to "Copied".
- **Appearance:** Light / Dark segmented control. **Weight unit:** kg / lb.
- **Data:** "Data · N fasts, M weights", then Export JSON and Import JSON in a 2-column row, then a ghost "Clear all data" button that asks for confirmation.

### Sheets (modals)
- A bottom-anchored blueprint panel with max width 420px, a 12px side inset and 16px plus the safe area at the bottom. It has a bg fill, `--shadow-lg`, padding 18px and a title in condensed 24px. The backdrop is neutral-900 at 50%.
- **Fast length:** the preset grid, plus a custom hours input (1–168, step 0.5) with a "Set" button.
- **Edit start time / Edit fast / Log a past fast:** `datetime-local` inputs, 44px tall at 16px text (which prevents iOS zoom). A live line shows "Duration 16h 20m", or an error in accent-800. The secondary action is "Discard fast" or "Delete".
- **Fast complete:** the duration in condensed 56px, plus "You hit your 16:8 goal. 8:14 PM → 12:30 PM." with "Edit times" and "Done" buttons.
- **Log weight:** a decimal input in the current unit.

## Interactions & validation
- The timer ticks every 1s. Ending a fast saves `{id, start, end, goalH}` and opens Fast complete.
- Changing the goal while fasting updates the active fast's goal.
- Time edits are rejected if:
  - the start is in the future
  - the end is ≤ the start
  - the end is in the future
  - the fast overlaps another fast (including the live one)

  The Save button does nothing while there's an error.
- The weight input must be > 0.

## State / data model
```
localStorage["fastidious:last"] = <uuid>           // last-used user
localStorage["fastidious:v1:<uuid>"] = {
  fasts:   [{ id, start: ms, end: ms, goalH }],     // sorted by start
  active:  { start: ms, goalH } | null,
  weights: [{ t: ms, kg }],
  goalH: 16, unit: "kg"|"lb", theme: "light"|"dark"|null
}
```
- **Identity:** on load, read `?u=`. If it's missing, use `fastidious:last` or generate a new `crypto.randomUUID()`, then write it back into the URL with `history.replaceState`.
- **Export:** the same object plus `{app, version, user, exported}`. **Import** replaces the current data after checking that `fasts` is an array.
- **The prototype seeds sample data on first load.** Remove this in production (the `seed()` function).
- **Cross-device sync is not built yet.** Today the data lives only on the device. To make the UUID link work on any device, add a small backend (e.g. `GET/PUT /api/log/:uuid` storing the JSON blob) and merge with local storage last-write-wins per fast `id`. Treat the UUID as a secret.

## Offline / PWA
- `manifest.webmanifest` sets standalone display, the start URL and theme colors. **App icons still need to be supplied** (192 and 512 px PNG, plus a maskable version).
- `sw.js` is network-first with a cache fallback. It pre-caches the app shell. In production, use your build tool's PWA plugin and precache the hashed assets and fonts.

## Design tokens (from `styles.css`)

**Light theme**
- Base colors: bg `#f2f2f3`, surface `#e9e9ea`, text `#1d1f20`, accent `#5980a6`, divider = text at 16%.
- Accent ramp: 100 `#eef6ff`, 200 `#d6ebff`, 300 `#b5d9fd`, 400 `#94bce3`, 500 `#749dc4`, 600 `#597ea3`, 700 `#416180`, 800 `#2c455d`, 900 `#1d2d3d`.
- Neutral ramp: 100 `#f5f5f8` … 400 `#b7b7ba` … 900 `#2b2b2d`.

**Dark theme** (scoped with `[data-theme="dark"]`)
- Base colors: bg `#15191d`, surface `#1d2227`, text `#e6e8ea`, accent `#749dc4`, divider = text at 18%.
- The accent and neutral ramps are inverted, so step 100 is the darkest tint and the "light steps = subtle" rule still holds.

**Type**
- Fonts: Barlow Condensed 600 for headings and numerals; Barlow 400/500/700 for body text.
- Sizes used: 80, 56, 40, 36, 30, 24, 22, 20, 19, 16, 15, 14, 13, 12, 11px.

**Spacing, radius, shadow**
- Spacing tokens: 3.4, 6.8, 10.2, 13.6, 20.4, 27.2px. Layout gaps used: 4, 8, 10, 12, 14, 18, 24px.
- Radius: 0 on all framed objects.
- Shadow: `--shadow-lg` on sheets only.

## Assets
There are no images. Icons are inline Lucide SVGs (timer, calendar, bar-chart-3, user, chevron-left, chevron-right). Fonts load from Google Fonts via `styles.css`.

## Files
- `Fastidious.dc.html`: the full prototype (template + logic class)
- `support.js`: the prototype runtime (only needed to run the reference)
- `styles.css`: Industry design tokens and component classes
- `manifest.webmanifest`, `sw.js`: PWA scaffolding
