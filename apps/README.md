# Apps

User-facing surfaces. Each app is a client of the document contract in `packages/core`; none of them owns the design data.

| App | Purpose | Status |
| --- | --- | --- |
| `web/` | Browser editor: canvas, layers, inspector, presence, in-canvas chat. | Planned (see [architecture](../docs/architecture.md) and the [MVP exit criteria](../docs/product.md#mvp-exit-criteria)). |
| `relay/` | Optional collaboration server for teams that do not run the local bridge. | Later; the local-first path does not depend on it. |

The editor stack is not decided yet; it will be recorded as an ADR before implementation starts.
