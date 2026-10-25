# 0008. Editor stack v1: Vite + React + a DOM-first renderer

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The document, CLI, structural contract and live session exist, but nobody has seen a design in the browser. The next risk is rendering: whether the schema's geometry, styles and layout can become a faithful, fast browser surface without building a native runtime or a custom layout engine.

The product is browser-native and fidelity-driven. Captured product pages are real DOM; native frames should be real DOM too. A canvas/WebGL renderer with a custom layout engine (the Figma model) would fight both goals and delay the product. The app shell is also not the design content: it needs to stay out of the way and not leak CSS into frames.

This record covers the read-only preview. Editing, selection, panels and the bridge are separate decisions; they will consume the same renderer.

## Decision

### 1. App stack: Vite + React + TypeScript

`apps/web` is a Vite 8 application with React 19 and TypeScript. Vite gives a fast dev server and a small static build; React is the safest ecosystem for the editor chrome (panels, dialogs, menus, state) and does not own the design hot path. The renderer is imperative enough that a future framework swap would not change the DOM contract.

The app is read-only for this slice. It has a top bar, page tabs, a fit-to-view stage and a footer hint. There is no selection, inspector, chat or editing yet.

### 2. Renderer: a shared package, not app code

`@weft/render` exports `PageView`, `getPageBounds`, and the style helpers used to turn schema values into CSS. It is a real package so the editor, export pipeline and future tests share one renderer.

The renderer is **DOM-first**:

- Every frame/group is a real `div` with absolute geometry; flex layout maps to CSS flex, not a custom solver.
- Text nodes render real text with font, line-height, letter-spacing, alignment and token colors.
- Rectangles and ellipses are DOM boxes with fills, strokes, radius and shadows.
- Images use an asset URL resolver; without one they render as a placeholder.
- Snapshots render in a sandboxed `iframe` with no scripts when a payload is available; otherwise a placeholder shows the source URL and viewport.
- Tokens are resolved at render time; unresolved token colors fall back to transparent rather than emitting invalid CSS.
- Design content uses inline styles and `box-sizing: border-box`, keeping app CSS out of frames.
- Page bounds are computed from top-level nodes; the app scales the whole stage to fit the viewport.

No custom layout engine, no canvas renderer, no WebGL. Those can be added only if profiling proves the DOM path cannot meet a concrete budget.

### 3. Loading a design without a bridge yet

The app imports a virtual module, `virtual:weft-design`, provided by a Vite plugin. In dev and build, the plugin calls `readDesign` from `@weft/design-io` and embeds the manifest and pages.

- The default design is `examples/starter.weft`.
- `WEFT_DESIGN=/path/to/design.weft` overrides it.
- The plugin watches the design directory and triggers a full reload on change.
- The Vite build embeds the starter design, so the preview is a static artifact without a file server.

This is an explicit development shortcut. It is not the production file path. The local bridge will serve a chosen design directory and stream live session updates; the renderer will not change when that lands.

### 4. Read-only first

The preview has no editing surface. That is deliberate: it validates the renderer against real data and gives the session a visual target before selection, commands, panels and the bridge add complexity.

## Consequences

**Easier**

- A real design is visible in the browser with no native runtime and no bridge.
- The renderer is exercised by the starter design and by unit/server-render tests.
- Flex, tokens, real text, borders, shadows and page bounds are proven against the actual schema.
- The app build is small (roughly 233 KB JS, 73 KB gzipped at this slice) and loads instantly.
- The renderer is a package, so the editor and export cannot accidentally diverge.

**Harder, and knowingly accepted**

- The virtual module is a dev/build shortcut. Changing designs requires a reload; a bridge with a file watcher and websocket session comes next.
- Assets are not served yet; images render as placeholders. The asset URL resolver exists for the bridge and importer to fill in.
- Snapshot payloads are not loaded by the Vite plugin; snapshots render as placeholders until extraction and the bridge land.
- Fonts fall back to system fonts unless the design's families are installed. Bundling web fonts is a licensing and asset-pipeline decision, not a renderer default.
- The app is read-only. There is no selection, hit testing, inspector, zoom control or editing.
- DOM performance is untested at thousands of nodes and dozens of iframes. Culling and lazy snapshot mounting are future work.
- App CSS and design CSS share a document. Inline styles and a strict reset keep them separate enough for a preview, but the editor may need shadow-DOM isolation per frame later.
- The page surface size is derived from top-level node bounds; designs with intentionally negative or infinite canvas use need a viewport model later.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Canvas/WebGL renderer with a custom layout engine** | The Figma model, but it reimplements CSS, loses DOM text/accessibility, and still needs iframes for captured pages. It fights the fidelity mission and delays the first visible design. |
| **Svelte or Solid for the app shell** | Both are credible and lighter. React has the strongest ecosystem for editor chrome and agent-generated UI code, and the renderer is custom either way. The choice can be revisited without changing `PageView`. |
| **One iframe per page or frame** | Strong isolation, but heavy for a canvas and awkward for selection/presence overlays. The editor will use iframes only for captured snapshots. |
| **Static JSON import without the Vite plugin** | Simple, but it would copy the starter into app code and not exercise `readDesign`, path safety or the real manifest/page split. |
| **Build the bridge first and load through HTTP** | More realistic, but adds watcher, server, auth and websocket decisions before the renderer is proven. The bridge is still the next step; the virtual module keeps this slice focused. |
| **Tailwind or a component library for the chrome** | The chrome is a handful of elements. Plain CSS keeps the app small and avoids a styling dependency that would not be used inside design frames. |
| **Start with editing/selection** | Rendering is the prerequisite and the easier thing to validate. Editing before the canvas is stable would mix two failure domains. |

## Prior art / what this replaces

There was no browser surface before this record. `@weft/render` is the first implementation of the DOM-first rendering decision sketched in ADR 0002 and the architecture. It is read-only; the editor, selection, panels and bridge build on it rather than forking it.
