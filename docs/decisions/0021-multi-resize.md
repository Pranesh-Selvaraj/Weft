# 0021 · Combined multi-selection resize

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / editing
- **Extends:** ADR 0019

## Context

Multi-selection can move/delete/align/nudge, but resizing still works one layer at a time. A combined bounding box with handles is the conventional way to scale several absolute layers together. Flex children cannot be reliably positioned by x/y, so the feature must not pretend group resize works for every selection.

## Decision

### 1. Combined document-space bounds

For selected **roots** (selected nodes whose ancestor is not also selected):

- compute absolute x/y/width/height from local geometry plus ancestor origins;
- derive the group's left/top/right/bottom and base size;
- render one dashed group box over the individual selection outlines;
- show the eight resize handles on that box only when every selected root is unlocked and its **immediate parent is not a flex layout**.

The group box is editor chrome; the design file is not changed until release.

### 2. Scale roots with one batch

On resize:

1. Apply the pointer delta to the group box using the same handle rules as single resize, clamping to at least 1 px.
2. Compute horizontal/vertical scale factors from the base group size.
3. Map each root's absolute position and size through the new box.
4. Convert back to parent-local x/y and send **one batch** of `node.update` commands with x/y/width/height.

The transient DOM preview sets width/height and translate on each root. Release restores those inline styles and commits the batch; cancel restores without a command. The operation is one undo step.

### 3. Why flex selections opt out

A flex parent computes child positions and sizes from layout rules; changing a child's x/y may have no visual effect, and changing its width/height can be overridden by flex basis/grow/shrink. Alignment/nudge already warn about this. Group resize therefore hides handles for flex-bound roots instead of presenting a misleading control. A selection that contains a flex child but whose **roots** are absolute can still resize the root frames; their descendants follow.

### 4. Deliberate limits

- No aspect-ratio lock, shift-constrain, rotation or per-node proportional constraints.
- No flex-aware group resize.
- No distribute, align-to-page or match-size.
- Group bounds are axis-aligned and ignore rotation.
- Locked roots prevent handles for the whole group.
- No multi-page or cross-design resize.

## Consequences

**Easier**

- Absolute-layout selections scale together with one gesture, one page write and one inverse.
- The group box makes the scaling origin explicit.
- Single-layer resize remains unchanged.
- Flex limitations are visible rather than silent.

**Harder, and knowingly accepted**

- Group resize is unavailable for the starter's flex content; users must select/resize individual layers until layout controls exist.
- Group bounds use document geometry rather than rendered DOM for the scale math; flex and rotation remain out of scope.
- Repeated group resize gestures are separate history entries.
- The inspector must explain why handles disappear for a selection.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Scale rendered DOM only** | Not canonical; file and layout would diverge. |
| **Resize each root independently with CSS transforms** | Produces uneven gaps and is hard to invert predictably. |
| **Enable group resize for flex children** | Layout would override x/y/width and create silent no-ops. |
| **Add a separate resize command** | The batch of node.update already expresses the change and inverse. |
| **Aspect-ratio lock in the same slice** | A modifier and constraint model is a separate interaction decision. |

## Follow-ups

- Flex-aware layout controls and group resize.
- Aspect-ratio modifiers, distribute/match-size and align-to-frame.
- Rotation-aware bounds.
- Live nudge/handle preview and smart guides.
