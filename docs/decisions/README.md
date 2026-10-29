# Decision records

This directory is the project's long-form memory: **what we chose, why, what we tried before, what broke, and why we changed.**

`CHANGELOG.md` records what shipped to users. An Architecture Decision Record (ADR) records *why the product is built this way* and whether that reasoning still holds. `docs/HISTORY.md` is the timeline that ties the two together.

## Rules

- One decision per file, named `NNNN-short-title.md`. Numbers are assigned once and are never reused or renumbered.
- Status is one of `Proposed`, `Accepted`, `Rejected`, `Deprecated`, `Superseded by NNNN`.
- To change a decision, **add a new ADR** that supersedes it. Set the old record's status to `Superseded by NNNN`; never delete or rewrite it.
- Write for a reader who joins in two years: context, the decision, consequences (including the bad ones), the alternatives, and why they lost.
- When a decision is revisited, say explicitly what was wrong with the previous choice.
- Security-relevant decisions (sandboxing captured pages, agent permissions, sync transport) also update `SECURITY.md` where behaviour changes.

## Index

| ADR | Title | Status | Area |
| --- | --- | --- | --- |
| [0001](0001-project-name.md) | Project name: Weft | Accepted | Identity |
| [0002](0002-design-files-as-plain-text.md) | Design files are plain-text, agent-readable documents | Accepted | Document model |
| [0003](0003-document-schema-v1.md) | Document schema v1: flat nodes, deterministic JSON, captured pages beside the tree | Accepted | Document model |
| [0004](0004-headless-cli-and-design-io.md) | Headless CLI and design I/O before the editor | Accepted | Tooling |
| [0005](0005-command-protocol.md) | Serializable page commands with inverses for every mutation | Accepted | Contract |
| [0006](0006-published-json-schema.md) | Published JSON Schema and a conformance fixture suite | Accepted | Contract |
| [0007](0007-yjs-live-sessions.md) | Yjs live sessions with fractional order and conservative file-write merge | Accepted | Live document |
| [0008](0008-editor-stack-dom-renderer.md) | Editor stack v1: Vite + React + a DOM-first renderer | Accepted | UI / rendering |
| [0009](0009-local-bridge-live-preview.md) | Local bridge: watched files, HTTP, and Yjs over WebSocket | Accepted | Live transport |
| [0010](0010-editor-interaction.md) | Editor interaction: selection, inspector, and commands over the bridge | Accepted | UI / editing |
| [0011](0011-bridge-security-boundary.md) | Local bridge security boundary | Accepted | Security |
| [0012](0012-declared-dev-servers.md) | Declared project dev servers | Accepted | Local workspace |
| [0013](0013-snapshot-extraction.md) | Snapshot extraction | Accepted | Capture / security |
| [0014](0014-editor-create-tools.md) | Editor creation tools and layer tree | Accepted | UI / editing |
| [0015](0015-page-document-commands.md) | Page-level document commands | Accepted | Contract / document model |
| [0016](0016-agent-mcp.md) | Agent MCP contract | Accepted | Agent surface |
| [0017](0017-direct-manipulation.md) | Direct layout manipulation | Accepted | UI / editing |
| [0018](0018-page-organization.md) | Page organization | Accepted | Contract / UI |
| [0019](0019-multi-selection.md) | Multi-selection and batch commands | Accepted | Contract / UI |
| [0020](0020-alignment-and-nudge.md) | Batch alignment and keyboard nudge | Accepted | UI / editing |
| [0021](0021-multi-resize.md) | Combined multi-selection resize | Accepted | UI / editing |
| [0022](0022-static-export.md) | Static HTML export and handoff | Accepted | Export / handoff |

## Decision map

```mermaid
graph TD
    A["0001 · Name: Weft"] --> B["0002 · Plain-text design files"]
    B --> C["0003 · Document schema v1<br/>flat nodes · deterministic JSON"]
    C --> D["0004 · Headless CLI + design I/O<br/>init · validate · fmt · inspect"]
    C --> E["0005 · Command protocol<br/>apply · inverse · attributed edits"]
    E --> F["0006 · JSON Schema + conformance<br/>structural contract"]
    F --> G["0007 · Yjs live session<br/>fractional order · file merge"]
    G --> H["0008 · Editor stack + DOM renderer<br/>Vite · React · read-only preview"]
    H --> I["0009 · Local bridge<br/>watcher · HTTP · WebSocket"]
    I --> J["0010 · Editor interaction<br/>selection · inspector · undo"]
    J --> K["0011 · Bridge security boundary<br/>loopback · cookie · origin"]
    K --> L["0012 · Declared dev servers<br/>argv · readiness · process group"]
    L --> M["0013 · Snapshot extraction<br/>allowlist · sanitize · sandbox"]
    M --> N["0014 · Editor creation tools<br/>tools · layer tree · insert command"]
    N --> O["0015 · Page document commands<br/>create · remove · inverses"]
    O --> P["0016 · Agent MCP contract<br/>stdio · allowlist · tools"]
    P --> Q["0017 · Direct manipulation<br/>move · resize · one command"]
    Q --> R["0018 · Page organization<br/>rename · reorder"]
    R --> S["0019 · Multi-selection<br/>batch commands"]
    S --> T["0020 · Alignment + nudge<br/>batch transforms"]
    T --> U["0021 · Multi-resize<br/>combined bounds"]
    U --> V["0022 · Static HTML export<br/>handoff · tokens · no scripts"]
```

## Adding a record

1. Pick the next number and copy `template.md`.
2. Fill in context, decision, consequences, alternatives, and prior art.
3. Add a row to the index above and update the map if the decision changes relationships.
4. Add a row to `docs/HISTORY.md`.
5. If it supersedes an ADR, update that ADR's status and the `Superseded by` field.
