# @weft/mcp

Stdio MCP server for Weft. It exposes the existing document contract to coding agents with an explicit design allowlist, read-only mode, shared command validation and inverses.

## Run

```bash
weft mcp --workspace ~/.weft/workspace.json
weft mcp --design ~/projects/app/designs/app.weft
weft mcp --workspace ~/.weft/workspace.json --read-only
```

The server opens no TCP listener. Stdout is reserved for MCP; logs/errors go to stderr. Use a client configuration such as:

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
| `weft_list_designs` | read | The startup allowlist. |
| `weft_design_summary` | read | Summary of pages, nodes, tokens, assets and snapshots. |
| `weft_get_page` | read | Full page JSON by id/name. |
| `weft_get_node` | read | Node with page context, ancestors and children. |
| `weft_validate` | read | Design/file validation issues. |
| `weft_apply_command` | write | One `PageCommand`; write page atomically; returns inverse. `dryRun` supported. |
| `weft_page_command` | write | `page.create`/`page.remove`; shared file transaction; returns inverse. `dryRun` supported. |
| `weft_context` | read | Summary + page + optional node context packet. |

Every write is attributed to `{ id:"mcp", kind:"agent", name:"Weft MCP" }`, includes a command id and returns an inverse. `--read-only` returns `mcp.read-only` for write tools.

## API

`createWeftMcpServer(options)` returns an `McpServer` ready to connect to an in-memory or stdio transport. `runWeftMcpStdio(options)` connects the stdio transport and waits for shutdown. Options:

```ts
interface WeftMcpOptions {
  workspaceFile?: string;
  designDir?: string;
  readOnly?: boolean;
  actor?: CommandActor;
}
```

`loadDesigns` canonicalizes the startup allowlist. Every tool call resolves `designPath` through `realpath` and compares it with that list; anything else returns `design.denied` before reading.

## Security and limits

- Stdio only; no network listener.
- Workspace or single-design allowlist; no arbitrary filesystem reads.
- Read-only mode; fixed actor; commands reuse core parsing/validation/atomic file transactions.
- No per-project/tool permissions, durable audit log, rate limit, remote auth or actor selection per call.
- No MCP resources, prompts, screenshot tool or HTTP transport.
- The allowlist is loaded at startup; restart after registering a project.
- Captured/page text is untrusted data; context packets carry an explicit notice.

See [`docs/mcp.md`](../../docs/mcp.md) and ADR 0016.

## Test

```bash
pnpm --filter @weft/mcp test
```

The suite connects an in-memory MCP client and server, exercises tool discovery, allowlisting, reads, page command writes/inverses, document page creation, context packets, workspace mode and read-only enforcement.
