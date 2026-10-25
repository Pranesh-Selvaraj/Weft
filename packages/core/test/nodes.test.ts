import { describe, expect, it } from "vitest";
import {
  createNode,
  duplicateNode,
  findNodes,
  getAncestorIds,
  getChildren,
  getDescendantIds,
  getParentId,
  getSiblingIndex,
  insertNode,
  insertSubtree,
  isContainerNode,
  moveNode,
  newId,
  removeNode,
  reorderNode,
  updateNode,
  validateDesign,
  walkNodes,
  WeftOperationError,
  type FrameNode,
  type TextNode,
} from "../src/index.js";
import { buildDesign } from "./helpers.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WeftOperationError);
    expect((error as WeftOperationError).code).toBe(code);
    return;
  }
  throw new Error(`Expected operation to fail with ${code}.`);
}

describe("node operations", () => {
  it("builds a valid page", () => {
    const { design } = buildDesign();
    expect(validateDesign(design.manifest, design.pages)).toEqual([]);
  });

  it("does not mutate the source page", () => {
    const { design, page, ids } = buildDesign();
    expect(page.nodes[ids.title]).toBeDefined();
    expect(design.pages[0]).toBe(page);
    expect((page.nodes[ids.frame] as FrameNode).children).toHaveLength(2);
  });

  it("reads the tree", () => {
    const { page, ids } = buildDesign();
    expect(getParentId(page, ids.title)).toBe(ids.frame);
    expect(getParentId(page, ids.frame)).toBeNull();
    expect(getSiblingIndex(page, ids.title)).toBe(0);
    expect(getSiblingIndex(page, ids.body)).toBe(1);
    expect(getAncestorIds(page, ids.title)).toEqual([ids.frame]);
    expect(getDescendantIds(page, ids.frame).sort()).toEqual([ids.title, ids.body].sort());
    expect(getChildren(page, ids.frame).map((node) => node.name)).toEqual(["Title", "Body"]);
    expect(getChildren(page, null).map((node) => node.name)).toEqual(["Card"]);
    expect([...walkNodes(page)].map((node) => node.name)).toEqual(["Card", "Title", "Body"]);
    expect(findNodes(page, (node) => node.type === "text")).toHaveLength(2);
  });

  it("moves a node to the root and back", () => {
    const { design, page, ids } = buildDesign();
    const atRoot = moveNode(page, ids.title, null, 0);
    expect(atRoot.children[0]).toBe(ids.title);
    expect((atRoot.nodes[ids.frame] as FrameNode).children).toEqual([ids.body]);
    expect(atRoot.nodes[ids.title].x).toBe(page.nodes[ids.title].x);
    expect(validateDesign(design.manifest, [atRoot])).toEqual([]);

    const back = moveNode(atRoot, ids.title, ids.frame, 0);
    expect((back.nodes[ids.frame] as FrameNode).children).toEqual([ids.title, ids.body]);
  });

  it("reorders siblings", () => {
    const { design, page, ids } = buildDesign();
    const reordered = reorderNode(page, ids.body, 0);
    expect((reordered.nodes[ids.frame] as FrameNode).children).toEqual([ids.body, ids.title]);
    expect(validateDesign(design.manifest, [reordered])).toEqual([]);
  });

  it("refuses to move a node into its own descendant", () => {
    const { page, ids } = buildDesign();
    expectCode(() => moveNode(page, ids.frame, ids.title), "node.cycle");
    expectCode(() => moveNode(page, ids.frame, ids.frame), "node.cycle");
  });

  it("inserts a subtree in one operation", () => {
    const { design, page, ids } = buildDesign();
    const label = createNode({ type: "text", name: "Label", content: "Inside" });
    const group = createNode({ type: "group", name: "Group", children: [label.id] });
    const next = insertSubtree(page, [group, label], group.id, { parentId: ids.frame, index: 2 });
    expect((next.nodes[ids.frame] as FrameNode).children).toEqual([ids.title, ids.body, group.id]);
    expect(next.nodes[label.id]).toBeDefined();
    expect(validateDesign(design.manifest, [next])).toEqual([]);
    expect(getParentId(next, label.id)).toBe(group.id);
  });

  it("rejects subtrees that reference existing nodes", () => {
    const { page, ids } = buildDesign();
    const frame = createNode({ type: "frame", name: "Thief", children: [ids.title] });
    expectCode(() => insertSubtree(page, [frame], frame.id), "subtree.external");
  });

  it("rejects dangling child references", () => {
    const { page } = buildDesign();
    const frame = createNode({
      type: "frame",
      name: "Broken",
      children: [newId("nd")],
    });
    expectCode(() => insertSubtree(page, [frame], frame.id), "subtree.dangling");
  });

  it("rejects orphan nodes in a subtree", () => {
    const { page } = buildDesign();
    const frame = createNode({ type: "frame", name: "Root" });
    const orphan = createNode({ type: "rect", name: "Orphan" });
    expectCode(() => insertSubtree(page, [frame, orphan], frame.id), "subtree.orphan");
  });

  it("rejects cycles and shared children inside a subtree", () => {
    const { page } = buildDesign();
    const a = createNode({ type: "frame", name: "A", children: [] });
    const b = createNode({ type: "frame", name: "B", children: [a.id] });
    (a as FrameNode).children = [b.id];
    expectCode(() => insertSubtree(page, [a, b], a.id), "subtree.cycle");

    const shared = createNode({ type: "text", name: "Shared" });
    const left = createNode({ type: "frame", name: "Left", children: [shared.id] });
    const right = createNode({ type: "frame", name: "Right", children: [shared.id] });
    const root = createNode({ type: "frame", name: "Root", children: [left.id, right.id] });
    expectCode(
      () => insertSubtree(page, [root, left, right, shared], root.id),
      "subtree.multi-parent",
    );

    const twice = createNode({ type: "frame", name: "Twice", children: [] });
    (twice as FrameNode).children = [shared.id, shared.id];
    const twiceRoot = createNode({ type: "frame", name: "Twice root", children: [twice.id] });
    expectCode(
      () => insertSubtree(page, [twiceRoot, twice, shared], twiceRoot.id),
      "subtree.duplicate-child",
    );
  });

  it("requires insertSubtree for nodes with children", () => {
    const { page } = buildDesign();
    const child = createNode({ type: "text", name: "Child" });
    const frame = createNode({ type: "frame", name: "Frame", children: [child.id] });
    expectCode(() => insertNode(page, frame), "subtree.required");
  });

  it("duplicates a subtree with fresh ids", () => {
    const { design, page, ids } = buildDesign();
    const result = duplicateNode(page, ids.frame);
    expect(result.page.children).toHaveLength(2);
    expect(Object.keys(result.page.nodes)).toHaveLength(6);

    const newRoot = result.page.nodes[result.nodeId] as FrameNode;
    expect(newRoot.name).toBe("Card copy");
    expect(newRoot.children).toHaveLength(2);
    expect(newRoot.children).not.toContain(ids.title);
    expect(newRoot.children).not.toContain(ids.body);

    const newTitle = result.page.nodes[newRoot.children[0]] as TextNode;
    expect(newTitle.content).toBe("Hello, Weft");
    expect(newTitle.style?.font?.size).toBe(24);
    expect(new Set([...Object.keys(result.page.nodes), ...Object.keys(page.nodes)]).size).toBe(6);
    expect(validateDesign(design.manifest, [result.page])).toEqual([]);
  });

  it("duplicates at the root next to the original", () => {
    const { page, ids } = buildDesign();
    const result = duplicateNode(page, ids.title, { parentId: null, index: 0 });
    expect(result.page.children[0]).toBe(result.nodeId);
    expect(result.page.children[1]).toBe(ids.frame);
    expect((result.page.nodes[result.nodeId] as TextNode).content).toBe("Hello, Weft");
  });

  it("removes a node and its subtree", () => {
    const { page, ids } = buildDesign();
    const next = removeNode(page, ids.frame);
    expect(next.children).toEqual([]);
    expect(next.nodes).toEqual({});
  });

  it("removes a leaf and keeps its siblings", () => {
    const { page, ids } = buildDesign();
    const next = removeNode(page, ids.title);
    expect((next.nodes[ids.frame] as FrameNode).children).toEqual([ids.body]);
    expect(getParentId(page, ids.title)).toBe(ids.frame); // original untouched
  });

  it("updates fields and merges style one level deep", () => {
    const { page, ids } = buildDesign();
    const next = updateNode(page, ids.title, {
      name: "Headline",
      content: "Updated",
      style: { opacity: 0.5 },
    });
    const title = next.nodes[ids.title] as TextNode;
    expect(title.name).toBe("Headline");
    expect(title.content).toBe("Updated");
    expect(title.style?.opacity).toBe(0.5);
    expect(title.style?.fills).toEqual([{ type: "solid", color: "{color.ink}" }]);
    expect((page.nodes[ids.title] as TextNode).name).toBe("Title");
  });

  it("clears optional values with null", () => {
    const { page, ids } = buildDesign();
    const rotated = updateNode(page, ids.frame, { rotation: 15, style: { opacity: 0.9 } });
    const cleared = updateNode(rotated, ids.frame, { rotation: null, style: null });
    expect(cleared.nodes[ids.frame].rotation).toBeUndefined();
    expect(cleared.nodes[ids.frame].style).toBeUndefined();
    const withMeta = updateNode(cleared, ids.frame, { meta: { custom: "yes" } });
    const withoutMeta = updateNode(withMeta, ids.frame, { meta: null });
    expect(withoutMeta.nodes[ids.frame].meta).toBeUndefined();
  });

  it("rejects invalid updates", () => {
    const { page, ids } = buildDesign();
    expectCode(() => updateNode(page, ids.title, { asset: newId("as") }), "patch.type");
    expectCode(() => updateNode(page, ids.frame, { content: "nope" }), "patch.type");
    expectCode(() => updateNode(page, ids.frame, { unknown: true } as never), "patch.unknown");
    expectCode(() => updateNode(page, ids.frame, { width: -1 }), "value.invalid");
    expectCode(() => updateNode(page, ids.frame, { name: "  " }), "value.invalid");
    expectCode(() => updateNode(page, newId("nd"), { name: "x" }), "node.missing");
  });

  it("validates insertion indexes", () => {
    const { page } = buildDesign();
    const node = createNode({ type: "rect", name: "Solo" });
    expectCode(() => insertNode(page, node, { index: 5 }), "index.range");
    expectCode(() => insertNode(page, node, { index: -1 }), "index.range");
  });

  it("creates nodes with sensible defaults and required fields", () => {
    const frame = createNode({ type: "frame" });
    expect(frame.name).toBe("Frame");
    expect(frame.width).toBe(800);
    expect(isContainerNode(frame)).toBe(true);
    expect(isContainerNode(createNode({ type: "text" }))).toBe(false);
    expect(() => createNode({ type: "image" })).toThrow(WeftOperationError);
    expect(() =>
      createNode({
        type: "snapshot",
        source: {
          url: "https://example.com",
          viewport: { width: 100, height: 100 },
          capturedAt: "2026-10-25T00:00:00.000Z",
        },
      }),
    ).toThrow(WeftOperationError);
    expect(() => createNode({ type: "rect", id: "nope" })).toThrow(WeftOperationError);
  });
});
