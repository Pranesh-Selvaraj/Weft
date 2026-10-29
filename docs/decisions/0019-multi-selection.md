# 0019 · Multi-selection and batch commands

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Contract / UI
- **Extends:** ADR 0010, ADR 0017

## Context

Direct manipulation (ADR 0017) operates on one selected layer. Design work routinely needs to move or remove several layers together. Sending one command per node would make a single gesture produce many undo entries and many page writes, while a browser-only batch would bypass the command/validation contract.

## Decision

### 1. A batch page command

`PageCommand` gains:

```ts
{ type: "batch"; commands: PageCommand[] }
```

A batch applies its commands sequentially to the in-memory page. Its inverse is a batch of the individual inverses in reverse order. Batch commands cannot be nested and are capped at 200 entries. The same parser, bridge, CLI and MCP surfaces accept batches.

A batch either applies completely or throws without returning a page; callers do not write a partial result. The bridge still writes one page file and returns one inverse, so undo is one step.

### 2. Selection set with a primary layer

The editor keeps a `Set` of selected node ids and a primary id. Non-additive click replaces the selection; Shift/Cmd/Ctrl-click toggles membership. Layer-tree clicks use the same modifier behavior. The primary layer drives the existing single-layer inspector; multi-selection replaces it with a compact "N layers" panel listing the members and offering Delete/Clear.

Selection is kept in sync with the page: removed or externally deleted nodes are dropped, and a new selection becomes primary.

### 3. Multi-layer gestures

- Dragging any selected layer moves the **selection roots** (selected nodes whose ancestor is not also selected) by a shared page-space delta. Moving both a frame and its child only moves the frame, avoiding double movement.
- The move commits as one batch of `node.update` commands; the transient DOM preview and restore behavior match single-layer drag.
- Delete removes the selection roots as one batch of `node.remove` commands.
- Multi-selection shows individual dashed selection outlines and no resize handles. A single selection keeps the eight resize handles.
- Selection boxes are DOM-measured like single selection; transform previews use the combined bounds and are hidden behind the same transient gesture handling.

### 4. Deliberate limits

- No multi-layer resize, rotation, alignment tools, group creation, marquee selection, or cross-page selection.
- No range selection in the layer tree (Shift-click toggles, it does not select a contiguous range).
- Batch commands are capped and non-nested; undo is per batch, not per sub-command.
- A batch is atomic in memory but the page write is still one file write; the filesystem transaction model is unchanged.
- Flex layout can ignore a movement command for selected children; the document remains authoritative.

## Consequences

**Easier**

- Several layers can be moved or deleted together with one undo step and one page write.
- Selection modifiers work consistently on canvas and layer tree.
- Multi-selection exposes the same command contract to agents/CLI without a separate bulk API.
- Batch inverses compose with existing history and bridge rollback.

**Harder, and knowingly accepted**

- The selection set and primary id must be reconciled after every page/init change.
- Batch inverse payloads can be larger than single commands; the WebSocket payload cap applies.
- Resize/rotation still require one layer at a time.
- The multi-selection inspector is informational rather than a batch property editor.
- Parent+child selections require root filtering, which is explicit and testable but easy to forget in future transforms.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Send N independent commands** | N undo entries, N file writes and N Yjs broadcasts for one gesture. |
| **Client-side batch in Yjs only** | Bypasses canonical validation, file writes and inverses. |
| **A bridge-only batch endpoint** | Duplicates the command contract and leaves CLI/MCP behind. |
| **Multi-resize in the same slice** | Combined bounding-box scaling with nested/flex nodes is a separate layout problem. |
| **Marquee selection** | Useful but larger; modifier selection and layer-tree selection establish the model first. |

## Follow-ups

- Multi-resize, alignment/distribution, marquee selection and group creation.
- Range selection in the layer tree.
- Batch property editing.
- A keyboard nudge for selections.
