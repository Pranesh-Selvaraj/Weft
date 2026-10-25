# 0007. Yjs live sessions with fractional order and conservative file-write merge

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

ADR 0002 makes JSON files canonical; ADR 0005 makes commands the mutation API. Neither decides what a live, concurrent page looks like, or what happens when an agent writes the whole file while a person is editing.

This is the riskiest part of the system. The failure mode is silent: a whole-file write from an agent and a live human edit both look successful, but one overwrites the other. The design has to make that failure either impossible or visible. It also has to keep the canonical file deterministic and free of CRDT internals.

The constraints:

- browser and Node must share one session implementation;
- commands from the CLI, editor and future bridge must apply to the same live state;
- two writers must converge without duplicating nodes or losing edits;
- a file write from an agent must merge with live changes, not blindly replace them;
- conflicts must be reportable and must never be resolved by dropping a node silently;
- the durable file must remain readable JSON with no Yjs metadata.

## Decision

### 1. A page session is a Yjs document

`@weft/session` owns `PageSession`. Each page has one `Y.Doc`:

```text
Y.Doc
└── page: Y.Map
    ├── format, version, id, name, background, meta
    ├── nodes: Y.Map<nodeId, Y.Map<field, value>>
    └── placement: Y.Map<nodeId, Y.Map<parentId, order>>
```

- Node fields are individual Y.Map registers. Concurrent edits to different fields on the same node survive. The `children` field is not stored.
- Parent and sibling order live in a separate placement map. Order values are fractional keys from `fractional-indexing`. A move updates `parentId` and `order`; there is no `Y.Array` move operation to conflict with.
- Materialization groups nodes by parent, sorts by order with a stable id tie-break, and derives `children` arrays and the page `children` list.
- The canonical file remains the durable artifact. Yjs state is never written into it.

### 2. Commands are applied through the core, then reconciled

`PageSession.applyCommand`:

1. materializes the current page;
2. applies the command with the same `applyPageCommand` used by the CLI;
3. reconciles the before/after pages into Yjs: changed node fields are set, added/removed nodes are added/removed, and changed child sequences receive new placement orders;
4. verifies that materialization equals the command result;
5. returns the canonical page plus the core-computed inverse.

The reconciliation is one Yjs transaction. It does not reimplement command semantics; the core remains the authority.

A command changes live state, not necessarily the file. The bridge calls `markMaterialized()` after it writes the materialized page. This keeps the file-write baseline honest.

### 3. Clients join the same Yjs structure

`encodeStateAsUpdate`, `applyUpdate`, and `onUpdate` expose the Yjs sync surface. A second client must join with `PageSession.fromUpdate(update)` rather than loading the same canonical page independently: independently created nested Y.Maps would resolve as competing map values instead of deep-merging.

### 4. File writes are a three-way merge

`PageSession.ingestPage(incoming)` merges:

- `baseline` — the page as last materialized to the file;
- `current` — the live page;
- `incoming` — the whole-page file write.

The merge works on page fields, node top-level fields, parent, and child sequences:

- field changed only in the file → apply it;
- field changed only live → keep it;
- field changed differently on both sides → keep the live value and report `nodes.<id>.<field>` (or the page field) as a conflict;
- node added only in the file → add it;
- node added on both sides → keep the live node; conflict if they differ;
- node removed by the file → remove only if the live subtree is unchanged; otherwise keep the live subtree and report a conflict;
- child order changed only on one side → take that side; changed differently on both → keep the live order and report `children.<parent>`; nodes added on either side are appended rather than dropped;
- a child whose parent was removed or is no longer a container is reattached to the root and reported.

The merged page is validated. The baseline advances to the **materialized result**, not the raw incoming file, so later write conflicts are measured against what was actually accepted.

The merge is deliberately conservative. It can choose the live order when both sides reordered, but it never drops a live subtree to satisfy an incoming file. A conflict list is returned for the bridge or UI to surface.

### 5. The session is policy, not transport

The package contains no file watcher, HTTP server, websocket relay, authentication, or persistence. It is the engine the bridge will use. That keeps the browser, CLI and headless tests on the same reconciliation semantics.

## Consequences

**Easier**

- Real-time editing and whole-file agent writes can coexist without silent last-writer-wins at the page level.
- The same commands from the CLI and the future editor apply to the live document.
- Two clients converge when they share the initial Yjs structure; commands retain inverses.
- File writes are merged at node-field granularity, and conflicts are explicit.
- The canonical file stays deterministic: no CRDT fields, no order keys, no merge metadata.
- The session is browser-safe and Node-testable, with no server dependency.

**Harder, and knowingly accepted**

- Yjs is now a runtime dependency of the session layer (not of the core or CLI). That is the cost of live collaboration.
- `style` is one Y.Map field, so concurrent edits to different style sub-fields resolve as a whole field. Nested maps are a later refinement.
- Structural edits regenerate fractional order keys for every child of an affected parent. This is correct and keeps moves simple, but it touches more state than necessary. A later version can allocate keys only around the moved node.
- The merge is conservative and can report a conflict where a more sophisticated sequence CRDT would merge cleanly. It never silently drops a live subtree.
- A live page can be invalid in the middle of a multi-command sequence; the session throws rather than materializing an invalid page. The editor must apply commands one at a time or batch them into a valid transaction.
- There is no persisted Yjs state, file watcher, relay, auth, or remote transport yet. Those are the bridge's responsibility.
- Page-level changes (name, background, tokens) still require direct file editing; there is no page command yet.
- The merge works on top-level node fields. Deeply nested `meta`/`style` merges are whole-field.
- The baseline is explicit policy: a command that has not been written to a file is still a live difference. The bridge must call `markMaterialized` after writing.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Replace the whole page map in Yjs on every command** | Simple, but concurrent edits to different nodes or fields on the same node are lost as whole-map last-writer-wins. |
| **Use `Y.Array` for children** | Natural for ordering, but Yjs has no atomic move. A concurrent move can duplicate or lose nodes; fractional parent/order keys avoid the problem. |
| **Automerge or Loro instead of Yjs** | Both are credible, and Loro's movable tree is attractive. Yjs is mature, browser-first, has awareness and IndexedDB tooling, and the session boundary keeps the choice replaceable. A later spike can compare them; changing CRDT now would add a library and a new conformance surface without addressing a measured failure. |
| **Last-writer-wins on the whole file** | Simple and predictable for a single writer, unacceptable for live collaboration. It is exactly the silent data loss this record exists to prevent. |
| **A command log as the only live state** | Replay is attractive, but every materialization becomes a full replay and the file stops being the simple canonical artifact. Commands are the API; Yjs is the live projection. |
| **Server-authoritative operational transform (the Figma model)** | Requires a central server for every edit, contradicts local-first, and makes offline and single-user work harder. |
| **JSON Patch applied to Yjs** | Low-level array splices do not carry design semantics (parent, order, subtree) and cannot produce a reliable inverse. Domain commands plus a field-level reconcile are clearer. |
| **Silently choosing the incoming file on conflict** | The agent's write would win and the human's live work would disappear. Keeping the live value and reporting the conflict is the only safe default. |

## Prior art / what this replaces

There was no live session or reconciliation engine before this record. The command protocol made mutations serializable; this record makes them live and gives file writes a merge policy. The next pieces — the editor and the local bridge — consume this package rather than inventing their own concurrency rules.
