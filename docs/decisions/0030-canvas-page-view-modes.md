# 0030 · Canvas and page background view modes

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0028, ADR 0029

## Context

ADR 0029 removed the false second frame by painting the page background full-bleed. That preserved the page paint, but it also made the whole workspace adopt the page color. For a page with a large white background, the result is an entirely white canvas with no visual workspace around the design. The editor needs both: a canvas that reads as a canvas, and an honest view of the page background when the designer wants it.

The white area inside a frame is not editor whitespace; it is the frame's own fill and geometry. A page background toggle cannot and should not hide that.

## Decision

The top bar has a **Canvas / Page** view switch. The choice applies only to editor rendering and is persisted in this browser.

- **Canvas** (default): the dotted workspace is visible; the page background is not painted. Frames, nested fills, content, labels, selection and hover chrome render normally.
- **Page**: the page background paint is resolved with the canonical renderer logic and fills the workspace behind the frames, as described in ADR 0029.

Both modes share the same stage, hit testing, selection, scopes, zoom, pan, frame labels and empty-page placeholder. Switching modes does not touch the design file, command history or export. Export, static rendering and snapshots keep the canonical page background.

Page mode is a view of design content; Canvas mode is a view of the workspace. Neither mode hides frame fills, strokes or nested paints — the white interior of a frame remains part of the design in both modes. Hiding frame fills would be a separate wireframe/outline view, not a canvas background option.

## Consequences

**Easier**

- A page with a white or large background no longer turns the entire editor into a page-colored field by default.
- Users can still inspect the exact page paint without changing files.
- The top-level frame now reads as an artboard on a dotted canvas rather than as the whole canvas.
- The mode is local and reversible; export/static/agent output is unchanged.

**Harder, and knowingly accepted**

- Canvas mode deliberately hides the page background, so it is not WYSIWYG for that property; Page mode is the fidelity view.
- The switch adds a top-bar control and persistent local state.
- Frame fills and fixed frame sizes can still produce a large white region inside a frame; that is design content, not canvas chrome.
- No automatic switch based on background luminance or design type; the user chooses.
- UI-only change; the automated test gate remains the existing suite.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Always paint the page background full-bleed (ADR 0029 only)** | White or solid page backgrounds erase the visual canvas; users lose the dotted workspace. |
| **Never paint page backgrounds in the editor** | Faster, but hides design contrast and removes the only fidelity view. |
| **Show both a page background and dots** | Mixing editor grid into design paint is misleading, especially for image/gradient backgrounds. |
| **Hide top-level frame fills in Canvas mode** | Confuses a workspace view with a wireframe view and silently changes how the design appears. |
| **Put the toggle in project settings** | The choice is a per-browser view preference, not project configuration. |

## Follow-ups

- A wireframe/frame-fill visibility view if users want structural editing.
- Remember the mode per design as well as per browser.
- A page-background inspector entry.
