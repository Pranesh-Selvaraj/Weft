# @weft/render

Read-only DOM renderer for Weft pages. It turns the canonical schema into real browser DOM: absolute frame geometry, CSS flex layout, real text, token colors and sandboxed snapshot iframes.

## What it supports

- `frame`, `group`, `text`, `rect`, `ellipse`, `image` and `snapshot` nodes.
- Absolute positioning per node, with optional flex layout mapped to CSS (`direction`, `gap`, `padding`, `align`, `justify`, `wrap`).
- Solid, linear-gradient and image paints; strokes, radius, opacity, shadows and blur.
- Text fonts, weights, line heights, letter spacing, alignment, decoration, transform and token colors.
- Token resolution for colors and font families.
- Page background (or an opt-out for callers that paint it separately) and computed page bounds.
- Sandboxed snapshot iframes with a restrictive CSP when a payload is supplied; placeholders otherwise. Captured scripts, forms, frames and external fetches are blocked, and images must be `data:` URLs.
- Asset URL resolver for images.

## Example

```tsx
import { PageView, getPageBounds } from "@weft/render";

const bounds = getPageBounds(page);

<PageView
  page={page}
  manifest={manifest}
  width={bounds.width}
  height={bounds.height}
  assetUrl={(assetId) => `/assets/${assetId}`}
  snapshotPayloads={{
    "nd_…": { html: "<main>…</main>", css: "main { … }" },
  }}
/>;
```

`PageView` renders the page at its canonical size. Scaling and the editor stage belong to the app; `apps/web` fits the page to the viewport. Pass `showBackground={false}` when the caller paints the page background as its own workspace backdrop, as the editor does; export and static rendering keep the default background.

## Deliberate limits

- Read-only: no selection, hit testing, editing or dragging.
- No custom layout engine; the browser is the layout engine.
- Assets and snapshot payloads are not loaded by the renderer. The caller resolves assets and supplies payloads; `apps/web` loads them from the Vite virtual design or the live bridge.
- Snapshot iframes are sandboxed without scripts and use a data-only CSP. A payload with scripts or external URLs will not execute or fetch.
- Fonts fall back to system fonts unless the design's families are available.
- App CSS lives in the same document as design content. Design nodes use inline styles and `box-sizing: border-box`; stronger isolation (shadow DOM) is a later editor concern.
- Performance at thousands of nodes and many iframes is not yet measured; culling and lazy iframes are future work.

## Test

```bash
pnpm --filter @weft/render test
```

The suite covers token colors, paints, flex mapping, radius/padding, page bounds, sandboxed snapshot CSP markup, and a server-rendered frame/text page.
