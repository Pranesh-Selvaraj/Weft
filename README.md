# Weft

> **Agent-native design canvas for the browser.**
>
> Design files that designers and coding agents shape together — in real time, in a format any harness can read and write.

Weft is a Figma alternative built for a world where humans and coding agents work on the same product. Today the design lives in an opaque cloud file and the implementation lives in a repository, and the agent can touch one but not the other. Weft closes that gap: a design file is a plain-text, versioned document in your repository, a browser canvas renders it live, and any coding agent — pi, opencode, Claude Code, Codex, or one you write tomorrow — can read it, edit it, and build from it.

## Why the name

In weaving, the **warp** is the structure held in tension and the **weft** is the thread carried across it. The design and the implementation are the two thread systems; the product is the cloth they make together. An agent is not a guest in the design file — it is one of the threads.

The name fits the family — Enclave, Nexus, Ratio, Tempo — and gives the architecture its own vocabulary without borrowing Figma's.

## What makes Weft different

- **Files, not silos.** A design is a directory of deterministic JSON and assets that lives beside the code. It diffs, reviews, branches, and merges like everything else in the repository.
- **Any agent, no plugin.** Agents get first-class access through files, a CLI, an MCP server, and a live bridge. Hosted assistants, local harnesses, and custom agents all use the same contract.
- **Browser-native.** No install to view or edit. Open a URL, join a file, and work; the rendering is the browser's own DOM, not a native runtime.
- **Real-time by default.** Presence, cursors, and concurrent edits are part of the document layer, not a paid add-on.
- **Extract the real product.** Capture a running page — markup, styles, and assets — into frames, annotate them, and let an agent turn the annotations into code changes.
- **Designs you can build from.** Tokens, layout, and content are structured data, so the same file can drive the canvas, an export, or an agent's implementation.

## How it works, at a glance

```mermaid
flowchart LR
    A[Browser editor] <-->|updates + awareness| B[Weft bridge]
    B <-->|read / write| C[(Design files + git)]
    B <-->|adapters| D[pi · opencode · Claude Code · Codex]
    A <-->|chat + tools| B
    E[Running product] -->|extract| C
```

The **bridge** is a small local process. It serves the editor, owns file materialization, relays real-time updates, and translates between an agent session and the document. The **files** are the source of truth. The **editor** is one client of the document contract, not the contract itself.

## Principles

1. **The file is the product.** If a capability cannot be represented in the design file, it does not exist.
2. **No privileged agent.** Anything the built-in assistant can do, any external harness can do through the same documented tools.
3. **Local-first, cloud-optional.** The default path runs entirely on your machine; sync is a deployment choice.
4. **Fidelity over cleverness.** Extracted pages render as real DOM in a sandbox, not as screenshots, so what you review is what ships.
5. **Reversible everything.** Every agent edit is a document operation with an author, a timestamp, and an undo path.
6. **Lightweight by construction.** Plain text, browser APIs, a small dependency surface, and no native runtime.

## Status

Pre-alpha, foundation-and-preview phase. The founding decisions are recorded in [`docs/decisions/`](docs/decisions/); the working system design is in [`docs/architecture.md`](docs/architecture.md).

The core document model is implemented in [`@weft/core`](packages/core): the schema, pure node operations, a deterministic JSON writer, and a dependency-free validator. The filesystem layer and the `weft` CLI are implemented in [`@weft/design-io`](packages/design-io) and [`@weft/cli`](packages/cli). Together they are covered by 232 tests and a readable [starter design](examples/starter.weft/). The CLI can validate, format, inspect, read pages and nodes, apply attributed commands, and create/remove pages with inverses for undo. A published JSON Schema and conformance fixtures make the structural contract available to non-TypeScript clients. A Yjs-backed session applies the same commands live and merges whole-page file writes without silently dropping live edits. The browser preview renders the starter design as real DOM. Served by `weft dev`, it becomes an editor: select a layer, change its properties, write the page to disk, and undo or redo through command inverses. `weft workspace dev` adds a project/design picker and a Project server panel that starts or attaches to a dev server declared in `weft.project.json`, waits for readiness, shows logs and stops the process group. The editor can now create frames, text, rectangles, ellipses and whole pages, navigate them in a nested layer tree, and undo both node and page mutations; every creation is a normal command with an inverse. The extraction loop works from the CLI: `weft extract` captures an allowlisted loopback page into sanitized HTML/CSS beside the design, inserts a snapshot frame that renders in a sandboxed iframe, and serves the payload through the static preview and live bridge. The agent surface is now available as an MCP server: `weft mcp` exposes allowlisted design reads, page/node commands, page document commands, validation and context packets over stdio, with an optional read-only mode. A published binary and deeper per-project permissions remain.

The first milestone is deliberately small: open a file in the browser, edit it, have an external agent change it live, and extract one real page into it. See the [MVP exit criteria](docs/product.md#mvp-exit-criteria).

## Try it

```bash
pnpm install
pnpm build

# Static browser preview (one terminal).
pnpm dev
# http://127.0.0.1:5240

# Live editor over the watched design (one terminal).
pnpm weft dev examples/starter.weft
# http://127.0.0.1:5250
# Click a layer, edit it in the inspector, then use Undo/Redo.

# Workspace picker and declared project servers.
pnpm weft workspace dev
# Select a project design, open Server, then Start server.

# MCP over stdio for coding agents (read-only example).
pnpm weft mcp --workspace ~/.weft/workspace.json --read-only

# Capture a running page declared in a project's weft.project.json.
# Requires Chromium; see docs/extraction.md.
pnpm weft extract path/to/design.weft http://127.0.0.1:3000/ \
  --project path/to/project --selector main --name "Landing"

# CLI commands, from another terminal.
pnpm weft validate examples/starter.weft
pnpm weft inspect examples/starter.weft --json
pnpm weft get examples/starter.weft --page Landing

# Create and validate a new design.
pnpm weft init /tmp/weft-demo --name "Demo"
pnpm weft validate /tmp/weft-demo
pnpm weft id --prefix nd
```

`weft fmt` rewrites the manifest and pages into canonical JSON; `--check` reports without writing. `weft apply` applies a JSON command and returns its inverse. `weft dev` serves the built app and live-updates it from the watched design directory. See the [CLI guide](docs/cli.md). Load another design in the static preview with `WEFT_DESIGN=/path/to/design.weft pnpm dev`.

## Repository layout

```text
weft/
├── apps/          # browser editor and other user-facing surfaces
├── packages/      # document model, renderer, CLI, bridge, MCP server
├── docs/          # product, architecture, decisions, and history
└── examples/      # sample design files and host integrations
```

The layout is the intended shape; packages are added as decisions land. Founding records: [ADR 0001](docs/decisions/0001-project-name.md) (the name), [ADR 0002](docs/decisions/0002-design-files-as-plain-text.md) (design files as plain text), [ADR 0003](docs/decisions/0003-document-schema-v1.md) (the schema), [ADR 0004](docs/decisions/0004-headless-cli-and-design-io.md) (headless-first tooling), [ADR 0005](docs/decisions/0005-command-protocol.md) (the command protocol), [ADR 0006](docs/decisions/0006-published-json-schema.md) (the published schema), [ADR 0007](docs/decisions/0007-yjs-live-sessions.md) (the live session and file-write merge), [ADR 0008](docs/decisions/0008-editor-stack-dom-renderer.md) (the editor stack and DOM renderer), [ADR 0009](docs/decisions/0009-local-bridge-live-preview.md) (the local live bridge), [ADR 0010](docs/decisions/0010-editor-interaction.md) (the editor interaction model), [ADR 0011](docs/decisions/0011-bridge-security-boundary.md) (the bridge security boundary), [ADR 0012](docs/decisions/0012-declared-dev-servers.md) (declared project dev servers), [ADR 0013](docs/decisions/0013-snapshot-extraction.md) (snapshot extraction), [ADR 0014](docs/decisions/0014-editor-create-tools.md) (creation tools and layer tree), [ADR 0015](docs/decisions/0015-page-document-commands.md) (page-level document commands), and [ADR 0016](docs/decisions/0016-agent-mcp.md) (the agent MCP contract).

## Documentation

- [Product definition](docs/product.md) — who it is for, what it does, and how we know the first version is done.
- [Architecture](docs/architecture.md) — components, document model, agent surfaces, real-time layer, and risks.
- [CLI](docs/cli.md) — commands, JSON output, exit codes, and agent recipes.
- [Structural contract](packages/contract/README.md) — the JSON Schema, conformance fixtures, and the structural/semantic boundary.
- [Live session](packages/session/README.md) — the Yjs page model, command application, sync, and file-write merge policy.
- [Browser editor](apps/web/README.md) — the Vite/React app, live editing, and `WEFT_DESIGN`.
- [Renderer](packages/render/README.md) — the DOM renderer API, supported styles, and limits.
- [Local bridge](packages/bridge/README.md) — `weft dev`, the HTTP/WebSocket protocol, and live reload semantics.
- [Local workspace](docs/local-workspace.md) — how a local Weft instance can work across registered project roots and running apps.
- [Declared dev servers](docs/dev-server.md) — project config, start/attach, readiness, logs, process lifecycle and the security boundary.
- [Snapshot extraction](docs/extraction.md) — capture allowlists, browser setup, sanitization, asset inlining, snapshot files and prompt-injection limits.
- [MCP server](docs/mcp.md) — `weft mcp`, client configuration, tools, allowlisting, context packets and read-only mode.
- [Workspace registry](packages/workspace/README.md) — the explicit project allowlist and design discovery API.
- [Security model](docs/security.md) — threat model, current controls, gaps, and hardening branches.
- [Security policy](SECURITY.md) and [contributing](CONTRIBUTING.md) — reporting and the protected-branch workflow.
- [Decision records](docs/decisions/README.md) — why the system is shaped this way.
- [Project history](docs/HISTORY.md) — the timeline that ties releases, stack changes, and ADRs together.
- [Changelog](CHANGELOG.md) — what shipped.

## Contributing

`main` is protected. Changes land through a feature branch and a pull request with the required `verify` check; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately per [SECURITY.md](SECURITY.md), never in a public issue.

## License

MIT. See [LICENSE](LICENSE).
