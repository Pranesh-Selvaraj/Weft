# Canvas workspace

The editor canvas renders one page of the design. Its background paint fills the workspace; top-level frames and groups are the artboards you work with. Pages without a background use the dotted workspace.

## Frames and labels

- Each visible top-level frame/group has a label above its top-left corner. The label is editor chrome and is never written into the design or exported.
- Click a frame label to select the frame; double-click it to enter the frame scope.
- At page scope, clicking inside a frame selects the frame. Double-click inside it to enter and select the clicked layer.
- Inside a scope, hover and click operate on direct children. The breadcrumb shows `Page / Frame / …` and Escape moves up one level.
- Hover outlines use the same scope-aware hit testing as click, so the outline shows exactly what a click would select.
- Selection labels, frame labels and hover labels stay at a readable screen size as you zoom.

## Canvas navigation

| Action | Control |
| --- | --- |
| Pan | Hold **Space** and drag, or middle-button drag |
| Zoom | `Ctrl`/`Cmd` + wheel, toolbar `−`/`+`, or `Cmd`/`Ctrl` + `-`/`=` |
| Fit | Toolbar **Fit** or `Cmd`/`Ctrl` + `0` |
| Actual size | Click the zoom percentage |
| Scroll | Trackpad or wheel |

Zoom is anchored at the pointer, so the page point under the cursor stays under the cursor. Fit resets the scroll position. The percentage is relative to the fitted view; 100% means the page fits the available canvas, and actual size can exceed it.

## Stage bounds

A non-empty page's stage covers the page's content bounds. There is no arbitrary minimum width or height, so a small frame does not float inside a large empty artboard. An empty page uses an 800×600 placeholder so the empty-page hint is visible; the first created layer replaces it with real content bounds.

A non-empty page is not drawn as a bordered sheet. The top-bar **Canvas / Page** switch chooses the workspace treatment:

- **Canvas** (default) shows the dotted workspace and does not paint the page background.
- **Page** resolves the page background paint and fills the workspace behind the frames.

The page renderer still clips content at the page bounds. This avoids a page background looking like a second frame behind the real frame while keeping a fidelity view available. An empty page keeps a dashed 800×600 placeholder for the empty-page hint, and both modes leave frame fills intact.

## Known limits

- The canvas is finite page bounds, not an infinite artboard workspace.
- Canvas mode hides the page background; Page mode shows it full-bleed. Frame fills and fixed frame sizes are never hidden by this switch.
- No rulers, guides, snapping, zoom-to-selection, minimap or inertia.
- No true frame-isolation mode that hides or dims surrounding layers.
- Labels can overlap in very dense designs; only top-level frames have persistent labels.

See [ADR 0030](decisions/0030-canvas-page-view-modes.md), [ADR 0029](decisions/0029-full-bleed-page-background.md), [ADR 0028](decisions/0028-canvas-workspace-rework.md), [selection scopes](decisions/0026-selection-scope-marquee.md) and [canvas navigation](decisions/0025-canvas-navigation-layer-controls.md).
