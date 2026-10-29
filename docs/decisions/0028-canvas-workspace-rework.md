# 0028 · Canvas workspace rework

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADRs 0010, 0017, 0019, 0025, 0026

## Context

The editor rendered the page as a single rounded sheet, with no labels for the frames inside it. A click selected the top-level frame, but nothing on the canvas explained that hierarchy; the only clue was the layer tree or the inspector after the fact. Selection and hover labels were drawn inside the scaled stage, so they shrank with zoom. Fit also used an arbitrary 800×600 minimum stage even when the page contained a much smaller frame, and `Ctrl/Cmd`+wheel changed scale without keeping the point under the cursor fixed. Panning required scrollbars.

The result was a canvas that technically rendered the design but did not read like a design workspace. This record covers the editor-side canvas rework; the document format and command model are unchanged.

## Decision

### 1. Frames are visible objects

Every visible top-level frame/group gets a screen-scaled name label above its top-left corner. The label is editor chrome: it is not rendered into exports, snapshots or the page file.

- A single click selects the frame.
- A double-click enters the frame scope.
- The selected frame label uses the selection color; a hovered frame label gets a border.
- Hovering any layer highlights the object that a click would select in the current scope: the top-level frame at page scope, or the direct child inside a frame scope.
- Nested frames, text and other layers get a hover outline plus a label; top-level frames rely on their persistent frame label.

Labels and selection chrome are sized in screen pixels by scaling their source geometry by `1 / canvasScale`, so a 10–11 px label stays that size at 10% or 400% zoom.

### 2. The stage follows content

The stage size is the page's content bounds, not a fixed 800×600 minimum. An empty page keeps an 800×600 editing placeholder so the empty-page hint has a visible surface; as soon as content exists the surface shrinks or grows to the real bounds. Fit stays capped at 100% (small pages are not blown up), and the stage is centered in the available canvas when it fits.

The page surface keeps a thin border and shadow so it is distinguishable from the dotted workspace, but frame labels are allowed to paint outside the stage. The page renderer still clips page content at its own bounds.

### 3. A navigable canvas

- `Space` + drag, or middle-button drag, pans the canvas through its scroll position.
- `Ctrl`/`Cmd` + wheel zooms around the pointer: the page coordinate under the cursor remains under the cursor after the scale change.
- `Fit` resets the scroll position; toolbar and keyboard zoom still use the existing 10%–400% range.
- The cursor changes to `grab`/`grabbing` while space-pan is active.
- The bottom hint documents Space-drag, double-click and frame entry.

### 4. Scope-aware hit feedback

Hover uses the same `resolveScopedHit` function as click selection, so the highlight never promises a selection that a click will not make. Hover is suppressed during drags, marquees, transforms and panning. Hover outlines and labels have `pointer-events: none` and never become part of the document.

## Consequences

**Easier**

- The canvas now communicates the page → frame → child hierarchy without requiring the layer tree.
- Frame selection/entry is direct from the canvas.
- Zoom and pan follow familiar design-tool behavior.
- Small designs no longer sit inside a large empty minimum stage.
- Labels stay legible at every zoom level.

**Harder, and knowingly accepted**

- Frame labels can overlap dense compositions; only top-level frames get persistent labels.
- The canvas is still finite page bounds, not an infinite Figma-style canvas with free artboards.
- Space-pan only starts while the pointer is over the canvas and the keyboard event is not targeting a control; there is no hand tool or middle-button button glyph.
- Zoom-at-cursor changes scroll in a layout effect, so extreme rapid wheel input can settle at a slightly different offset than a single event.
- The page surface itself is still a visible sheet because page background is document content; it is not a pure infinite workspace.
- No rulers, snapping, guides, zoom-to-selection, inertia, lasso or frame isolation yet.
- UI-only change: no new automated browser test, manual checks plus the existing 250-test gate.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Remove the page surface entirely** | Hides a real page background property and makes page-level content/background invisible; the sheet is honest. |
| **Show labels for every nested frame all the time** | Clutters dense designs; hover and breadcrumb cover nested context. |
| **Draw labels inside the scaled stage with fixed CSS sizes** | Labels become unreadable at low zoom; inverse scaling keeps screen-size typography. |
| **Keep the 800×600 minimum** | It creates unexplained whitespace around small designs and was the original source of confusion. |
| **Zoom from the viewport center** | The content under the pointer moves away; cursor anchoring is the expected design-tool behavior. |
| **A separate hand tool** | Space/middle drag is faster for a keyboard-and-trackpad workflow and avoids another mode. |

## Follow-ups

- Rulers, snapping and drag guides.
- Zoom-to-selection and a minimap.
- True selection/frame isolation that dims or hides surrounding layers.
- A hand tool and configurable zoom presets.
- Layer context menus on hover.
