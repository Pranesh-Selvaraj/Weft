# Packages

Shared libraries. The document model is the spine: every other package is a client, renderer, or transport for it, and none of them may invent a private representation of a design.

| Package | Responsibility | Status |
| --- | --- | --- |
| `core/` | Schema, node operations, commands and inverses, validation, deterministic serialization. No DOM, no network, no runtime dependencies. | Implemented; 109 tests. Migrations arrive with the first breaking schema change. |
| `design-io/` | Design directory access: safe paths, atomic writes, single-page writes, inspect/validate, canonical formatting, init, summary. Node only. | Implemented; 19 tests. |
| `contract/` | Published JSON Schema draft 2020-12 and conformance fixtures; structural validation only. | Implemented; 7 tests. |
| `session/` | Yjs-backed live page, command application, sync updates, and three-way file-write merge. Browser and Node. | Implemented; 12 tests. |
| `render/` | Read-only DOM renderer: geometry, CSS flex, text, tokens, paints, page bounds, snapshots. | Implemented; 6 tests. |
| `bridge/` | Local live bridge: serves the built app, watches files, accepts browser commands, writes page files, streams Yjs updates over HTTP/WebSocket, and enforces loopback/cookie/Origin boundaries. | Implemented; 7 tests. |
| `cli/` | `weft` headless client: `init`, `validate`, `fmt`, `inspect`, `get`, `apply`, `id`, `dev`. Later `extract`, `export`, `agent`, `mcp`. | Implemented; 19 tests. |
| `mcp/` | MCP server exposing the document contract as tools. | Planned. |
| `agent/` | Harness adapters and the chat session model. | Planned. |
| `extract/` | Capture of a running page into a snapshot frame. | Planned. |

Rules:

- Depend on `core` downward only; no package imports from an app. `design-io` and `cli` sit above `core`; the browser never imports them.
- No package reaches around the document contract for a shortcut, including the editor.
- Every package that ships gets a typecheck and a test target before it is considered usable.
