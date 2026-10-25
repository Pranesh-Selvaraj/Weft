# 0016 · Agent MCP contract

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Agent surface

## Context

Weft's promise is that any coding agent can work on the same design file. Files and the CLI already make that possible, but every harness discovers tools differently. MCP is the common local protocol for pi, opencode, Claude Code, Codex and other clients. The first agent surface should expose the existing document contract rather than invent agent-only file operations.

The agent surface also needs a narrow boundary: an MCP server should not become a general shell, a network daemon, or a way to read arbitrary project files. The workspace registry and single-design mode already provide explicit allowlists.

## Decision

### 1. Stdio MCP server

`@weft/mcp` provides `weft mcp` over stdio. It opens no TCP listener. Stdout is the MCP protocol; logs go to stderr. The server is configured at startup with either:

- `--workspace <file>` — every design discovered in the registered workspace; or
- `--design <dir>` — exactly one design directory.

Design paths are canonicalized with `realpath` and checked against the startup allowlist on every call. A path outside it returns `design.denied` before reading the file.

### 2. Tools over the existing contract

The first tool set is intentionally small:

- `weft_list_designs` — the allowlist;
- `weft_design_summary`, `weft_get_page`, `weft_get_node` — read context;
- `weft_validate` — issues and summary;
- `weft_apply_command` — one `PageCommand`, validated, written atomically, inverse returned; optional `dryRun`;
- `weft_page_command` — one `DocumentCommand` for page creation/removal, shared file transaction, inverse returned; optional `dryRun`;
- `weft_context` — a JSON context packet with summary, page, optional node, ancestors and children.

Writes reuse `readPageCommand`/`applyDesignCommand` and `readDocumentCommand`/`writeDocumentCommand`; there is no MCP-only mutation path. Every write result includes a command id, actor and inverse. The fixed actor is `{ id:"mcp", kind:"agent", name:"Weft MCP" }`; per-call actor spoofing is not allowed.

### 3. Read-only mode

`--read-only` keeps every read tool and rejects both write tools with `mcp.read-only`. This is the recommended default for agents that only need context, and a simple way to use Weft with a harness before granting edit access.

### 4. Context, not screenshots

`weft_context` returns a structured packet rather than a screenshot. The design file is the canonical artifact, the renderer is a browser concern, and a screenshot requires a running page/browser. Snapshot source metadata and file references are included; capture stays in `weft extract`. The packet carries an explicit notice that captured text is untrusted data.

### 5. Deliberate omissions

- No MCP resources, prompts or sampling.
- No screenshot tool.
- No per-project permissions, tool-level allowlists, durable audit log, rate limits or remote authentication.
- No HTTP/SSE transport.
- The workspace allowlist is loaded at startup; registry changes require a restart.
- Tools accept design paths, not workspace names; agents call `weft_list_designs` first.

## Consequences

**Easier**

- An MCP-capable harness can list designs, read page/node JSON, apply the same page commands as the browser/CLI, create/remove pages and get validation/context without custom adapters.
- Writes keep attribution, inverse history and atomic file semantics.
- A read-only mode gives a low-risk integration path.
- The workspace/single-design allowlist keeps the server from becoming an arbitrary filesystem reader.

**Harder, and knowingly accepted**

- Adding the official MCP SDK brings a substantial dependency tree.
- The fixed actor and absent audit log are not a permission system.
- The server has no live bridge integration, so an agent's file write reaches a running browser through the bridge watcher, not through MCP.
- The context packet can be large for heavily populated pages.
- There is no screenshot, so visual inspection still requires a browser or a future capture tool.
- Clients need an absolute path to the built CLI (or a published binary) in their configuration.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **HTTP MCP server** | Adds a network listener and another local-origin security boundary before the stdio path is proven. |
| **Agent-specific shell tools** | Gives up the typed contract, inverses and validation; MCP should expose document operations, not a terminal. |
| **Chat/presence inside Weft first** | A remote-control surface is larger and less useful than letting existing harnesses use their own interfaces. |
| **Screenshot-first context** | Requires a running page and browser; structured page/node JSON is more useful for implementation work and remains canonical. |
| **Custom protocol adapter per harness** | Duplicates discovery and tool schemas; MCP is the common denominator. |
| **One MCP server per project with implicit cwd** | Ambiguous project selection and a path-escape risk. Explicit workspace/single-design configuration is easier to audit. |

## Follow-ups

- Per-project and per-tool permissions plus a durable audit log.
- Screenshot/context resource and bridge-backed live collaboration.
- A published `weft` binary so client configuration does not need a repository path.
- Resources/prompts for design previews and agent recipes.
