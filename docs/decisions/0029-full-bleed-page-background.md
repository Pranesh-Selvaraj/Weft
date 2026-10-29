# 0029 · Full-bleed page background

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Supersedes in part:** ADR 0028

## Context

ADR 0028 made the page surface visually distinct with a thin outline and shadow. The editor then rendered the page's background paint inside that bounded stage, behind the actual design frames. On the starter design this produced a sand-colored rectangle around the white Hero frame. A user reasonably read it as a second, unexplained frame behind the main frame.

The page background is a real document property and must remain visible; the problem is treating it as another bounded object.

## Decision

- In the editor, a non-empty page's background paint becomes a **full-bleed canvas backdrop**, not a bordered page sheet.
- The renderer's `PageView` gains `showBackground?: boolean` (default `true`). The editor passes `false` and paints the background behind the stage; static preview, export and other renderer consumers keep the canonical page background.
- The stage remains the page-content bounds for fitting, hit testing, marquee and layout, but it has no border or shadow for a non-empty page.
- If the page has no background, the dotted workspace shows through. A page background covers those dots and becomes the working field; this is intentional because it is design content.
- An empty page keeps a dashed 800×600 placeholder so the empty-page hint has a surface.
- Clicking the exposed workspace outside the stage clears selection and scope. Panning suppresses that click.
- Page background paints may be solid, gradient or image paints; the same `backgroundStyle` resolution used by the renderer is applied to the backdrop.

## Consequences

**Easier**

- The page background no longer looks like a second frame.
- Frames and their labels become the primary objects on the canvas.
- The page's background contrast remains visible while designing.
- Export/static rendering keep the canonical bounded page background.

**Harder, and knowingly accepted**

- Full-bleed page backgrounds do not have a visible page boundary in the editor; their exact bounds are only apparent in export or by the content bounds.
- Zooming does not scale the backdrop as a page object; it is a workspace surface.
- A page with no background shows the dotted Canvas; a page with a background does not.
- The canvas remains finite page bounds for fitting and clipping, not an infinite workspace.
- UI-only change; no new automated browser test.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Keep the bordered sheet and label it “page”** | Still reads as a second frame and adds noise; the user asked for one main frame, not another object. |
| **Remove background rendering from the editor** | Loses real design contrast and context; full-bleed keeps the paint without the false boundary. |
| **Make the page background only cover the frame area** | Invents a relationship the document does not have; page background belongs to the page. |
| **Show dots over the background paint** | Can imply the background is editor chrome and reduces fidelity for image/gradient backgrounds. |

## Follow-ups

- An explicit page-background inspector with a toggle for the full-bleed preview.
- A page-boundary guide that can be shown temporarily.
- Zoom-aware backdrop behavior for image paints.
