# 0013 · Snapshot extraction

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Capture / security

## Context

Weft's second product loop is **extract the real product**: a designer or agent captures a running page so the design file contains a readable record of what was built. A screenshot would preserve pixels but not structure, text, computed styles or assets, and an agent cannot reliably edit it. Raw copied markup would execute scripts when opened and would fetch external resources.

The capture path also touches several sensitive boundaries at once: a local app server, a real browser, untrusted page content, a design file that is committed to git, and agents that read the result. The capture must be useful enough to inspect, but the editor must never execute captured code.

## Decision

`weft extract` uses an explicit project allowlist and a headless Chromium instance to capture one page, then inserts a `snapshot` node into a design:

```bash
weft extract designs/app.weft http://127.0.0.1:3000/landing \
  --project . --selector main --viewport 1440x900 --name "Landing"
```

The project's `weft.project.json` must declare the origin:

```json
{
  "version": 1,
  "extract": {
    "origins": ["http://127.0.0.1:3000"]
  }
}
```

The implementation follows these rules:

- **Allowlist before capture.** The URL must be loopback HTTP(S), credential-free, and its exact origin must appear in `extract.origins`. A non-allowlisted origin is refused before a browser is launched.
- **Explicit browser runtime.** `@weft/extract` uses `playwright-core` and discovers a Chromium binary from `WEFT_CHROMIUM`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, the Playwright cache, or common system paths. A path can also be passed with `--browser`. `playwright-core` does not download a browser.
- **Network isolation during capture.** Every HTTP request is routed; only allowlisted origins, `data:`, `blob:` and non-network schemes proceed. WebSockets to non-allowlisted origins are closed. Service workers are blocked, dialogs dismissed and popups closed. The capture browser is a fresh context with no saved profile.
- **Computed layout, not copied CSS.** The selected element is walked in the live DOM, its computed styles and readable markup are collected, and CSS is emitted as selectors keyed by `data-weft-k` indices. The result is stable, scoped and easy for a reader to inspect. Root margins/offsets are normalized so the snapshot frame starts at its own origin.
- **Assets are inlined.** Same-origin images and CSS `url()` assets are fetched in the capture page and converted to `data:image/...` URLs under a per-asset and total budget. Failed, oversized or cross-origin assets are omitted with a warning. There are no external fetches in the written payload.
- **Sanitize, then verify.** The browser pass removes scripts, styles, frames, objects, embeds, forms, event handlers, navigation attributes and SVG animation elements. A dependency-free Node pass then fails closed if any executable tag, event attribute, non-data URL attribute, stylesheet import, expression or non-data `url()` survives. It does not try to repair markup with regexes; a sanitizer regression aborts the capture instead of writing a partially cleaned file.
- **Files stay beside the page.** HTML and CSS are written atomically to `snapshots/<node-id>.html` and `.css`; the page stores design-relative paths. The node carries the source URL, selector, size and capture timestamp. The page write is last, and a failed page write removes the newly written payload.
- **The editor never executes captured content.** `@weft/render` places snapshots in `sandbox=""` iframes with a CSP that allows only inline styles and `data:` images, and no scripts, forms, frames or network connections. The captured page is untrusted data, not executable code.

The snapshot HTML/CSS is deliberately readable text. An agent can inspect the captured structure, text, styles and source metadata without a browser, a screenshot or a proprietary format.

## Prompt injection

Captured text can contain instructions aimed at an agent. Weft removes executable surfaces, but **cannot remove meaning**. The design file records where the content came from, and agents must treat captured text as untrusted product data, never as instructions. This is documented in the extraction guide and belongs in the agent tool contract as well; a future extractor should attach a machine-readable trust marker to snapshot nodes.

## Consequences

- Extraction needs a local Chromium/Chrome installation. CI runs the allowlist, sanitizer and file-insertion tests without a browser; the browser integration test is opt-in with `WEFT_BROWSER_TESTS=1`.
- Captured pages that require authentication, a personal browser profile, cookies or a non-loopback production URL cannot be captured in this slice. Attach mode and a future authenticated capture flow must be explicit.
- Fonts are not inlined; computed font families fall back to locally available fonts. External fonts and assets are intentionally blocked, which lowers fidelity against the live site.
- CSS pseudo-elements, shadows, gradients, flex and grid are captured through computed styles; canvas, video, iframes and heavy visual effects are omitted or simplified. This is a readable snapshot, not a pixel-identical renderer.
- The capture browser executes the allowlisted app's scripts. The allowlist is therefore an approval boundary, not a sandbox for the app itself.
- A committed snapshot can be large when images are inlined. The current caps are 2 MiB per asset, 8 MiB total assets, and 4 MiB per HTML or CSS payload; larger payloads fail or skip assets with warnings.
- The extractor does not yet record a git commit, use the project dev-server manager automatically, or expose a bridge/UI Extract button. Those are follow-ups for the agent and server-control slices.

## Alternatives considered

- **Screenshots.** Rejected: pixels are not readable or editable, and an agent cannot build from them.
- **`outerHTML` only.** Rejected: it loses computed styles, resolves neither layout nor CSS variables, and would ship scripts and external URLs.
- **A server-side HTML parser without a browser.** Rejected: it cannot resolve flex/grid layout, computed colors or current image sources.
- **Capture in the user's normal browser.** Rejected for this slice: extensions and personal profiles widen the boundary and make reproducibility poor.
- **A remote capture service.** Rejected: it contradicts local-first and moves untrusted page content off the machine.
- **Store the snapshot only in the bridge.** Rejected: the design file is the durable artifact and must remain readable without Weft running.

## Follow-ups

- Add a bridge/UI Extract action that reuses the project server and capture allowlist.
- Record source commit and a trust marker in snapshot metadata.
- Add allowlisted font capture and a deterministic asset manifest for larger pages.
- Add a capture report to `weft inspect` and a test that verifies the written payload contains no network-capable URLs.
