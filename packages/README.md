# Packages

Shared libraries. The document model is the spine: every other package is a client, renderer, or transport for it, and none of them may invent a private representation of a design.

| Package | Responsibility | Status |
| --- | --- | --- |
| `core/` | Schema, node operations, batch/page/document commands (create/remove/rename/move) and inverses, validation, deterministic serialization. No DOM, no network, no runtime dependencies. | Implemented; 117 tests. Migrations arrive with the first breaking schema change. |
| `design-io/` | Design directory access: safe paths, atomic writes, single-page/manifest writes, document-command file transactions (including rename rollback), file removal, snapshot payloads, inspect/validate, canonical formatting, init, summary. Node only. | Implemented; 24 tests. |
| `workspace/` | Explicit local project registry, canonical paths, design discovery and missing-root reporting. Node only. | Implemented; 9 tests. |
| `dev-server/` | Declared project dev servers: config validation, attach mode, readiness, bounded logs and process-group stop. Node only. | Implemented; 12 tests. |
| `contract/` | Published JSON Schema draft 2020-12 and conformance fixtures, including page document commands; structural validation only. | Implemented; 8 tests. |
| `session/` | Yjs-backed live page, command application, sync updates, and three-way file-write merge. Browser and Node. | Implemented; 12 tests. |
| `render/` | Read-only DOM renderer: geometry, CSS flex, text, tokens, paints, page bounds, sandboxed snapshots. | Implemented; 7 tests. |
| `bridge/` | Local live bridge: serves the built app, watches files, accepts browser commands, writes page files, streams Yjs updates over HTTP/WebSocket, enforces loopback/cookie/Origin boundaries, switches workspace designs, serves snapshot payloads, applies node/page commands, and starts/stops declared project servers. | Implemented; 11 tests. |
| `extract/` | Allowlisted Chromium capture, asset inlining, browser sanitization, fail-closed verification and snapshot-node insertion. Node only. | Implemented; 7 tests. |
| `export/` | Static HTML handoff: server-rendered pages, index, tokens and export manifest; sandboxed snapshots and no scripts. Node only. | Implemented; 3 tests. |
| `cli/` | `weft` headless client: `init`, `validate`, `fmt`, `inspect`, `get`, `apply`, `page` (create/remove/rename/move/apply), `id`, `extract`, `export`, `mcp`, `dev`, `workspace`. Later `agent`. | Implemented; 28 tests. |
| `mcp/` | MCP server over stdio: allowlisted design reads, node/page commands, validation and context packets. | Implemented; 4 tests. |
| `agent/` | Chat-session model and adapters beyond MCP. | Planned. |

Rules:

- Depend on `core` downward only; no package imports from an app. `design-io` and `cli` sit above `core`; the browser never imports them.
- No package reaches around the document contract for a shortcut, including the editor.
- Every package that ships gets a typecheck and a test target before it is considered usable.
