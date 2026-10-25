# Packages

Shared libraries. The document model is the spine: every other package is a client, renderer, or transport for it, and none of them may invent a private representation of a design.

| Package | Responsibility | Status |
| --- | --- | --- |
| `core/` | Schema, node operations, commands and inverses, validation, deterministic serialization. No DOM, no network, no runtime dependencies. | Implemented; 109 tests. Migrations arrive with the first breaking schema change. |
| `design-io/` | Design directory access: safe paths, atomic writes, single-page writes, snapshot payloads, inspect/validate, canonical formatting, init, summary. Node only. | Implemented; 21 tests. |
| `workspace/` | Explicit local project registry, canonical paths, design discovery and missing-root reporting. Node only. | Implemented; 9 tests. |
| `dev-server/` | Declared project dev servers: config validation, attach mode, readiness, bounded logs and process-group stop. Node only. | Implemented; 12 tests. |
| `contract/` | Published JSON Schema draft 2020-12 and conformance fixtures; structural validation only. | Implemented; 7 tests. |
| `session/` | Yjs-backed live page, command application, sync updates, and three-way file-write merge. Browser and Node. | Implemented; 12 tests. |
| `render/` | Read-only DOM renderer: geometry, CSS flex, text, tokens, paints, page bounds, sandboxed snapshots. | Implemented; 7 tests. |
| `bridge/` | Local live bridge: serves the built app, watches files, accepts browser commands, writes page files, streams Yjs updates over HTTP/WebSocket, enforces loopback/cookie/Origin boundaries, switches workspace designs, serves snapshot payloads, and starts/stops declared project servers. | Implemented; 10 tests. |
| `extract/` | Allowlisted Chromium capture, asset inlining, sanitization and snapshot-node insertion. Node only. | Implemented; 7 tests. |
| `cli/` | `weft` headless client: `init`, `validate`, `fmt`, `inspect`, `get`, `apply`, `id`, `extract`, `dev`, `workspace`. Later `export`, `agent`, `mcp`. | Implemented; 24 tests. |
| `mcp/` | MCP server exposing the document contract as tools. | Planned. |
| `agent/` | Harness adapters and the chat session model. | Planned. |

Rules:

- Depend on `core` downward only; no package imports from an app. `design-io` and `cli` sit above `core`; the browser never imports them.
- No package reaches around the document contract for a shortcut, including the editor.
- Every package that ships gets a typecheck and a test target before it is considered usable.
