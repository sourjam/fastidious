# AGENTS.md

## Purpose

Fastidious is a toy app. Keep it pleasant to read, easy to change, and simple enough for one human to understand.

The goal is not to demonstrate every pattern or abstraction. The goal is a small, reliable fasting tracker that runs as a Vinext PWA on Cloudflare.

## How we work together

- Use plain language.
- Be concise and direct.
- Ask one question at a time.
- Explain why a decision matters before presenting options.
- Prefer two or three concrete choices over an open-ended architecture discussion.
- State a recommendation when asking a question.
- Record agreed decisions in the relevant specification or ticket.
- Do not silently expand scope.
- If something is ambiguous and materially affects behavior, stop and ask.
- If it does not materially affect behavior, choose the simplest reasonable option and document it.
- When a ticket is finished, update its Markdown file to `**Status:** Closed` and record a short completion note with the validation performed.

## Commits

- Commit whenever a significant, coherent chunk of work is complete and validated.
- Do not mix unrelated tickets or cleanup into the same commit.
- Use a detailed commit message that explains the user-visible outcome, important technical choices, migrations/configuration changes, and tests or manual checks performed.
- Prefer an imperative subject line, followed by a concise body when the subject cannot capture the important context.
- Before committing, inspect the diff and ensure no secrets, generated junk, unrelated files, or debugging output are included.
- Never claim a ticket is closed merely because code was written; validate its acceptance criteria first.
- When closing a ticket, include its ID in the commit message when practical.

Example:

```text
feat(sync): complete FAS-007 offline mutation reconciliation

- add idempotent mutation receipts and cursor-based delta pulls
- apply server changes and acknowledgements in one Dexie transaction
- reset obsolete mutations after a data-generation change
- cover retry, last-arrival-wins, and offline reconnection happy paths
```

## Keep the code human-simple

- Prefer boring, explicit code over clever code.
- Prefer small functions with clear names.
- Keep domain logic separate from UI, storage, and network code.
- Avoid deep inheritance, generic frameworks, service locators, and speculative abstractions.
- Do not add a dependency when a short, readable implementation is safer.
- Do use a focused dependency when the platform API is genuinely difficult or error-prone; Dexie for IndexedDB is an approved example.
- Avoid files that mix rendering, persistence, validation, and synchronization.
- Avoid tiny files that hide one simple flow across many layers.
- Use comments for important reasons and constraints, not to narrate obvious code.
- Use names from the product: fast, goal, weight, log, device, mutation, reminder.
- Make invalid states hard to represent, but do not build an elaborate type system.
- Prefer explicit JSON APIs and raw, prepared D1 SQL.
- Keep Cloudflare-specific code at the edges.
- Keep framework-independent calculations in `lib/domain`.

## Approved technical direction

- Vinext, Vite, React, and TypeScript
- Cloudflare Workers and D1
- Dexie and IndexedDB for offline local data
- Explicit JSON APIs for synchronization
- Plain CSS with the Industry design tokens
- Web Push through a scheduled Cloudflare Worker
- Vitest for minimal unit and integration tests

Do not introduce without explicit approval:

- official Next.js/OpenNext migration
- Tailwind UI implementation
- an ORM
- Redux or another global state framework
- GraphQL
- conventional user accounts
- end-to-end encryption
- Sentry, product analytics, or session replay
- Playwright or a large end-to-end suite
- microservices beyond the app Worker and the small scheduled Worker

## Testing: minimal happy paths

Tests should protect the few behaviors that would be expensive or dangerous to break. They should not attempt to prove every implementation detail.

### Required approach

1. Describe one observable behavior.
2. Write the narrowest failing test that proves it.
3. Add the minimum implementation to pass.
4. Run that test.
5. Refactor only when the test is green.

### Prefer

- unit tests for domain calculations and validation;
- small integration tests for D1 repositories, sync idempotency, and IndexedDB transactions;
- focused component tests only for important interaction behavior such as sheet focus or Undo;
- deterministic time, timezone, and locale fixtures.

### Avoid

- broad snapshot tests;
- testing framework internals;
- one test per getter, CSS class, or trivial wrapper;
- heavy mocking of our own modules;
- large fixture factories that are harder to understand than the behavior;
- chasing coverage percentages;
- an initial Playwright suite.

### Minimum happy-path coverage

The project specification requires focused coverage for:

- duration, overlap, stage, calendar, and streak calculations;
- local write plus queued mutation in one IndexedDB transaction;
- successful and idempotent sync;
- one offline change syncing after reconnection;
- old-secret rejection after rotation;
- reminder times changing when a goal changes;
- export excluding the secret;
- import replacement changing the data generation.

Add a regression test when fixing a real bug. Do not add speculative tests merely to increase the test count.

## UI and product simplicity

- Match the supplied design handoff closely.
- Use the Chrome browser harness to inspect and validate visual work against `specs/design_handoff_fastidious/Fastidious.dc.html`.
- For significant UI work, open both the implementation and mockup in Chrome at matching viewport sizes and compare the rendered result—not just the DOM or CSS values.
- Check the relevant light/dark, active/idle, empty/populated, sheet, and mobile viewport states before closing a visual ticket.
- Use browser snapshots for structure and interaction, and screenshots specifically for visual fidelity checks.
- Record the viewports and states checked in the ticket completion note.
- Keep the single 440px application column.
- Keep routine synchronization invisible.
- Show clear errors only when the user needs to act.
- Preserve offline writes before reporting success.
- Make destructive actions explicit or easily reversible.
- Use accessible HTML before custom behavior.
- Keep sheets, forms, and navigation keyboard accessible.
- Respect reduced motion and mobile safe areas.

## Security and privacy basics

- Treat the secret URL as a password.
- Never log secrets, authorization headers, fasting records, weights, or import/export payloads.
- Validate all network and imported input at runtime.
- Store only a digest of the secret in D1.
- Use prepared D1 statements.
- Keep authenticated API responses out of the service-worker cache.
- Do not weaken offline behavior or secret rotation for convenience.

## Documentation

Primary documents:

- `specs/fastidious-next-pwa-spec.md` — product and architecture source of truth
- `specs/fastidious-next-pwa-tickets/README.md` — implementation order
- `specs/design_handoff_fastidious/` — visual and interaction reference

When implementation changes an agreed contract, update the relevant document in the same change. Keep documentation concrete and readable by a human who did not participate in the original conversation.

## Before finishing a change

Run the narrowest relevant checks, then the broader checks justified by the change:

```bash
npm test -- <relevant test>
npm run typecheck
npm run build
git diff --check
```

For UI work, also use Chrome to compare the implementation with the mockup at matching viewports and exercise the changed interactions.

Report:

- what changed;
- which behavior was tested;
- which commands passed;
- which Chrome viewports and UI states were visually checked;
- any remaining risk or manual check.

For a completed ticket:

1. Verify every acceptance criterion.
2. Set the ticket file to `**Status:** Closed`.
3. Add a brief completion note with changed areas and validation evidence.
4. Review the final diff.
5. Create a focused commit with a detailed message.

Do not claim a check passed unless it was actually run. Do not close a ticket or commit known-incomplete work as complete.
