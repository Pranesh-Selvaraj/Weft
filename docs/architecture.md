# Architecture

**Status:** Draft under active construction. The constraints, the plain-text decision (ADR 0002), the v1 document schema (ADR 0003), the headless CLI layer (ADR 0004), the command protocol (ADR 0005), the published JSON Schema (ADR 0006), the Yjs live session (ADR 0007), the editor stack (ADR 0008), the local bridge (ADR 0009), the editor interaction model (ADR 0010), the bridge security boundary (ADR 0011), declared project dev servers (ADR 0012), snapshot extraction (ADR 0013), creation tools/layer tree (ADR 0014), page-level document commands (ADR 0015), the agent MCP contract (ADR 0016), direct layout manipulation (ADR 0017), page organization (ADR 0018), multi-selection/batch commands (ADR 0019), alignment/nudge (ADR 0020), combined multi-resize (ADR 0021) and static export (ADR 0022) are agreed. The core, CLI, structural contract, session engine, renderer, live bridge, browser editing/creation/direct-manipulation loop, page commands, local bridge hardening, workspace registry/picker, dev-server manager, extractor and MCP server are implemented. Deeper agent permissions, asset/font export and a published binary remain.

## 1. Constraints

| Constraint | Consequence |
| --- | --- |
| Browser-native | The editor is a web app: no native install, no desktop shell, no embedded browser engine. |
| Agent-agnostic | The agent surface is a documented contract (files, MCP, live channel), not an integration with one vendor. |
| Local-first | The default deployment is a repository plus a local process; the network is optional. |
| Lightweight | Plain text, browser APIs, small dependencies, fast cold start. |
| Real-time | Concurrent editing, presence, and live agent edits are core, not an add-on. |
| Design → code | The document must carry enough structure (layout, tokens, content, assets) to implement from. |
| Fidelity | Captured product pages must render as they ship, not as a re-creation. |

## 2. System shape

```mermaid
flowchart TB
    subgraph Browser
      UI[Editor UI<br/>React + DOM renderer]
      Y[Yjs document<br/>one per page]
      IDB[(IndexedDB cache)]
      UI <--> Y
      Y <--> IDB
    end

    subgraph "Local machine"
      B[Weft bridge<br/>HTTP + WebSocket]
      FS[(Design directory<br/>weft.json · pages/*.json · assets)]
      G[(git)]
      A[Agent adapter<br/>pi / opencode / Claude Code / Codex]
      C[In-canvas chat]
      B <--> FS
      FS --- G
      B <--> A
      C <--> B
    end

    Y <-->|updates · awareness| B
    A -->|MCP tools or file edits| FS
    A <-->|live tool calls| B
```

### Components

- **`apps/web`** — the browser editor. The read-only preview now has selection, an inspector, keyboard undo/redo, creation tools for frames/text/shapes and pages, direct move/resize, multi-selection with batch move/delete/resize, alignment/nudge, page rename/reorder, a read-only layer tree and live commands over the bridge. React + Vite + TypeScript (ADR 0008, ADR 0010, ADR 0014, ADR 0015, ADR 0017, ADR 0018). Static handoff is available through `@weft/export` (ADR 0022). Snapping/guides, flex-aware layout, presence and chat are next.
- **`packages/core`** — document schema, node operations, validation, migrations, deterministic serialization. No DOM, no network. Shared by the editor, bridge, CLI, MCP server, and exporter.
- **`packages/design-io`** — Node filesystem access for design directories: safe paths, atomic writes, read/inspect/validate, canonical formatting, init, summary. Keeps Node out of the browser core.
- **`packages/workspace`** — explicit local project registry and design discovery: canonical project roots, unique names, atomic owner-only storage, ignored build/hidden directories, missing-root reporting. The bridge/browser picker and dev-server manager consume this allowlist.
- **`packages/dev-server`** — declared project dev servers: config validation, attach mode, readiness probes, bounded logs and process-group supervision. The bridge starts/stops one server per registered project through authenticated routes (ADR 0012).
- **`packages/extract`** — allowlisted Playwright/Chromium capture, computed-style serialization, asset inlining, script/URL sanitization and snapshot-node insertion. The CLI exposes it; the renderer loads the payload only into a sandboxed iframe (ADR 0013).
- **`packages/contract`** — the published JSON Schema and conformance fixtures for manifests, pages and commands. Structural validation only; the core remains authoritative for semantic checks.
- **`packages/session`** — Yjs-backed `PageSession`: live node/placement maps, fractional order keys, command application, materialization, sync updates, and conservative three-way ingestion of whole-page file writes.
- **`packages/render`** — read-only document-to-DOM renderer: absolute geometry, CSS flex, real text, tokens, paints, sandboxed snapshot iframes and page bounds. Shared by the preview, and later by the editor and export.
- **`packages/bridge`** — local bridge: serves the built web app and API, watches the active design directory, keeps a `PageSession` per page, ingests file writes, accepts browser page/node commands, writes page files/manifest atomically, and streams Yjs updates over WebSocket. It also reads snapshot payloads into `init` messages. In workspace mode it lists registered designs, switches the active design through a registry-validated `/api/open`, and starts/stops declared project servers through `/api/dev`. It is loopback-only and gated by a per-run session cookie, Host/Origin checks and payload limits (ADR 0011, ADR 0012). Presence and agent sessions are next.
- **`packages/cli`** — the headless `weft` client. Today: `init`, `validate`, `fmt`, `inspect`, `get`, `apply`, `page`, `id`, `extract`, `export`, `mcp`, `dev`, `workspace`, with human and `--json` output. Later: `agent`.
- **`packages/mcp`** — stdio MCP server exposing allowlisted design reads, page/document commands, validation and context packets (ADR 0016).
- **`packages/export`** — server-side static handoff: renders canonical pages to standalone HTML with tabs, tokens and an export manifest; snapshots remain sandboxed and no scripts are added (ADR 0022).
- **`packages/agent`** — adapters that start and talk to harnesses: a generic process adapter plus presets.

## 3. Document model

### Layout on disk

```text
designs/marketing.weft/
├── weft.json              # manifest: format version, id, name, pages, tokens, assets, meta
├── pages/
│   ├── landing.json       # one page = one flat node map + ordered roots
│   └── pricing.json
├── snapshots/
│   ├── nd_01JAV3...html   # captured, sanitized page payload
│   └── nd_01JAV3...css    # optional scoped styles
├── assets/
│   ├── 01JAV3...logo.svg
│   └── 01JAV3...hero.avif
└── .gitignore             # optional: ignore bridge cache
```

A directory rather than a single file: an agent asked to "fix the pricing card" reads one page, not the whole document; git conflicts stay local to a page; large assets do not bloat the JSON diff.

### Node sketch

The page stores a flat map of nodes keyed by id (ADR 0003); this is one node from that map.

```json
{
  "id": "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
  "type": "frame",
  "name": "Hero",
  "x": 0,
  "y": 0,
  "width": 1440,
  "height": 800,
  "layout": { "mode": "flex", "direction": "column", "gap": 24, "padding": [64, 80] },
  "style": { "fills": [{ "type": "solid", "color": "{color.surface}" }], "radius": 0 },
  "children": ["nd_01JAV3Q8ZK4M2TP9W6XH5NR7BF"]
}
```

- Every node has a stable ULID and a human name; ids survive moves, renames, and merges.
- Dimensions are CSS pixels with a top-left origin per frame; no device-pixel ambiguity.
- Style values may reference tokens by name; tokens are part of the file and exportable.
- Content is text, not outlines; images are assets by id, never base64 inside page JSON.
- Unknown fields are preserved on read and write so a newer agent or editor cannot silently strip data.
- The canonical serialization is deterministic (sorted keys, fixed float formatting) so an unchanged document produces an unchanged diff.

### Two kinds of frames

1. **Native frames** — authored in Weft; every node is editable, inspectable, and exportable.
2. **Snapshot frames** — captured from a running product. A snapshot stores sanitized HTML and the styles needed to render it as separate files beside the page, plus source metadata (URL, selector, viewport, commit, capture time). It renders inside a sandboxed iframe at a fixed size.

Snapshot frames are not a dead end: designers annotate nodes inside them, and agents read annotations plus the underlying source metadata. Converting a captured region into native nodes is a later, explicit operation, never a silent approximation.

### Real-time and files

The canonical file is JSON; the live document is a Yjs page session (ADR 0007). The bridge is the only writer of canonical files for browser edits; the CLI and agents write files directly when they are the only writer.

- **Mutations are commands.** Every live edit from a person or an agent is a serializable `PageCommand` with an inverse (ADR 0005). `@weft/session` applies those commands to Yjs, materializes the same JSON, and returns the inverse. The bridge accepts browser commands over WebSocket and writes the changed page atomically; CLI and agent file writes are ingested back into the session.
- **The structural contract is published.** `@weft/contract` carries a draft 2020-12 JSON Schema and conformance fixtures (ADR 0006). The schema checks shape; the core validator checks links, cycles, tokens, ids and files.
- **Live state uses placement, not child arrays.** Node fields are Y.Map registers; parent and fractional `order` live in a separate placement map; `children` arrays are derived at materialization. There is no `Y.Array` move to fight.
- **Human edits** flow into the live session, then debounce to disk through the future bridge.
- **External agent edits** are ingested by `PageSession` as a three-way merge between the last materialized baseline, the live page and the incoming file. Non-conflicting changes apply; conflicting fields keep the live value and are reported. The session never drops a live subtree to satisfy a file write.
- Yjs is a live projection, never the durable source of truth. Deleting the live state and reopening from files reproduces the document.

The bridge still has to add the file watcher, websocket transport, persistence and agent sessions around this engine; the reconciliation semantics themselves are settled and tested.

## 4. Agent surface

Four tiers with one permissions model:

1. **Files.** An agent with repository access can read and write the design directly. This is the baseline and must always be sufficient for non-interactive agents.
2. **MCP tools.** `weft mcp` exposes structured operations: list pages, get a node subtree, create/update/delete a node, set tokens, annotate, export. Tools validate against the same schema the editor uses and map to the same `PageCommand` vocabulary.
3. **Commands.** `weft apply` and the future MCP tools emit serializable commands with an inverse, so an agent edit can be previewed, attributed and undone without a browser.
4. **Live channel.** `@weft/bridge` serves `/api/live` over WebSocket. It streams page updates from watched files and accepts browser `command` messages, with `commandResult` and attribution broadcasts. Chat and tool calls will use the same channel.

Adapters are intentionally thin. A harness that can run a CLI, speak MCP, or read files needs no Weft-specific SDK. The adapter only handles process lifecycle, streaming output, and tool-call routing.

**Permissions.** The bridge is loopback-only, issues a random per-run `HttpOnly` session cookie, rejects cross-origin API/WebSocket requests, refuses writes outside the opened design directory, and attributes command envelopes to an author. A durable audit log, per-project permissions and remote collaboration are planned; remote access is not supported yet.

## 5. Rendering

The renderer and browser editor are implemented in `@weft/render` and `apps/web` (ADR 0008, ADR 0010). The inspector uses command messages over the bridge; the canvas itself remains DOM.

- **DOM-first.** Frames render as absolutely positioned DOM with CSS. The browser already implements the layout engine we need; reimplementing it on canvas would fight the fidelity goal.
- **Canvas chrome.** Selection, handles, guides, and cursors live in a single overlay layer, never inside frame DOM.
- **Snapshots** render in `sandbox` iframes with scripts disabled, no same-origin access, and a strict CSP; captured styles are scoped to the frame.
- **Vector paths** use inline SVG, not canvas, so they stay inspectable and exportable.
- **Scaling** applies a transform to the canvas root; text stays selectable and crisp because it is real text.
- **Performance guardrails:** cull offscreen frames, memoize node rendering, keep per-page documents bounded, and move to a tiled renderer only if profiling demands it.

## 6. Extraction

`weft extract <design.weft> <url> --project <root> --selector <css> --viewport 1440x900` uses `playwright-core` and an explicitly discovered Chromium to:

1. refuse a URL unless its exact origin is in the project's `extract.origins`;
2. load the page in a fresh browser context whose HTTP/WebSocket routes allow only those loopback origins;
3. serialize the selected subtree with computed styles, inline same-origin images as data URLs, and strip scripts, forms, frames, event handlers and external URLs;
4. verify the markup and CSS with a dependency-free Node pass that fails closed on executable constructs or non-data URLs;
5. write sanitized HTML/CSS beside the page and insert a snapshot node with source URL, selector, viewport, timestamp and file references.

Snapshot payloads render in a `sandbox=""` iframe with a restrictive CSP. The editor never executes captured scripts. The extractor is a local, allowlisted capture path, not a general remote browser service; see [Snapshot extraction](extraction.md) and ADR 0013.

## 7. Repository layout

```text
weft/
├── apps/
│   ├── web/               # browser editor
│   └── relay/             # optional collaboration server (later)
├── packages/
│   ├── core/              # schema, operations, migrations
│   ├── design-io/         # design directory read/write/format/inspect
│   ├── workspace/         # local project registry + design discovery
│   ├── dev-server/        # declared project servers + readiness/supervision
│   ├── extract/           # allowlisted browser capture + sanitization
│   ├── contract/          # published JSON Schema + conformance fixtures
│   ├── session/           # Yjs live page + file-write reconciliation
│   ├── render/            # DOM renderer + exporter
│   ├── bridge/            # local daemon
│   ├── cli/               # weft CLI
│   ├── mcp/               # MCP server
│   └── agent/             # harness adapters + chat session
├── docs/
└── examples/
```

## 8. Risks and hard problems

| Risk | Why it matters | First response |
| --- | --- | --- |
| CRDT ↔ file reconciliation | Two writers (human and agent) on one page can silently lose work. | Implemented in `@weft/session` as a three-way merge with explicit conflicts, with the bridge watcher/transport and atomic page writes on top. |
| Browser layout fidelity | CSS in an editor is not the same as CSS in the host app. | Render captured pages in sandboxed iframes; keep native design nodes on a separate, simpler layout model. |
| Schema churn | Every format change breaks files and agent integrations. | Versioned schema, migrations, unknown-field preservation, fixtures in CI. |
| Large documents | JSON and DOM both degrade at thousands of nodes. | Per-page documents, culling, explicit node budgets, profiling gates. |
| Agent quality | A loose tool contract produces sloppy edits. | Small typed operations, dry-run previews, attribution, and undo. |
| Harness fragmentation | Each harness streams output and calls tools differently. | Thin adapters with MCP as the common denominator; file access always works. |
| Snapshot security | Captured HTML is untrusted input. | Origin/asset allowlists, request routing, browser sanitization plus a fail-closed verifier, data-only assets, sandboxed iframe and CSP. |
| Naming collision | "Weft" may already be used commercially. | Trademark and domain check before any public launch; renaming is cheap while private. |

## 9. What gets specified next

The document schema and operations are settled in ADR 0003, the headless CLI and design I/O layer in ADR 0004, the command protocol in ADR 0005, the published JSON Schema in ADR 0006, the Yjs live session in ADR 0007, the editor stack and DOM renderer in ADR 0008, the local bridge in ADR 0009, the editor interaction model in ADR 0010, the bridge security boundary in ADR 0011, declared project dev servers in ADR 0012, snapshot extraction in ADR 0013, creation tools/layer tree in ADR 0014, page-level document commands in ADR 0015, the agent MCP contract in ADR 0016, direct layout manipulation in ADR 0017, page organization in ADR 0018, multi-selection/batch commands in ADR 0019, alignment/nudge in ADR 0020, combined multi-resize in ADR 0021, and static export in ADR 0022; all are implemented. Each remaining area becomes an ADR before implementation: deeper agent permissions/audit, page duplicate and remaining editor controls. The ADR index is the source of truth for the current status of each.
