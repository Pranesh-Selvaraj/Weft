# @weft/web

The Weft browser app. The static build is a **read-only preview**. Served by `weft dev`, it is a **live editor**: click a layer, edit it in the inspector, and undo or redo while the bridge writes the page file and streams updates.

## Run

Static preview:

```bash
pnpm install
pnpm dev
# http://127.0.0.1:5240
```

Live editor:

```bash
pnpm build
pnpm weft dev examples/starter.weft
# http://127.0.0.1:5250
```

Load a different design into the static preview with `WEFT_DESIGN=/absolute/path/to/design.weft pnpm dev`. Build a static preview with `pnpm --filter @weft/web build`.

## How the design gets in

There are two paths:

- **Static preview.** `vite.config.ts` provides `virtual:weft-design`, which calls `readDesign` at dev/build time and embeds `{ manifest, pages }`.
- **Live preview.** Served by `weft dev`, the app fetches `/api/design`, builds a `PageSession` from each page's Yjs update, connects to `/api/live`, and applies live updates. The top bar shows `live`, `connecting` or `offline` instead of `read only`.

The static path remains the zero-process preview and the fallback.

## What you can do

- Click a layer to select it; the selection box follows the rendered DOM.
- Edit name, position, size, opacity, fill and text content in the inspector. Changes commit on blur/Enter.
- Delete a layer, undo with Cmd/Ctrl+Z, redo with Cmd/Ctrl+Shift+Z.
- See live file changes from the CLI or an agent, and the last editor's attribution.
- Switch pages; the inspector stays in sync with the active page.
- Toggle the UI between light and dark from the toolbar. The choice follows the system preference by default and persists locally; design content keeps its own colors.
- When served by `weft workspace dev`, use the design selector in the top bar to switch between projects and designs registered in the workspace, and the Server panel to start, attach to and stop a project's declared dev server.
- Snapshot nodes render their sanitized HTML/CSS in a sandboxed, CSP-restricted iframe. Run `weft extract` to create one; the bridge and static preview both load the payload files.

The static preview is read-only and has no bridge, inspector edits or history.

## Not here yet

- Layer tree, drag/resize, multi-select, components.
- A browser Extract button; extraction currently starts from the CLI.
- Presence/cursors, chat, page-level commands.
- Asset serving, snapshot payload loading, zoom controls.
- Shadow-DOM isolation, large-document culling, mobile editing layout.

See ADR 0008 for the stack and renderer, ADR 0009 for the bridge, ADR 0010 for selection, the inspector and undo, ADR 0012 for declared dev servers, and ADR 0013 for snapshot extraction.
