# Documentation

Start here, then follow the decision records for the reasoning.

| Document | What it answers |
| --- | --- |
| [Product definition](product.md) | Who Weft is for, what it must do, what we deliberately do not do, and the exit criteria for the first version. |
| [Architecture](architecture.md) | How the system is shaped: components, document model, real-time layer, agent surface, rendering, extraction, and risks. |
| [CLI](cli.md) | Commands, JSON output, exit codes, and how agents should use the headless client. |
| [Structural contract](../packages/contract/README.md) | The published JSON Schema, conformance fixtures, and the structural/semantic boundary. |
| [Live session](../packages/session/README.md) | The Yjs page model, command application, sync, and file-write merge policy. |
| [Browser editor](../apps/web/README.md) | The Vite/React app, live editing, and `WEFT_DESIGN`. |
| [Renderer](../packages/render/README.md) | The DOM renderer API, supported styles, and limits. |
| [Local bridge](../packages/bridge/README.md) | `weft dev`, the HTTP/WebSocket protocol, and live reload semantics. |
| [Local workspace](local-workspace.md) | How a local instance discovers and interacts with other registered projects and running apps. |
| [Declared dev servers](dev-server.md) | Project config, managed/attach mode, readiness, logs, process lifecycle and the security boundary. |
| [Snapshot extraction](extraction.md) | Capture allowlists, browser setup, sanitization, asset inlining, snapshot files and prompt-injection limits. |
| [MCP server](mcp.md) | `weft mcp`, client configuration, tools, allowlisting, context packets and read-only mode. |
| [Static export](export.md) | `weft export`, output layout, rendered content, handoff metadata and limits. |
| [Security model](security.md) | Threat model, current controls, known gaps, and the security branch order. |
| [Decision records](decisions/README.md) | What we chose, why, what we rejected, and what it costs. |
| [Project history](HISTORY.md) | The timeline linking eras, stack changes, and decisions. |
| [Changelog](../CHANGELOG.md) | What shipped, in user-facing prose. |

## Reading order for a new contributor

1. The [README](../README.md) for the pitch and the name.
2. [Product definition](product.md) for the target.
3. [ADR 0002](decisions/0002-design-files-as-plain-text.md) for the decision that shapes the whole system.
4. [ADR 0003](decisions/0003-document-schema-v1.md) for the concrete file, node and serialization model.
5. [ADR 0004](decisions/0004-headless-cli-and-design-io.md) for the headless-first tooling boundary.
6. [ADR 0005](decisions/0005-command-protocol.md) for the mutation API and inverse-based undo.
7. [ADR 0006](decisions/0006-published-json-schema.md) for the published structural contract.
8. [ADR 0007](decisions/0007-yjs-live-sessions.md) for the live session and file-write merge.
9. [ADR 0008](decisions/0008-editor-stack-dom-renderer.md) for the stack and DOM renderer.
10. [ADR 0009](decisions/0009-local-bridge-live-preview.md) for the local live bridge.
11. [ADR 0010](decisions/0010-editor-interaction.md) for selection, the inspector and undo.
12. [ADR 0011](decisions/0011-bridge-security-boundary.md) for the bridge loopback/cookie/Origin boundary.
13. [ADR 0012](decisions/0012-declared-dev-servers.md) for declared project dev servers.
14. [ADR 0013](decisions/0013-snapshot-extraction.md) for snapshot extraction and its sanitization boundary.
15. [ADR 0014](decisions/0014-editor-create-tools.md) for creation tools and the layer tree.
16. [ADR 0015](decisions/0015-page-document-commands.md) for page-level document commands.
17. [ADR 0016](decisions/0016-agent-mcp.md) for the agent MCP contract.
18. [ADR 0017](decisions/0017-direct-manipulation.md) for direct move/resize manipulation.
19. [ADR 0018](decisions/0018-page-organization.md) for page rename and reorder.
20. [ADR 0019](decisions/0019-multi-selection.md) for multi-selection and batch commands.
21. [ADR 0020](decisions/0020-alignment-and-nudge.md) for batch alignment and keyboard nudge.
22. [ADR 0021](decisions/0021-multi-resize.md) for combined multi-selection resize.
23. [ADR 0022](decisions/0022-static-export.md) for static HTML export.
24. [Architecture](architecture.md) for the implementation shape.
25. [Security model](security.md) for the trust boundaries and hardening.
26. [Local workspace](local-workspace.md) for the project registry, picker and dev-server model.
27. [Declared dev servers](dev-server.md) to declare and run a project server.
28. [Snapshot extraction](extraction.md) to capture a running page.
29. [MCP server](mcp.md) to connect a coding agent.
30. [Static export](export.md) to hand off a design as HTML.
31. [CLI](cli.md) to run, inspect, edit, extract and export designs.
32. [Browser editor](../apps/web/README.md) to open and edit the starter design.
33. [ADR index](decisions/README.md) to see which decisions are settled and which are still open.
