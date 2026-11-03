# FAS-001 — Project foundation and test harness

**Status:** Closed

## Objective

Turn the current create-vinext scaffold into a stable application foundation without implementing product features. Establish strict TypeScript, predictable commands, Cloudflare-local development, Vitest, test utilities, source layout, and shared quality gates.

## Context and constraints

- Keep Vinext, Vite, `@cloudflare/vite-plugin`, and the existing Worker entrypoint.
- Use npm; `packageManager` already declares npm.
- Production will use one `workers.dev` environment and North American D1, but this ticket configures only safe local bindings and placeholders.
- Tests are deliberately minimal. Do not add Playwright.
- Plain CSS will be used later. Tailwind packages may be removed if the scaffold does not require them.

## Deliverables

### 1. Scripts and dependencies

Add scripts with unambiguous responsibilities:

```json
{
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "deploy": "vinext-cloudflare deploy",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "check": "npm run typecheck && npm test && npm run build",
  "cf-typegen": "cf workers types"
}
```

Add only the test/runtime dependencies needed by approved tickets:

- `vitest`
- `jsdom` only if component tests require it
- `@testing-library/react`, `@testing-library/user-event`, and `@testing-library/jest-dom` only when the first component behavior test is added
- `fake-indexeddb` in FAS-005, not speculatively here unless a shared setup requires it
- `dexie` in FAS-005

Remove unused Tailwind dependencies/config only after proving Vinext does not rely on them.

### 2. TypeScript policy

Configure strict TypeScript, including:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true` where third-party types permit it
- aliases such as `@/*` mapped to the repository root or `src` layout
- DOM and WebWorker types isolated so service-worker globals do not pollute application modules

Do not use `any` to bypass Worker binding or browser-platform types. Generate or define narrow binding interfaces.

### 3. Source layout

Create empty directories only when the first real module is added, but reserve this structure:

```text
app/
components/
lib/domain/
lib/validation/
lib/local-db/
lib/sync/
lib/api/
lib/server/
lib/notifications/
migrations/
workers/
test/
```

Keep server-only modules out of client import graphs using naming and import boundaries (`*.server.ts` or `lib/server`).

### 4. Environment and bindings

Define typed configuration for:

- `DB` D1 binding
- `ASSETS` and current Vinext bindings
- app version/build identifier
- placeholders for token digest pepper and VAPID values, without real secrets

Provide `.dev.vars.example`; do not commit `.dev.vars`. Update `.gitignore` for local Cloudflare state and generated files while preserving checked-in SQL migrations.

Use separate local D1 state. Nothing in `dev` or tests may reference a production database ID.

### 5. Vitest setup

Configure:

- Node environment by default for domain/server tests
- per-file jsdom opt-in for React component tests
- deterministic fake timers support
- a single setup file for custom matchers when UI tests are introduced
- coverage disabled by default; no percentage gate

Add one small smoke test proving aliases and the runner work. Do not test framework internals.

### 6. Baseline cleanup

Replace scaffold README content with project commands and links to:

- parent specification
- ticket index
- design handoff

Ensure the placeholder app still renders and the production build succeeds before feature tickets begin.

## TDD sequence

1. Add a smoke test importing a trivial typed helper; confirm Vitest initially cannot run.
2. Install/configure Vitest and make only that test pass.
3. Enable strict options and fix resulting scaffold errors without changing behavior.
4. Add type-safe binding declarations and prove `typecheck` passes.
5. Run the full baseline quality gate.

## Acceptance criteria

- `npm run typecheck`, `npm test`, and `npm run build` pass.
- `npm run dev` starts the Vinext application with local Cloudflare bindings.
- Test files can opt into Node or jsdom environments.
- No production secret/database identifier is committed.
- There is no OpenNext/official Next migration.
- The README points implementers to the spec and ticket directory.
- Dependency additions are limited to foundation needs.

## Out of scope

D1 tables, Dexie, secret creation, sync, PWA caching, visual redesign, and feature UI.

## Completion note

Completed the Vinext foundation with strict TypeScript plus unchecked-index protection, Vitest, stable npm quality scripts, generated Cloudflare binding types, local environment templates, repository guidance, and a project smoke test. `exactOptionalPropertyTypes` was intentionally not enabled because the current Vinext image-optimizer return type is incompatible with it.

Validation performed:

- `npm run cf-typegen` — passed
- `npm run check` — typecheck, one Vitest happy-path test, and production build passed
- `git diff --check` — passed
- Chrome at 1728×937 — the scaffold root rendered successfully and exposed the expected navigation/API link

Known upstream/tooling notes:

- Vinext/Vite production builds emit non-fatal sourcemap and ineffective-dynamic-import warnings.
- `npm audit` reports five moderate transitive `fflate` findings through Vinext's image stack; the offered forced fix would downgrade/break Vinext, so it was not applied.