import { describe, expect, it } from "vitest";
import {
  applyDesignCommand,
  applyPageCommand,
  createCommandEnvelope,
  createNode,
  getParentId,
  getSiblingIndex,
  isId,
  readPageCommand,
  serialize,
  validateDesign,
  WeftCommandError,
  type FrameNode,
  type PageCommand,
  type PageDocument,
  type TextNode,
} from "../src/index.js";
import { buildDesign } from "./helpers.js";

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WeftCommandError);
    expect((error as WeftCommandError).code).toBe(code);
    return;
  }
  throw new Error(`Expected command to fail with ${code}.`);
}

function undoRoundTrip(page: PageDocument, command: PageCommand) {
  const before = serialize(page);
  const applied = applyPageCommand(page, command);
  const undone = applyPageCommand(applied.page, applied.inverse);
  expect(serialize(undone.page)).toBe(before);
  return applied;
}

describe("page commands", () => {
  it("inserts a node and undoes it", () => {
    const { design, page, ids } = buildDesign();
    const node = createNode({ type: "rect", name: "Badge", x: 16, y: 16 });
    const applied = undoRoundTrip(page, {
      type: "node.insert",
      node,
      parentId: ids.frame,
      index: 1,
    });
    expect(applied.createdNodeIds).toEqual([node.id]);
    expect((applied.page.nodes[ids.frame] as FrameNode).children).toEqual([
      ids.title,
      node.id,
      ids.body,
    ]);
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("inserts a subtree and undoes it", () => {
    const { design, page, ids } = buildDesign();
    const label = createNode({ type: "text", name: "Label", content: "Inside" });
    const group = createNode({ type: "group", name: "Group", children: [label.id] });
    const applied = undoRoundTrip(page, {
      type: "node.insertSubtree",
      nodes: [group, label],
      rootId: group.id,
      parentId: ids.frame,
      index: 2,
    });
    expect(applied.createdNodeIds.sort()).toEqual([group.id, label.id].sort());
    expect(getParentId(applied.page, label.id)).toBe(group.id);
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("updates a node and undoes it", () => {
    const { design, page, ids } = buildDesign();
    const applied = undoRoundTrip(page, {
      type: "node.update",
      nodeId: ids.title,
      patch: { content: "Changed", style: { opacity: 0.5 } },
    });
    const title = applied.page.nodes[ids.title] as TextNode;
    expect(title.content).toBe("Changed");
    expect(title.style?.opacity).toBe(0.5);
    expect(title.style?.font?.size).toBe(24);
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("moves a node and restores its parent and index", () => {
    const { design, page, ids } = buildDesign();
    const applied = undoRoundTrip(page, {
      type: "node.move",
      nodeId: ids.title,
      parentId: null,
      index: 0,
    });
    expect(applied.page.children[0]).toBe(ids.title);
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("removes a subtree and restores it", () => {
    const { design, page, ids } = buildDesign();
    const applied = undoRoundTrip(page, { type: "node.remove", nodeId: ids.frame });
    expect(applied.page.nodes).toEqual({});
    expect(applied.inverse.type).toBe("node.insertSubtree");
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("duplicates a node and removes the copy on undo", () => {
    const { design, page, ids } = buildDesign();
    const applied = undoRoundTrip(page, { type: "node.duplicate", nodeId: ids.frame });
    expect(applied.createdNodeIds).toHaveLength(1);
    expect(Object.keys(applied.page.nodes)).toHaveLength(6);
    expect(getSiblingIndex(applied.page, applied.createdNodeIds[0])).toBe(1);
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("replaces a whole node for undo", () => {
    const { design, page, ids } = buildDesign();
    const title = page.nodes[ids.title] as TextNode;
    const replacement: TextNode = { ...structuredClone(title), content: "Replaced" };
    const applied = undoRoundTrip(page, { type: "node.replace", node: replacement });
    expect((applied.page.nodes[ids.title] as TextNode).content).toBe("Replaced");
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("refuses replace operations that change structure", () => {
    const { page, ids } = buildDesign();
    const frame = page.nodes[ids.frame] as FrameNode;
    expectCode(
      () =>
        applyPageCommand(page, {
          type: "node.replace",
          node: { ...structuredClone(frame), type: "text", content: "" } as never,
        }),
      "replace.type",
    );
    expectCode(
      () =>
        applyPageCommand(page, {
          type: "node.replace",
          node: { ...structuredClone(frame), children: [...frame.children].reverse() },
        }),
      "replace.children",
    );
  });

  it("applies a command to one page of a design", () => {
    const { design, ids } = buildDesign();
    const { design: next, inverse } = applyDesignCommand(design, design.pages[0].id, {
      type: "node.update",
      nodeId: ids.title,
      patch: { name: "Renamed" },
    });
    expect(next.pages[0].nodes[ids.title].name).toBe("Renamed");
    const { design: restored } = applyDesignCommand(next, design.pages[0].id, inverse);
    expect(serialize(restored)).toBe(serialize(design));
    expect(validateDesign(restored.manifest, restored.pages)).toEqual([]);
  });

  it("reports a missing page", () => {
    const { design } = buildDesign();
    expectCode(
      () =>
        applyDesignCommand(design, "pg_missing", {
          type: "node.remove",
          nodeId: "nd_missing",
        }),
      "page.missing",
    );
  });
});

describe("command parsing", () => {
  it("parses a minimal update", () => {
    const command = readPageCommand({
      type: "node.update",
      nodeId: "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
      patch: { x: 10 },
    });
    expect(command).toEqual({
      type: "node.update",
      nodeId: "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
      patch: { x: 10 },
    });
  });

  it("defaults insert and move parents to the page root", () => {
    const node = createNode({ type: "rect" });
    const insert = readPageCommand({ type: "node.insert", node });
    expect(insert.type === "node.insert" && insert.parentId).toBeNull();

    const move = readPageCommand({ type: "node.move", nodeId: node.id });
    expect(move.type === "node.move" && move.parentId).toBeNull();
  });

  it("preserves the absence of parentId on duplicate", () => {
    const command = readPageCommand({ type: "node.duplicate", nodeId: "nd_x" });
    expect(command.type === "node.duplicate" && "parentId" in command).toBe(false);
    const rooted = readPageCommand({ type: "node.duplicate", nodeId: "nd_x", parentId: null });
    expect(rooted.type === "node.duplicate" && rooted.parentId).toBeNull();
  });

  it("applies a batch as one command with a batch inverse", () => {
    const { design, page, ids } = buildDesign();
    const title = page.nodes[ids.title] as TextNode;
    const applied = undoRoundTrip(page, {
      type: "batch",
      commands: [
        { type: "node.update", nodeId: ids.title, patch: { x: title.x + 40 } },
        { type: "node.update", nodeId: ids.body, patch: { y: 120 } },
      ],
    });
    expect(applied.inverse.type).toBe("batch");
    if (applied.inverse.type === "batch") {
      expect(applied.inverse.commands).toHaveLength(2);
    }
    expect(validateDesign(design.manifest, [applied.page])).toEqual([]);
  });

  it("rejects empty or nested batches", () => {
    expectCode(() => readPageCommand({ type: "batch", commands: [] }), "command.batch");
    expectCode(
      () =>
        readPageCommand({
          type: "batch",
          commands: [{ type: "batch", commands: [{ type: "node.remove", nodeId: "nd_x" }] }],
        }),
      "command.batch",
    );
  });

  it("rejects malformed commands", () => {
    expectCode(() => readPageCommand(null), "command.type");
    expectCode(() => readPageCommand({ type: "nope" }), "command.type");
    expectCode(() => readPageCommand({ type: "node.update", patch: {} }), "command.type");
    expectCode(
      () => readPageCommand({ type: "node.update", nodeId: "nd_x", patch: null }),
      "command.type",
    );
    expectCode(
      () => readPageCommand({ type: "node.insert", node: { id: "nd_x", type: "frame" } }),
      "command.node",
    );
    expectCode(
      () =>
        readPageCommand({
          type: "node.move",
          nodeId: "nd_x",
          index: 1.5,
        }),
      "command.index",
    );
  });

  it("creates command envelopes with ids and timestamps", () => {
    const command: PageCommand = {
      type: "node.update",
      nodeId: "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
      patch: { x: 1 },
    };
    const envelope = createCommandEnvelope({
      pageId: "pg_01JAV3Q8ZK4M2TP9W6XH5NR7BD",
      command,
      actor: { id: "test", kind: "human" },
    });
    expect(isId(envelope.id, "cm")).toBe(true);
    expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
    expect(envelope.actor?.kind).toBe("human");
    expect(envelope.command).toEqual(command);
  });
});
