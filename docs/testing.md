# Testing

Weft has two test layers:

1. **Package tests** — unit and integration coverage for the document model, I/O, commands, sessions, bridge, CLI, MCP, extraction and export.
2. **Browser E2E** — Playwright/Chromium tests against a real live bridge and the built editor.

`pnpm verify` runs the package tests, six workflow-rule tests, typechecks (including E2E TypeScript), CLI validation and canonical formatting. It does not launch a browser.

## Run browser E2E

Install Chromium once:

```bash
pnpm test:e2e:install
```

Then:

```bash
pnpm test:e2e
```

`test:e2e` builds the app and packages, typechecks the E2E sources, starts a bridge over a temporary copy of `examples/starter.weft`, and runs the tests in `e2e/`. The fixture is cleaned up when the bridge stops; the committed example is never edited.

For a UI-only iteration where the build is already current:

```bash
pnpm exec playwright test
```

Useful options:

```bash
pnpm exec playwright test e2e/canvas.spec.ts
pnpm exec playwright test --headed
pnpm exec playwright show-report
```

On failure, Playwright writes a screenshot, trace and error context under `test-results/`, plus an HTML report under `playwright-report/`. Neither is committed.

## Coverage

- Canvas defaults: dotted Canvas view, no page background, frame labels.
- Selection: frame labels, inspector selection, page-scope hover, scope entry and Escape.
- Navigation: Space-drag panning and cursor-anchored zoom.
- Editing: inverse-backed inspector edits, undo, empty-page placeholder, page creation/deletion.
- Canvas/Page modes and browser-local persistence.
- Live panel runtime endpoints.

## CI

The `e2e` CI job installs Chromium, runs `pnpm test:e2e`, and uploads `playwright-report/`/`test-results/` on failure. The job is independent of `verify` so package tests and browser tests can run in parallel. Both are required on protected `main`.

## Writing a test

- Prefer accessible names and stable editor classes (`.frame-label`, `.canvas-mode-switch`, `.live-panel`) over positional selectors.
- Keep each test independent in intent; the shared fixture is temporary and editing tests must clean up or undo their own changes.
- Do not test animations or exact pixel screenshots; assert behavior, geometry relationships and persisted state.
- Add a regression case when fixing a user-visible canvas or live-panel bug.
- Never point E2E at a developer's real design or project root.
