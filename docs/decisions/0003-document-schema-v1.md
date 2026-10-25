# 0003. Document schema v1: flat nodes, deterministic JSON, captured pages beside the tree

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

ADR 0002 settled that the durable design is plain text and that the live CRDT is a cache. It did not say what the text contains. That shape determines almost everything that follows: how an agent reads one node, how a diff looks in review, how the bridge reconciles a whole-file write with a live edit, how a captured page stays faithful, and how much of the schema has to be taught to every future tool.

The constraints for v1:

- a person or an agent must be able to change one node without loading or rewriting an unrelated part of the design;
- diffs must be small enough to review, and identical logical documents must produce identical bytes;
- the browser editor, the CLI, the MCP server and the bridge must share one model, not four dialects;
- captured product pages must keep their real markup and CSS rather than being approximated as native nodes;
- the schema must express the first milestone (frames, text, rectangles, images, captured pages, tokens) without pretending to be a mature vector editor;
- the core must be usable in a browser and in Node, with no runtime dependency that constrains either.

## Decision

### 1. A design is a directory

```text
design.weft/
├── weft.json              # manifest: format, id, name, pages, tokens, assets, meta
├── pages/
│   └── landing.json       # one page document
├── snapshots/
│   ├── nd_….html          # sanitized capture payload
│   └── nd_….css           # optional scoped styles
└── assets/
    └── ….svg              # binary assets referenced by id from the manifest
```

- The manifest is small, central metadata. Page documents are separate so editing one page cannot conflict with another.
- A page is one ordered tree of nodes plus page-level background and metadata.
- Asset files are referenced from the manifest by id and a relative path. They are never base64 inside page JSON.
- Snapshot payloads are files beside the page, not strings inside it, so a page diff stays readable and an agent can open the captured HTML directly.
- All paths are relative to the design directory, slash-separated, and validated to prevent escapes.

### 2. Nodes are a flat map linked by id

```json
{
  "format": "weft.page",
  "version": 1,
  "id": "pg_01JAV3Q8ZK4M2TP9W6XH5NR7BD",
  "name": "Landing",
  "children": ["nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE"],
  "nodes": {
    "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE": {
      "id": "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
      "type": "frame",
      "name": "Hero",
      "x": 0,
      "y": 0,
      "width": 1440,
      "height": 900,
      "children": ["nd_01JAV3Q8ZK4M2TP9W6XH5NR7BF"]
    }
  }
}
```

- `nodes` is a map keyed by node id. `page.children` is the ordered list of roots; a frame or group carries the ordered list of its own children. A node may appear at most once in the design.
- Parent links are derived, never stored. Storing both directions invites drift and makes every move a two-source-of-truth problem.
- Ids are prefixed ULIDs (`nd_…`). They are opaque, stable through renames and moves, globally unique across a design, and sortable by creation time.
- Ids are never positional and never derived from a name. That is what lets an agent address a node without reading the whole page.
- Node types in v1: `frame`, `group`, `text`, `rect`, `ellipse`, `image`, `snapshot`. Components, instances, vector paths, boolean operations, and constraints are deliberately absent.

### 3. Geometry, layout, style

- Every node has `x`, `y`, `width`, `height` in CSS pixels relative to its parent, plus optional `rotation`.
- Layout is optional and explicit: `{ mode: "absolute" }` or a small flex model (`direction`, `gap`, `padding`, `align`, `justify`, `wrap`). The renderer maps flex to CSS flex, so the browser remains the layout engine.
- Style is a shallow object: `fills`, `strokes`, `strokeWidth`, `strokeAlign`, `radius`, `opacity`, `shadows`, `blur`, `font`.
- Paints are `solid`, `linear-gradient`, or `image`; text is real text (`content`), never outlines; images reference manifest asset ids.
- Any color string may be a token reference using `{path.to.token}`. Tokens live in the manifest as a tree of strings and numbers and are resolved by path. Fill colors are not fully CSS-parsed in v1; literal strings are passed through, token references are resolved and type-checked when tokens are available.
- Unknown fields are allowed everywhere and survive a read/write round trip, so a newer tool can add data without an older tool destroying it.

### 4. Captured pages are explicit, sandboxed leaves

- A `snapshot` node stores `source` metadata (URL, optional selector, viewport, capture time, optional commit) and `files` (relative paths to sanitized HTML and optional scoped CSS).
- A snapshot is a fidelity artifact, not a native subtree. It renders in a sandboxed iframe with scripts disabled and no same-origin access.
- Annotations on a captured page are a later schema addition. Converting a captured region into native nodes is an explicit operation; it is never an implicit approximation.

### 5. Serialization is deterministic

The canonical writer:

- sorts object keys, preserves array order;
- rounds numbers to three decimals, half away from zero, and normalizes `-0` to `0`;
- omits `undefined` object properties;
- throws on values JSON cannot represent (NaN, Infinity, bigint, functions, class instances, cycles) instead of silently dropping them;
- writes two-space-indented JSON with one trailing newline.

Identical logical documents therefore produce identical bytes. That is what makes git diffs trustworthy and lets the bridge distinguish a real external change from a serialization wobble.

### 6. Validation is a first-class, dependency-free pass

- `validateManifest`, `validatePage`, and `validateDesign` return typed issues with a path, a stable code, and a prose message. `assertValid*` throws a `WeftValidationError` carrying the issues.
- Validation checks envelopes, ids, ranges, enums, child references, cycles, reachability, duplicate parents, token references, asset references, snapshot metadata, unsafe paths, and design-level consistency between manifest page entries and page documents.
- Node ids are unique across the whole design, not just within a page.
- Validation does not strip unknown fields. It accepts them by design.
- The validator is hand-written rather than generated from Zod or JSON Schema. This keeps the core dependency-free and the error messages under our control; it is also maintenance we accept for now.

### 7. Operations are pure functions over pages

`packages/core` implements `createNode`, `insertNode`, `insertSubtree`, `moveNode`, `reorderNode`, `removeNode`, `duplicateNode`, and `updateNode`. They return a new page and never mutate the input.

- A subtree insertion is atomic and must be complete: external references, cycles, multiple parents, duplicate children, dangling ids, and orphans are rejected.
- Deletion removes the whole subtree. There is no mode that leaves orphaned children.
- Duplication deep-copies with fresh ids and preserves content, style, and structure.
- `updateNode` merges a style patch one level deep, replaces layout/meta/source/files, accepts `null` to clear optional values, rejects unknown patch fields, and refuses type-specific fields on the wrong node type.
- `updateNode` cannot rewrite `children`; structural changes go through insert, move, and remove so the tree cannot be corrupted by a convenience patch.
- The core does not touch the filesystem. Reading and writing design directories belongs to the CLI and bridge, where paths, atomic writes, and conflict handling can be implemented once.

### 8. Versioning

- The manifest and every page carry a format version (`1`).
- Additive, unknown fields do not require a version bump.
- Breaking changes bump the version and ship a migration. Old files are never silently reinterpreted.
- The schema is defined in TypeScript in `packages/core/src/types.ts`; the design file is the API.

## Consequences

**Easier**

- An agent can read one node by id, or one page, without parsing a nested tree. It can write a small targeted diff.
- Git review shows a changed node rather than a rewritten document, because ids and per-page files localize the change.
- The editor, CLI, MCP server and bridge can share a pure, tested model with no runtime dependencies.
- Captured pages keep the real DOM and CSS, while native frames stay small and implementable.
- Deterministic serialization makes diffs meaningful and makes file/CRDT reconciliation tractable.
- The starter example is small enough to read end to end and is validated in CI.

**Harder, and knowingly accepted**

- Every operation shallow-copies the node map, so it is O(nodes) per edit. This is fine at the current scale and must be profiled before large documents; the editor will eventually use a mutable or CRDT-backed store and apply the same operations.
- The hand-written validator is code we own: new fields need validation, tests, and messages. If it starts to sprawl, generated validation can be revisited.
- Global node-id uniqueness means moving a subtree between designs must allocate new ids. That is the cost of addressability across a design.
- Token references are stringly typed. A typo is caught at validation, not at the type level, and only colors are resolved today.
- Snapshots are second-class by design: they are not editable native nodes, and annotations are not in the schema yet.
- The flex model is a useful subset, not Figma auto-layout. Constraints, hug/fill sizing, and baseline behavior arrive later.
- The schema has no components, instances, vector paths, boolean operations, prototyping, variables/modes, comments, or permissions yet. Those are product decisions, not accidental omissions.
- Snapshot payload size lives in HTML/CSS files, so the file watcher and bridge must track more than JSON. Shared snapshot payloads are allowed and are not deduplicated yet.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Nested node tree in the page JSON** | Natural to render and to read as a whole, but every move rewrites ancestor arrays, a one-node edit produces an unfocused diff, and an agent must know the path to a node. The flat map trades top-to-bottom readability for addressability, which is the product's point. |
| **Parent pointers stored on each node as well as children arrays** | Two representations of one fact drift, especially under concurrent writes. Parent lookup is cheap to derive; correctness is not. |
| **One file per node** | Best possible diff locality, but thousands of tiny files, expensive directory walks, and painful review. Page-level files are the right granularity. |
| **Inline snapshot HTML and CSS in the page JSON** | Keeps a page self-contained but bloats diffs, ruins review of unrelated changes, and makes the captured markup hostile to read. Separate files win for both humans and agents. |
| **HTML/CSS as the whole document format** | Faithful and immediately implementable, but it cannot carry design semantics (components, tokens, layout intent, stable ids) without inventing a proprietary schema hidden inside HTML, and generated markup diffs worse than structured nodes. Snapshots are the deliberate exception. |
| **Zod or JSON Schema for validation** | Generates a second schema language, adds a runtime dependency to a core that must run anywhere, and still needs cross-field checks (cycles, reachability, global ids). Hand-written validation is more code but one source of truth; this can be revisited if the schema grows much larger. |
| **Store style values as CSS strings** | Compact and familiar, but impossible to validate, query, or translate reliably into an editor UI. Structured paints with token references keep the values inspectable. |
| **Base64 assets inside JSON** | Self-contained and simple, but bloats diffs, defeats git LFS and browser caching, and turns binary review into noise. |
| **A CRDT binary as the page file** | Already rejected in ADR 0002: unreviewable, unreadable by agents, and tied to one implementation. |

## Prior art / what this replaces

There is no earlier Weft schema. This is the first implementation of the ADR 0002 bet, and it is deliberately small: the schema exists to prove that a browser canvas, a live agent, and a git history can share one design without a proprietary server. The known gaps above are the roadmap, not an apology.

The implementation of this record lives in `packages/core`, with the starter design in `examples/starter.weft/` and the validation, operation, serialization, and fixture test suites under `packages/core/test/`.
