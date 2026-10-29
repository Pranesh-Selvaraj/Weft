# Canvas workspace

The editor canvas renders one page of the design as a page surface on a dotted workspace. Top-level frames and groups are the artboards you work with.

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

The page surface keeps a thin border and shadow against the dotted workspace. Frame labels can extend outside it. The renderer still clips page content at the page bounds.

## Known limits

- The canvas is finite page bounds, not an infinite artboard workspace.
- No rulers, guides, snapping, zoom-to-selection, minimap or inertia.
- No true frame-isolation mode that hides or dims surrounding layers.
- Labels can overlap in very dense designs; only top-level frames have persistent labels.

See [ADR 0028](decisions/0028-canvas-workspace-rework.md), [selection scopes](decisions/0026-selection-scope-marquee.md) and [canvas navigation](decisions/0025-canvas-navigation-layer-controls.md).
