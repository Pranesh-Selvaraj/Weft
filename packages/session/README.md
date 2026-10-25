# @weft/session

A live, Yjs-backed page session for Weft. It applies the same `PageCommand`s as the CLI and core, materializes canonical page JSON, syncs clients, and ingests whole-page file writes without silently dropping live edits.

## What it does

- **Lives the page.** `PageSession.fromPage(page)` loads a canonical page into a Yjs document.
- **Applies commands.** `session.applyCommand(command)` uses the core command implementation, reconciles the result into Yjs, and returns the inverse.
- **Materializes.** `session.toPage()` returns canonical page JSON from the live state.
- **Syncs.** `encodeStateAsUpdate()`, `applyUpdate()`, and `onUpdate()` expose Yjs updates. Join a second client with `PageSession.fromUpdate(update)`, not by loading the same page twice.
- **Ingests files.** `session.ingestPage(incoming)` performs a three-way merge against the last materialized baseline. Non-conflicting file changes are applied; conflicting fields keep the live value and are returned as `conflicts`.
- **Tracks persistence.** The bridge calls `markMaterialized()` after writing the materialized page. `hasUnpersistedChanges` compares the live state with that baseline.

## Example

```ts
import { PageSession } from "@weft/session";

// Pass tokens/assets when the page references them; materialization validates.
const session = PageSession.fromPage(page, {
  tokens: manifest.tokens,
  assets: manifest.assets,
});

const applied = session.applyCommand({
  type: "node.update",
  nodeId: titleId,
  patch: { content: "Hello from the live session" },
});

// The bridge writes applied.page, then acknowledges it.
session.markMaterialized();

// A remote writer joins from the same Yjs structure.
const peer = PageSession.fromUpdate(session.encodeStateAsUpdate());

// The agent writes the page file from an older base.
const result = session.ingestPage(filePage);
if (result.conflicts.length > 0) {
  // Surface nodes.<id>.<field> conflicts; the live value was kept.
}
```

## How the live state is shaped

```text
Y.Doc
└── page: Y.Map
    ├── format, version, id, name, background, meta
    ├── nodes: Y.Map<nodeId, Y.Map<field, value>>
    │   └── fields except `children`
    └── placement: Y.Map<nodeId, Y.Map<parentId, order>>
```

- Node fields are Y.Map registers, so concurrent edits to different fields on the same node survive.
- `children` arrays are derived at materialization time from `parentId` and a fractional `order` key. There is no `Y.Array` move; moving a node writes two placement fields.
- The canonical file remains the source of truth. Yjs is the live layer; `toPage()` is deterministic.
- `style` is currently one field, so concurrent edits to different sub-fields resolve as one field. Nested maps are a later refinement.

## Merge policy

The file write is merged as `baseline → current` versus `baseline → incoming`:

- a field changed only by the file is applied;
- a field changed only live is kept;
- a field changed differently on both sides keeps the live value and produces a conflict at `nodes.<id>.<field>`;
- a node added only by the file is added; a node added on both sides keeps the live node and conflicts if they differ;
- a node removed by the file is removed only if the live subtree is unchanged; otherwise the live subtree is kept and a conflict is reported;
- child sequences are merged conservatively. If both sides reordered the same parent, the live order wins and a `children.<parent>` conflict is reported. Nodes added on one side are appended rather than dropped.
- The merged page is validated before it is applied. The baseline advances to the materialized result, not the raw incoming file.

## Limitations

- No file watcher or bridge process yet; this package is the reconciliation engine those will use.
- No page-level commands (page name, background, tokens); those still require a direct edit.
- Reorders are conservative; a true sequence CRDT is not used.
- A structural edit regenerates fractional order keys for every child of the affected parent. This is correct but touch-heavy; a later refinement can assign keys only around the move.
- `node.update` style patches are whole-style field merges at the CRDT level.
- No persisted Yjs state, authentication, or remote relay.
- The merge works on top-level node fields; deeply nested `meta`/`style` conflicts are whole-field.

## Test

```bash
pnpm --filter @weft/session test
```

The suite covers round trips, command inverses, structural commands, two-client sync, clean and conflicting file ingest, subtree removal preservation, and persistence tracking.
