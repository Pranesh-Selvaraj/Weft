# @weft/extract

Allowlisted browser capture of a running page into a readable, sanitized snapshot frame. This package owns the Playwright capture, asset inlining, final sanitizer and snapshot-node insertion; the CLI exposes it.

## Usage

```ts
import { extractSnapshot } from "@weft/extract";

const result = await extractSnapshot({
  projectRoot: "/abs/project",
  designDir: "/abs/project/designs/app.weft",
  url: "http://127.0.0.1:3000/landing",
  selector: "main",
  viewport: { width: 1440, height: 900 },
  name: "Landing",
  // browserPath: "/path/to/chrome",
});
```

The project must declare the origin in `weft.project.json`:

```json
{ "version": 1, "extract": { "origins": ["http://127.0.0.1:3000"] } }
```

`extractSnapshot` reads the project config, verifies the origin, captures the page, sanitizes the markup/CSS, writes `snapshots/<node-id>.html` and `.css`, and then writes the page with a new snapshot node. A failed page write removes the newly written payload.

## Browser runtime

`playwright-core` does not bundle a browser. Discovery order is `WEFT_CHROMIUM`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, the Playwright cache, then common system Chrome/Chromium paths. Use `browserPath`/`--browser` explicitly when needed. `WEFT_CHROMIUM_NO_SANDBOX=1` adds `--no-sandbox` for constrained containers; it reduces browser isolation.

## Capture rules

- URL must be loopback HTTP(S) and its origin must be in `extract.origins`; checked before launching a browser.
- HTTP requests during capture are routed to allowlisted origins only; external WebSockets are closed.
- Service workers, dialogs and popups are blocked or closed; a fresh browser context is used.
- Scripts, styles, frames, forms, event handlers, SVG animations and external URLs are removed from the result.
- Images and CSS `url()` assets are inlined as `data:image/...` under per-asset and total budgets.
- A dependency-free Node verifier fails closed if executable markup or a non-data URL survives the browser pass.
- The renderer places snapshots in `sandbox=""` iframes with a restrictive CSP.

See [`docs/extraction.md`](../../docs/extraction.md) and ADR 0013 for the complete policy and limits.

## API

- `assertAllowedUrl(url, origins)` — origin validation, returns normalized URL.
- `normalizeOrigin(value)` — loopback origin parser.
- `captureWithPlaywright(request)` — browser capture returning `{ html, css, source, warnings }`.
- `extractSnapshot(options)` — end-to-end insertion into a design; accepts a `capture` seam for tests.
- `sanitizeCapturedMarkup`, `sanitizeCapturedCss` — final defence passes.

## Test

```bash
pnpm --filter @weft/extract test
# Browser integration:
WEFT_BROWSER_TESTS=1 WEFT_CHROMIUM_NO_SANDBOX=1 pnpm --filter @weft/extract test
```

The default suite covers allowlisting, sanitizers, fake-capture insertion, file writing and page selection without requiring a browser. The opt-in browser test captures a real loopback fixture and asserts that scripts and external URLs do not survive.
