# 0026 · Selection scopes and marquee

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0019

## Context

The canvas rendered nested frames, but a single click selected the deepest hit node and there was no way to select several layers with a drag. Figma's mental model is a hierarchy: click selects a layer in the current scope, double-click enters a frame/group, and drag on empty canvas marquee-selects siblings. Weft should adopt that model without changing the document or command contract.

## Decision

### 1. A selection scope

The editor tracks a scope: the page, or a frame/group id.

- With page scope, a click on any descendant selects its top-level page child (for example, clicking Heading selects Hero).
- Double-clicking a node enters its nearest container scope and selects the clicked node. Double-clicking a text layer therefore enters its parent frame and selects the text; double-clicking a frame enters that frame.
- Inside a scope, a click on a descendant selects the direct child of the scope containing it. Clicking the scope frame's own background selects the scope.
- Clicking outside the scope exits to page scope and selects the clicked top-level layer.
- Layer-tree selection sets the scope to the selected node's immediate parent container, so the breadcrumb stays meaningful.
- Escape exits one scope level and selects the scope frame; at page scope it clears selection.
- A breadcrumb in the canvas shows `Page / Frame / …`; clicking a segment changes the scope.

Scope is an interaction lens, not visibility isolation: all layers remain rendered. It changes hit testing and the candidate set for marquee selection.

### 2. Marquee selection

With the Select tool:

- dragging on empty page background starts a marquee with **top-level page children** as candidates;
- dragging on the scope frame's own background selects **direct children of that scope**;
- candidates are measured from rendered DOM boxes and selected when they intersect the marquee;
- Shift adds matches to the current selection; otherwise matches replace it;
- a click without movement clears selection and exits page scope, or selects the scope frame when started on its background;
- the marquee is transient editor chrome and never enters the design file.

The marquee does not auto-scroll the canvas and does not select descendants of a matching container; entering the container scope exposes those descendants.

### 3. Shortcuts and existing transforms

Select-all now selects direct children when a scope is active, otherwise all page nodes. Duplicate uses the existing selection roots. Zoom, layer visibility/lock, group move/resize/delete, align/nudge and undo remain unchanged and operate on the resulting selection.

### 4. Deliberate limits

- No true frame isolation that hides surrounding layers.
- Shift-marquee adds to the current selection; individual add/remove also remains available through modifier clicks and layer rows.
- No marquee autoscroll, lasso, deep-select option, or selecting hidden layers.
- Duplicate IDs are still not auto-selected.
- Scope is per editor session/page transition, not persisted in the design file.

## Consequences

**Easier**

- Canvas selection follows a familiar hierarchy instead of always picking the deepest text node.
- Frames/groups can be entered and inspected with a discoverable breadcrumb.
- Several siblings can be selected with a drag.
- Marquee and scope stay purely client-side; commands and files are unchanged.

**Harder, and knowingly accepted**

- Clicking text no longer selects it directly at page scope; double-click or the layer tree is required.
- Scope and multi-selection can diverge when selecting from the layer tree.
- Hit testing and marquee candidate logic are now more stateful.
- All surrounding layers remain visible, which can still be visually noisy.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Keep deepest-hit selection** | Faster for text editing but unlike the hierarchical canvas model and makes frame selection awkward. |
| **Hide non-scope layers** | True isolation but expensive and surprising with shared layouts; scope-only hit testing is reversible. |
| **Marquee all descendants** | Selects a parent and children together, producing double transforms; direct-child candidates are predictable. |
| **Use document geometry for marquee** | Flex layout means rendered boxes are the visible truth; intersection uses DOM rects. |
| **Persist scope in the file** | View state is not design content and would create unnecessary diffs. |

## Follow-ups

- True isolation mode and autoscroll.
- Shift/Alt marquee modifiers and lasso.
- Deep-select shortcut and hierarchy-aware multi-selection.
- Auto-select duplicated layers.
