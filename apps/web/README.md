# @weft/web

The Weft browser app. This slice is a **read-only design preview**: it loads a `.weft` directory through a Vite virtual module and renders the page with `@weft/render`. When served by `weft dev`, it switches to a live view fed by the local bridge.

## Run

From the repository root:

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5240`. The default design is `examples/starter.weft`.

Load a different design:

```bash
WEFT_DESIGN=/absolute/path/to/design.weft pnpm dev
```

Build a static preview with the selected design embedded:

```bash
pnpm --filter @weft/web build
```

## How the design gets in

There are two paths:

- **Static preview.** `vite.config.ts` provides `virtual:weft-design`, which calls `readDesign` at dev/build time and embeds `{ manifest, pages }`.
- **Live preview.** Served by `weft dev`, the app fetches `/api/design`, builds a `PageSession` from each page's Yjs update, connects to `/api/live`, and applies live updates. The top bar shows `live`, `connecting` or `offline` instead of `read only`.

The static path remains the zero-process preview and the fallback.

## What you see

- The design name, page tabs, node count and zoom in the top bar.
- A dot-grid canvas and a fit-to-view page stage.
- Real DOM frames, flex layout, text, tokens, fills, strokes, shadows and radii.
- Placeholders for images and snapshots until the bridge/import pipeline supplies assets and payloads.

## Not here yet

- Editing, selection, inspector, chat, drag/drop.
- File watcher or HTTP/WebSocket bridge.
- Asset serving, snapshot payload loading, zoom controls.
- Shadow-DOM isolation and large-document culling.

See ADR 0008 for the stack and renderer decision.
