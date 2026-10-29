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

- **Static preview.** `vite.config.ts` provides `virtual:weft-design`, which calls `readDesign`/`readSnapshotPayloads` at dev/build time and embeds `{ manifest, pages, snapshots }`.
- **Live preview.** Served by `weft dev`, the app fetches `/api/design` (including snapshot payloads), builds a `PageSession` from each page's Yjs update, connects to `/api/live`, and applies live updates. The top bar shows `live`, `connecting` or `offline` instead of `read only`.

The static path remains the zero-process preview and the fallback.

## What you can do

- Click a layer to select it; the selection box follows the rendered DOM.
- Use the left tool panel to create frames, text, rectangles and ellipses (`V`, `F`, `T`, `R`, `O`). Drag for a custom size or click for a default size; creation inside a selected frame becomes a child of that frame.
- Move a selected layer by dragging its rendered DOM; resize it with the eight selection handles. Shift/Cmd/Ctrl-click adds layers to the selection; dragging any selected layer moves the group, and Delete removes it, each as one batch command with an inverse. Arrow keys nudge the selection (Shift: 10 px).
- The multi-layer inspector can align selected layers left/center/right/top/middle/bottom and shows a flex-child warning when the parent layout may override x/y. The inspector switches to a multi-layer summary when more than one layer is selected.
- Browse the nested layer tree, expand/collapse containers, and select any layer. The tree auto-expands to the selected node.
- Create a blank page with **+ Page**, rename it with **Rename** or by double-clicking its tab, drag tabs to reorder, and delete the active page with **Delete** (confirmation, last page protected). Page commands share the same undo/redo history as node commands.
- Empty pages show an in-artboard hint explaining that the visible area is a blank page and pointing to the creation tools.
- Edit name, position, size, opacity, fill and text content in the inspector. Changes commit on blur/Enter.
- Delete a layer, undo with Cmd/Ctrl+Z, redo with Cmd/Ctrl+Shift+Z. Every creation is a normal command with an inverse.
- See live file changes from the CLI or an agent, and the last editor's attribution.
- Switch pages; the inspector stays in sync with the active page.
- Toggle the UI between light and dark from the toolbar. The choice follows the system preference by default and persists locally; design content keeps its own colors.
- When served by `weft workspace dev`, use the design selector in the top bar to switch between projects and designs registered in the workspace, and the Server panel to start, attach to and stop a project's declared dev server.
- Snapshot nodes render their sanitized HTML/CSS in a sandboxed, CSP-restricted iframe. Run `weft extract` to create one; the bridge and static preview both load the payload files.

The static preview is read-only and has no bridge, inspector edits or history.

## Not here yet

- Page duplicate and cross-design drag; multi-resize, distribute/match-size/align-to-page, marquee/range selection, snapping/guides, rotation and aspect-ratio locks, layer reordering and visibility/lock controls, components.
- A browser Extract button; extraction currently starts from the CLI.
- Presence/cursors, chat, page rename/background/token commands.
- Asset serving for image nodes and zoom controls.
- Shadow-DOM isolation, large-document culling, mobile editing layout.

See ADR 0008 for the stack and renderer, ADR 0009 for the bridge, ADR 0010 for selection/the inspector/undo, ADR 0012 for declared dev servers, ADR 0013 for snapshot extraction, and ADR 0014 for creation tools and the layer tree, and ADR 0015 for page-level document commands, and ADR 0017 for direct layout manipulation, and ADR 0018 for page organization, and ADR 0019 for multi-selection and batch commands, and ADR 0020 for alignment/nudge.
