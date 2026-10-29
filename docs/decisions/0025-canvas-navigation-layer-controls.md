# 0025 · Canvas navigation and layer controls

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0010, ADR 0019

## Context

The editor had a single fit-to-window scale and no way to zoom into detail. Layers could not be hidden or locked, and there was no select-all or duplicate shortcut. These are basic spatial and structural controls for a design canvas; without them, larger pages and nested frames are difficult to navigate and protect.

## Decision

### 1. Zoom relative to fit

The view keeps a fit scale calculated from the available canvas and a zoom multiplier (1 = fit). Effective scale is `fitScale × zoom`.

- Toolbar controls: zoom out, current percentage (click for 100%), zoom in, and Fit.
- Keyboard: Cmd/Ctrl+0 fits, Cmd/Ctrl+= zooms in, Cmd/Ctrl+- zooms out.
- Ctrl/Cmd+wheel zooms around the current view.
- Zoom is clamped to 10%–400% of the fit scale; actual-size is capped at 400%.
- The canvas is scrollable when the zoomed stage exceeds the viewport. The stage holder does not flex-shrink, and `safe center` keeps the top/left edge reachable when content overflows.
- Pointer-to-page coordinate conversion continues to use the stage's DOM rect and effective scale, so selection, creation and transform gestures work at any zoom.

### 2. Layer visibility and lock

Each layer row has eye and lock actions, backed by ordinary `node.update` patches:

- visibility toggles `visible`; hidden layers disappear from the canvas but remain in the tree;
- lock toggles `locked`; locked layers cannot start move/resize/rotate gestures, expose no resize handles, and are excluded from delete, duplicate, nudge and alignment operations;
- both actions are undoable commands and work in the graph exactly like inspector edits.

### 3. Selection shortcuts

- Cmd/Ctrl+A selects every layer on the page.
- Cmd/Ctrl+D duplicates the unlocked selection roots as one `batch` of `node.duplicate` commands.
- Duplicates are not automatically selected in this slice because the duplicate ids are allocated by the command application; the original selection remains for comparison.

### 4. Deliberate limits

- No drag-to-pan, minimap, zoom-at-cursor anchor, touch pinch zoom or persistent per-page zoom.
- No bulk visibility/lock toggle or layer-tree range selection.
- Duplicating a selection creates copies but does not move the selection to them.
- Hidden selected layers can remain selected; their canvas selection box disappears until shown.
- Layer lock is a UI/document flag, not a cryptographic permission or an agent security boundary.
- The canvas scrolls rather than panning freely; there is no infinite canvas.

## Consequences

**Easier**

- Large pages and small details can be inspected without browser zoom.
- Layers can be hidden for comparison or locked while editing nearby content.
- Select-all and duplicate make bulk operations practical.
- All layer changes stay in the command/undo/file model.

**Harder, and knowingly accepted**

- The scrollable canvas changes the layout geometry and required safe alignment behavior.
- Selection chrome scales with the stage; labels can become large at high zoom.
- Lock filtering has to be repeated in every batch transform.
- Duplicate without selecting the copies is a smaller UX win than a fully automatic selection of new ids.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Browser zoom only** | Zooms the entire chrome and is not a canvas control. |
| **Absolute zoom percentages** | Fit is the most useful default across varied page sizes; a multiplier is simpler and the percentage is still shown. |
| **Canvas transform pan** | More code and gesture conflicts; scrollable overflow is sufficient for this slice. |
| **Visibility/lock only in the inspector** | Layer rows are where bulk comparison/protection belongs. |
| **Auto-select duplicates** | Needs duplicate-id return plumbing; defer rather than couple command application to client state. |
| **Lock enforced only in the UI** | File-level `locked` is already a document flag; command filtering keeps behavior consistent. |

## Follow-ups

- Drag-to-pan/minimap and zoom-at-cursor.
- Select duplicates automatically via a created-node result callback.
- Bulk visibility/lock, layer range selection and drag reordering.
- Per-page zoom memory and touch gestures.
