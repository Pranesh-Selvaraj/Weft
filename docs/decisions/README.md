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
    H --> I["0009 · Local bridge<br/>watcher · websocket · persistence<br/>(next)"]
    H --> J["0010 · Agent tool contract<br/>(next)"]
    H --> K["0011 · Snapshot extractor<br/>(next)"]
```

## Adding a record

1. Pick the next number and copy `template.md`.
2. Fill in context, decision, consequences, alternatives, and prior art.
3. Add a row to the index above and update the map if the decision changes relationships.
4. Add a row to `docs/HISTORY.md`.
5. If it supersedes an ADR, update that ADR's status and the `Superseded by` field.
