# 0005. Serializable page commands with inverses for every mutation

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

ADR 0003 defines the document; ADR 0004 gives the first client. Neither says how a mutation is expressed. Without a shared vocabulary the editor would call core functions directly, an agent would rewrite whole files, and undo, attribution, dry-runs, and the future bridge would each invent their own mutation model.

The mission needs mutations that:

- are plain JSON, so an agent can produce them without importing our code;
- apply deterministically to the same document in the CLI, the editor, and the bridge;
- can be inverted, so undo and optimistic UI are possible;
- can carry an author and a timestamp, so agent edits are attributable;
- keep structural invariants (ids, parents, children, cycles) rather than exposing raw array surgery.

Whole-file writes remain valid and necessary. The command protocol is the preferred path when a client is live; file writes remain the coarse fallback for agents that only have filesystem access.

## Decision

### 1. The command union

```ts
type PageCommand =
  | { type: "node.insert"; node: Node; parentId: string | null; index?: number }
  | { type: "node.insertSubtree"; nodes: Node[]; rootId: string; parentId: string | null; index?: number }
  | { type: "node.update"; nodeId: string; patch: NodePatch }
  | { type: "node.replace"; node: Node }
  | { type: "node.move"; nodeId: string; parentId: string | null; index?: number }
  | { type: "node.remove"; nodeId: string }
  | { type: "node.duplicate"; nodeId: string; parentId?: string | null; index?: number };
```

- Commands are scoped to a page. `applyDesignCommand` locates the page by id and leaves the manifest and other pages untouched.
- `node.insert` inserts one leaf or empty container. `node.insertSubtree` inserts a complete subtree atomically; a subtree that references existing nodes, is cyclic, has multiple parents, or is disconnected is rejected.
- `node.update` is a field patch. It cannot rewrite `children`; structural edits use move, insert, remove, or duplicate.
- `node.replace` is deliberately narrow. It restores a whole node for undo or import, refuses to change the node's type, and refuses to reorder children. It is not a general escape hatch around structural commands.
- `node.remove` removes a whole subtree. Its inverse carries the removed nodes and restores them at the original parent and index.

### 2. Apply returns the inverse

`applyPageCommand` and `applyDesignCommand` return:

```ts
interface AppliedCommand {
  page: PageDocument;
  inverse: PageCommand;
  createdNodeIds: string[];
  design?: DesignFile; // applyDesignCommand only
}
```

The inverse is computed from the before state, not stored in the design file. Applying a command and then its inverse restores a byte-identical canonical page; this is verified for every command in the test suite.

Consequences of the inverse model:

- undo/redo is a command stack, not a page snapshot;
- optimistic UI can apply locally and roll back precisely;
- an agent can read the inverse from `weft apply` output and undo its own change;
- the design file stays small and human-readable; inverses never appear in it.

### 3. Untrusted input is parsed, not trusted

`readPageCommand(input)` accepts a JSON value and returns a typed command or throws `WeftCommandError` with a stable code. It checks command type, required ids, node shape, parent types, and index shape. Deeper validation (ids, token refs, geometry ranges, cycles, reachability) happens when operations run and when the resulting design is validated.

`readPageCommand` strips unknown top-level command fields. Node objects are passed through because nodes carry an extensible `meta` area and unknown fields must survive.

### 4. Envelope and attribution

```ts
interface CommandEnvelope {
  id: string;            // cm_ ULID
  pageId: string;
  timestamp: string;     // ISO 8601
  actor?: { id: string; name?: string; kind: "human" | "agent" | "system" };
  command: PageCommand;
}
```

`createCommandEnvelope` generates a `cm_` id and timestamp when the caller does not supply them. The id namespace is reserved in `ids.ts` and validated like any other Weft id.

The envelope is metadata, not part of the document. The bridge and MCP server will persist or stream envelopes for attribution and audit; the design file contains only the resulting nodes.

### 5. CLI surface

The CLI adds three commands:

- `weft apply <dir>` reads `{ pageId, command, actor?, id?, timestamp? }` from `--command <path>` or stdin, applies it, validates the result, and writes atomically. It always prints a JSON result containing the command id, created node ids, the inverse, and the written files. `--dry-run` validates and returns the inverse without writing.
- `weft get <dir> --page <id|name>` prints a page document; `--node <id>` prints the node plus its page id and file. Output is always JSON.
- `weft id [--prefix nd] [--count n]` generates ids for new nodes, pages, assets, designs, or commands.

The CLI is a thin client: it parses, applies, validates, writes, and reports. It does not introduce a second mutation semantics.

## Consequences

**Easier**

- The editor, CLI, and MCP tools can share one mutation vocabulary from the start.
- Undo, dry-runs, attribution, and agent edit previews have a common foundation.
- Agents can make small, validated edits instead of rewriting a page and hoping validation passes.
- The bridge can later apply the same commands into a CRDT and materialize the same canonical files.
- Tests can prove command/inverse round trips without a browser.

**Harder, and knowingly accepted**

- A command can be large: `node.insertSubtree` carries a whole subtree, and the inverse of a removal carries the removed subtree. This is acceptable for design-sized edits and will be bounded before the bridge lands.
- There is no optimistic concurrency yet. `weft apply` is a read-modify-write over files; two simultaneous applies, or an apply racing a direct file edit, can lose the later write. The bridge's file/CRDT reconciliation is the next decision, and command envelopes are the base it will use.
- Page-level changes (page name, background, tokens) are still file edits. A `page.update` command can be added when the editor needs it; it is deliberately out of this slice.
- The inverse of a large subtree removal is large. If this becomes a problem, inverses can become references into an operation log; the command shape does not change.
- There is no persisted command log or undo stack in the file. The CLI returns inverses to the caller; the editor will own its stack; the bridge will own audit.
- Command JSON is specified in TypeScript and the runtime parser, not yet in a published JSON Schema. Publishing it is part of the contract work that follows.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **JSON Patch (RFC 6902) as the only command format** | Precise and standard, but it operates on JSON paths rather than design structure. A move becomes two array splices, cycles and parentage are not guarded, and attribution/undo semantics are left to the caller. It is a useful low-level fallback later, not the primary API. |
| **Whole-file writes only** | Simple for agents, but every edit rewrites a page, conflicts are coarse, and there is no way to attribute or undo a specific change. It remains supported as a fallback, not the default for a live client. |
| **Direct core function calls** | Not serializable across a process or an MCP tool boundary, and not usable by an agent that only has JSON. |
| **Store inverses in the design file** | Bloats the durable document with transient history and makes every edit touch unrelated data. Inverses belong in memory, an operation log, or the response to the caller. |
| **Event sourcing with an append-only command log as the canonical file** | Excellent audit and replay properties, but it changes the durable artifact from a readable design to an event stream and makes direct agent review harder. The JSON document remains canonical; commands are the live API. |
| **CRDT operations as the public API** | Ties agents and the CLI to one CRDT implementation and exposes low-level structure. Commands are the semantic layer; the bridge can translate them into CRDT updates. |

## Prior art / what this replaces

There was no earlier mutation protocol. This decision turns the pure operations from ADR 0003 into a serializable API and gives the CLI its editing surface. It is the layer the editor and bridge will share, and the piece that makes “an agent can edit a design” a concrete, testable claim rather than a description.
