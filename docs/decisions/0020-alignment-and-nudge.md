# 0020 · Batch alignment and keyboard nudge

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0019

## Context

Multi-selection (ADR 0019) can move and delete a group, but positioning several layers precisely still means dragging or editing the inspector one layer at a time. Common design operations — align edges/centers and nudge by a pixel — should be batch transforms with one inverse and one page write.

## Decision

### 1. Six align operations

The multi-layer inspector exposes left, horizontal center, right, top, vertical middle and bottom alignment. For the selection roots:

- compute absolute page bounds from each node's local geometry plus its ancestor origins;
- derive the new absolute x/y for each node;
- subtract the ancestor origin to produce a local `x`/`y` patch;
- send one `batch` of `node.update` commands.

Alignment is relative to the selected group, not the page. It is disabled for a single layer and while another command is pending. The operation is one undo step.

### 2. Arrow-key nudge

With at least one selected layer and no form field focused:

- Arrow keys move the selection roots by 1 CSS pixel;
- Shift+Arrow moves by 10 CSS pixels;
- one batch of `node.update` commands is sent per key event;
- selection and primary layer are preserved.

Locked roots are skipped. Parent+child selections use the same root filtering as multi-move, so a parent does not receive both its own and a child's delta.

### 3. Flex and layout caveat

`x`/`y` remain the document's authoritative local position, but a flex parent can ignore them during layout. The single-layer inspector and multi-layer inspector show an explicit flex-child warning; alignment/nudge still update the file and still undo, but the rendered result may not move until the layout changes. Width/height and flex properties remain separate future controls.

### 4. Deliberate limits

- No distribute, alignment-to-page, match-size, or equal-spacing tools.
- No undo coalescing across repeated key events; each press is a batch command.
- No rotation-aware bounds; selected geometry is axis-aligned.
- No marquee/range selection.
- Flex-parent constraints and auto-layout editing are not inferred.

## Consequences

**Easier**

- A selection can be aligned or nudged without per-layer inspector edits.
- Every operation uses the existing batch inverse, file write and undo path.
- The flex warning makes a common silent no-op observable.

**Harder, and knowingly accepted**

- Arrow keys are reserved for nudging when the stage is focused, which can conflict with future canvas scrolling.
- Repeated key events produce separate history entries.
- Alignment uses document geometry, not rendered flex positions, and is therefore limited for flex children.
- The multi inspector grows another control row.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Drag-and-snap only** | Imprecise and does not cover keyboard workflows. |
| **Align to the page for a single layer** | Hidden semantics; current inspector already edits x/y directly. |
| **One command per node** | Multiple undo entries and writes. |
| **Browser-only alignment** | Bypasses the command/undo contract. |
| **Distribute in the same slice** | More geometry and ordering rules; align/nudge establish the controls first. |
| **Rewrite flex layout to honor x/y** | Auto-layout is a separate model; forcing absolute positions would break existing designs. |

## Follow-ups

- Distribute horizontally/vertically, match size, align to page/frame.
- Arrow-key coalescing or live nudge preview.
- Flex-aware align/distribute and layout controls.
- Marquee/range selection.
