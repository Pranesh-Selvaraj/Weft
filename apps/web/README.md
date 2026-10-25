# @weft/web

The Weft browser app. This slice is a **read-only design preview**: it loads a `.weft` directory through a Vite virtual module and renders the page with `@weft/render`.

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

`vite.config.ts` provides `virtual:weft-design`:

- it calls `readDesign` from `@weft/design-io` at dev/build time;
- it embeds `{ manifest, pages }` into the bundle;
- it watches the design directory and triggers a full reload on change.

This is a development shortcut, not the production file path. The local bridge will serve a chosen directory and stream live session updates; the renderer stays the same.

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
