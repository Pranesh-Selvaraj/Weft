# 0014 · Editor creation tools and layer tree

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0010
- **Extended by:** [0015](0015-page-document-commands.md) (page-level document commands), [0017](0017-direct-manipulation.md) (direct layout manipulation)

## Context

ADR 0010 proved the editor loop with selection, a property inspector, commands and inverse-based undo. It deliberately left out creation and a layer tree: a user could only edit nodes that already existed in the starter design. That makes Weft useful for inspecting and adjusting a design file, but not for starting a design in the browser.

The new surface must not invent a second mutation model. It has to use the same `node.insert` command that the CLI and agents use, so every browser creation is validated by the bridge, written atomically and undoable through its inverse.

## Decision

### 1. A left panel contains tools and layers

The editor gains a left panel with a small tool grid and a read-only layer tree. The tool order is:

- **V** Select — click a rendered node, or empty canvas;
- **F** Frame — drag or click to create a container;
- **T** Text — drag or click to create a text node with editable default content;
- **R** Rectangle — drag or click to create a rectangle;
- **O** Ellipse — drag or click to create an ellipse.

The panel is available only while the design source is editable (live bridge, not the static preview). In static mode the tools are disabled and the layer tree remains a read-only navigator.

### 2. Creation is a normal page command

A drag converts the screen pointer path through the stage transform into page coordinates. A click (under four pixels of movement) uses a default size; a drag uses the dragged bounds. The node receives:

- a client-generated `nd_` ULID;
- a numbered, human-readable name (`Frame 6`, `Rect 1`, `Text 9`);
- default geometry and a small default style (white frame with radius, pale blue rectangle, warm ellipse, Inter text);
- a parent of the currently selected container when one is selected, otherwise the page root.

The parent case subtracts the selected container's absolute origin, so the child's `x`/`y` are local coordinates. The app then sends the ordinary `{ type: "node.insert", node, parentId }` command with an actor. It does not write Yjs or files directly.

The tool returns to Select after creation. The new node is selected once the next page materialization contains it; no optimistic document mutation is introduced.

### 3. The layer tree mirrors the page tree

The layer tree renders `page.children` recursively, shows an icon by node type, indents children, and supports expand/collapse. Selecting a row is the same selection as clicking the canvas. Selecting a descendant automatically expands collapsed ancestors, and the selected row scrolls into view. Clicking a layer also returns the active tool to Select.

The tree is intentionally read-only in this slice: there is no drag-to-reorder, visibility toggle, lock, or multi-select. Those need a clearer command and interaction design.

### 4. Keyboard shape

`V`, `F`, `T`, `R` and `O` switch tools when focus is not in a form control. `Delete`/`Backspace` still removes the selected node, and `Cmd/Ctrl+Z` still undoes the last command. `Escape` leaves a creation tool (or clears the selection when already in Select).

### 5. What this slice does not add

- Page creation. The exit criteria for the roadmap mentioned a new page; changing the manifest and creating a page file is a document-level operation with its own command and undo semantics, so it is a follow-up rather than a hidden side effect of a node tool.
- Drag/resize handles, multi-select, creation inside a selected group by hit-testing, or layer reordering.
- Visibility/lock controls, componentisation, constraints, or a typography inspector.

## Consequences

**Easier**

- A user can start from a blank page and create frames, text, rectangles and ellipses without leaving the browser.
- Every creation is attributed, written to the canonical page file, streamed over Yjs and undoable with the existing inverse stack.
- The layer tree makes nested frames and the result of parent-aware creation visible and navigable.
- Tools use the same command vocabulary as agents, so the browser has no private mutation path.

**Harder, and knowingly accepted**

- The left panel reduces canvas width; the fit scale adjusts, and the panel collapses away below the mobile breakpoint.
- A newly created node is selected only after the command result and page update, so there is a short pending-selection interval rather than an optimistic local insert.
- Default names are counted from existing nodes and are not stable identifiers.
- Creation inside a selected frame can place a child outside the frame's clip; the inspector and tree expose the geometry, and constraints are future work.
- The layer tree does not yet handle very large pages with virtualization.
- New pages remain a file-level operation.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Create nodes by editing the page file directly from the browser** | It bypasses validation, attribution, atomic writes and inverse history, and creates a second mutation model. |
| **Add a browser-only insertion path in the bridge** | The command protocol already expresses insertion and creates an inverse; a parallel API would be harder to test and audit. |
| **Optimistically insert into the local Yjs session before the bridge accepts** | It complicates rollback on a rejected command or failed disk write and diverges from the existing undo model. The round trip is fast locally. |
| **A separate full layer panel with visibility, lock and drag reorder** | Those controls need page-level semantics and more command types; ship selection and structure first. |
| **Include page creation in this slice** | It requires a manifest mutation, file creation/deletion and a document-level inverse that does not exist yet. Mixing it with node tools would hide a larger contract change. |
| **Canvas-only tool palette with no layer tree** | A tree is the fastest way to understand nested frames and to select small or overlapping layers. |

## Follow-ups

- Page creation/deletion with a document-level command and inverse.
- Drag/resize handles, multi-select and layer reordering.
- Visibility/lock controls and layer search.
- Hit-testing to choose a parent frame when none is selected.
- A compact tool rail for narrow viewports.
