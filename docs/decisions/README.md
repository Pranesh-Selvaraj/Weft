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

## Decision map

```mermaid
graph TD
    A["0001 · Name: Weft"] --> B["0002 · Plain-text design files"]
    B --> C["0003 · Schema and operations<br/>(next)"]
    B --> D["0004 · Editor stack and renderer<br/>(next)"]
    B --> E["0005 · Bridge and file reconciliation<br/>(next)"]
    C --> F["0006 · Agent tool contract<br/>(next)"]
    B --> G["0007 · Snapshot format and extractor<br/>(next)"]
```

## Adding a record

1. Pick the next number and copy `template.md`.
2. Fill in context, decision, consequences, alternatives, and prior art.
3. Add a row to the index above and update the map if the decision changes relationships.
4. Add a row to `docs/HISTORY.md`.
5. If it supersedes an ADR, update that ADR's status and the `Superseded by` field.
