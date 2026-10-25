# Apps

User-facing surfaces. Each app is a client of the document contract in `packages/core`; none of them owns the design data.

| App | Purpose | Status |
| --- | --- | --- |
| `web/` | Browser editor. Today: selection, property inspector, keyboard undo/redo, live file updates and bridge commands. Next: layer tree, drag/resize, multi-select, presence, chat. | Live editing implemented (ADR 0008–0010). |
| `relay/` | Optional collaboration server for teams that do not run the local bridge. | Later; the local-first path does not depend on it. |

The app stack is Vite 8 + React 19 + TypeScript; the renderer is the shared DOM-first `@weft/render`. See [ADR 0008](../docs/decisions/0008-editor-stack-dom-renderer.md) and the [web README](web/README.md).
