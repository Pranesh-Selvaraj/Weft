# 0017 · Direct layout manipulation

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0010, ADR 0014
- **Extended by:** [0019](0019-multi-selection.md) (multi-selection and batch commands)

## Context

Creation tools made the editor able to start a design, but layout still required the inspector. Designers expect to move and resize a selected layer directly on the canvas. Direct manipulation must not introduce a second document model, flood undo history with every pointer move, or fight flex layout silently.

## Decision

### 1. One command per gesture

A move or resize gesture is previewed locally and committed as **one** `node.update` command on pointer release. The command writes the same page file and creates the same inverse as an inspector edit. Undo therefore restores the pre-gesture geometry in one step.

No command is sent when the pointer moves less than one CSS pixel in page coordinates. A click with no drag remains a selection.

### 2. Preview is transient DOM state

During a gesture, the selected node's DOM element receives a temporary CSS `translate` for movement and temporary `width`/`height` for resizing. A lightweight outline shows the new page-space bounds and size. The selection box and handles are hidden while the gesture is active.

The temporary styles are restored on release or cancel. React's page render remains the only canonical renderer; nothing writes CSS or geometry to Yjs or the design file until the final command. If the command fails, the DOM returns to the last materialized page on the next render.

### 3. Geometry and nesting

- Movement adds the pointer delta in page coordinates to the node's local `x`/`y`.
- Resize handles adjust `width`/`height`; west/north handles also adjust local `x`/`y` so the opposite edge stays fixed.
- Width and height are clamped to at least 1 px.
- Nested nodes keep parent-relative coordinates; the pointer delta is the same because the stage transform is the only scale.
- The move command sends only `x`/`y`; the resize command sends `x`, `y`, `width` and `height`.
- Locked nodes do not start a gesture. Static previews do not show handles.

### 4. Handles

The selection overlay has eight resize handles. Their visual size is divided by the current stage scale so they stay roughly 8 screen pixels regardless of zoom. Handles are positioned **inside** the selection bounds rather than centered on the edge, so they are fully clickable while the stage clips its contents.

### 5. Deliberate limits

- One selected node at a time; no multi-select or group transform.
- No aspect-ratio lock, constraints, snapping, smart guides or rotation handle.
- Flex children still receive an `x`/`y` command, but a flex parent may ignore that position; width/height changes can affect flex layout. The document contract is authoritative.
- No inspector lock toggle yet; locked nodes are respected if present in the file.
- No keyboard nudge or drag-to-reorder in the layer tree.

## Consequences

**Easier**

- Moving and resizing feel direct, use the standard command contract and undo in one step.
- The inspector remains available for exact values.
- The page file, bridge, Yjs update and undo path are unchanged.

**Harder, and knowingly accepted**

- Direct DOM preview mutations must be restored and can briefly snap back while the bridge round trip completes.
- Moving a flex child may not visibly move it; a constraints/layout affordance is still needed.
- Resizing text changes its box, not its typography.
- No multi-select means repeated work for several nodes.
- The stage's clipping means nodes dragged outside the page are clipped until page bounds update; negative positions are not fully represented by current page-bound computation.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Send a command on every pointer move** | Floods undo history, file writes and Yjs updates; makes each gesture non-atomic. |
| **Maintain a local optimistic page and reconcile** | A second mutable document model and rollback complexity before the command path has proven insufficient. |
| **Drag only an outline, with no live node movement** | Simpler but noticeably less direct. Transient DOM styles give live feedback without a document mutation. |
| **Use a canvas overlay for all geometry** | Duplicates layout/hit testing and diverges from the DOM renderer. |
| **Implement multi-select and group transform in the same slice** | Multi-selection changes selection state, inspector semantics and command batching; ship single-node direct manipulation first. |
| **Add a separate resize command** | `node.update` already expresses the required geometry and has an inverse. |

## Follow-ups

- Multi-select and batch transforms.
- Snapping, guides, constraints and aspect ratio.
- Keyboard nudge and layer drag reordering.
- Flex-aware movement/resize controls.
- Page rename/reorder and export/handoff.
