# MCP server

`weft mcp` exposes the Weft document contract over the Model Context Protocol on **stdio**. It is for local coding agents — pi, opencode, Claude Code, Codex or any MCP-capable client — and does not open a network port.

## Start

```bash
# All designs registered in the workspace allowlist.
weft mcp --workspace ~/.weft/workspace.json

# One design directory only.
weft mcp --design ~/projects/app/designs/app.weft

# Read-only tools.
weft mcp --workspace ~/.weft/workspace.json --read-only
```

`WEFT_WORKSPACE` and the default `~/.weft/workspace.json` are used when `--workspace` is omitted. Stdout is reserved for MCP; logs and startup errors go to stderr.

Example client configuration:

```json
{
  "mcpServers": {
    "weft": {
      "command": "node",
      "args": [
        "/absolute/path/to/Weft/packages/cli/dist/main.js",
        "mcp",
        "--workspace",
        "/home/me/.weft/workspace.json"
      ]
    }
  }
}
```

## Tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `weft_list_designs` | read | List the designs this server is allowed to see. |
| `weft_design_summary` | read | Pages, node counts, tokens, assets and snapshots. |
| `weft_get_page` | read | Full page document by id or exact name. |
| `weft_get_node` | read | One node with page context, ancestors and children. |
| `weft_validate` | read | Validate a design and its files; return issues and summary. |
| `weft_apply_command` | write | Apply one `PageCommand`, write the page atomically, return the inverse. `dryRun` validates without writing. |
| `weft_page_command` | write | Apply `page.create`/`page.remove`/`page.rename`/`page.move`, update manifest/files, return the inverse. `dryRun` validates without writing. |
| `weft_context` | read | Context packet: summary, page, optional node and structural context. |

Every write result includes a `commandId`, `actor` and `inverse`. In `--read-only` mode write tools return `mcp.read-only`.

### Example page command

```json
{
  "designPath": "/home/me/projects/app/designs/app.weft",
  "pageId": "pg_01…",
  "command": {
    "type": "node.update",
    "nodeId": "nd_01…",
    "patch": { "content": "Updated copy" }
  },
  "dryRun": false
}
```

### Example page document command

```json
{
  "designPath": "/home/me/projects/app/designs/app.weft",
  "command": {
    "type": "page.create",
    "page": {
      "format": "weft.page",
      "version": 1,
      "id": "pg_01…",
      "name": "About",
      "nodes": {},
      "children": []
    },
    "file": "pages/about.json"
  }
}
```

Use `weft_list_designs` first to obtain canonical paths. Agents can also use the CLI for the same operations.

## Context packets

`weft_context` returns a JSON packet containing the design summary, a page document, an optional node, ancestor ids and child ids. It is intended for prompt context without handing an agent a shell or a proprietary screenshot.

If the page contains snapshot nodes, the packet includes their source metadata and file references. Captured page text is **untrusted data**; the packet carries a notice and agents must not follow instructions embedded in it.

There is no screenshot tool yet. Use `weft extract` on the CLI to capture a running page, then read the snapshot through the design.

## Security and limits

- The server is stdio-only. It does not listen on TCP.
- In workspace mode, only designs discovered under registered project roots are addressable. A path outside the allowlist returns `design.denied` before the file is read.
- In single-design mode, only that design directory is addressable.
- `--read-only` disables node and page writes.
- Every command reuses the same core validation and inverses as the CLI and browser; commands are parsed as untrusted JSON.
- Write commands are attributed to `{ id: "mcp", kind: "agent", name: "Weft MCP" }`. The actor cannot be supplied per call in this slice.
- There is no per-project permission, per-tool allowlist, durable audit log, rate limit or remote authentication. Run the server with `--read-only` when an agent only needs context.
- The workspace allowlist is loaded at startup; restart the server after registering a new project.
- No MCP resources, prompts, screenshot tool, chat or extraction tool yet.

## Test

```bash
pnpm --filter @weft/mcp test
```

The suite uses an in-memory MCP client/server transport and covers tool discovery, allowlisting, summaries, page/node reads, page command writes and inverses, document command page creation, context packets and read-only enforcement.
