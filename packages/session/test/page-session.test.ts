import { describe, expect, it } from "vitest";
import {
  createNode,
  createPage,
  insertNode,
  newId,
  serialize,
  validatePage,
  type FrameNode,
  type PageCommand,
  type PageDocument,
  type TextNode,
} from "@weft/core";
import { PageSession, WeftSessionError } from "../src/index.js";

function buildPage(): PageDocument {
  const frame = createNode({
    type: "frame",
    name: "Card",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    children: [],
  });
  const title = createNode({
    type: "text",
    name: "Title",
    x: 0,
    y: 0,
    width: 320,
    height: 40,
    content: "Hello",
    style: { font: { family: "Inter", size: 32, weight: 600 } },
  });
  const body = createNode({
    type: "text",
    name: "Body",
    x: 0,
    y: 48,
    width: 320,
    height: 48,
    content: "Body copy",
    style: { font: { family: "Inter", size: 16 } },
  });
  let page = insertNode(createPage(), frame);
  page = insertNode(page, title, { parentId: frame.id, index: 0 });
  page = insertNode(page, body, { parentId: frame.id, index: 1 });
  return page;
}

function nodeId(page: PageDocument, name: string): string {
  const node = Object.values(page.nodes).find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node.id;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectSamePage(left: PageDocument, right: PageDocument): void {
  expect(serialize(left)).toBe(serialize(right));
}

describe("PageSession", () => {
  it("round-trips a page through Yjs", () => {
    const page = buildPage();
    const session = PageSession.fromPage(page);
    expectSamePage(session.toPage(), page);
    expect(session.baseline).toEqual(page);
    expect(session.hasUnpersistedChanges).toBe(false);
    session.destroy();
  });

  it("applies commands and their inverses", () => {
    const page = buildPage();
    const title = nodeId(page, "Title");
    const session = PageSession.fromPage(page);

    const command: PageCommand = {
      type: "node.update",
      nodeId: title,
      patch: { content: "Live content", x: 12 },
    };
    const applied = session.applyCommand(command);
    expect((applied.page.nodes[title] as TextNode).content).toBe("Live content");
    expect(applied.page.nodes[title].x).toBe(12);
    expect(session.hasUnpersistedChanges).toBe(true);

    const undone = session.applyCommand(applied.inverse);
    expectSamePage(undone.page, page);
    expect(validatePage(session.toPage())).toEqual([]);
    session.destroy();
  });

  it("applies insert, move, and remove commands", () => {
    const page = buildPage();
    const frame = nodeId(page, "Card");
    const title = nodeId(page, "Title");
    const session = PageSession.fromPage(page);

    const badge = createNode({ type: "rect", name: "Badge", width: 24, height: 24 });
    const inserted = session.applyCommand({
      type: "node.insert",
      node: badge,
      parentId: frame,
      index: 0,
    });
    expect((inserted.page.nodes[frame] as FrameNode).children[0]).toBe(badge.id);
    expect(validatePage(inserted.page)).toEqual([]);

    const moved = session.applyCommand({ type: "node.move", nodeId: title, parentId: null, index: 0 });
    expect(moved.page.children[0]).toBe(title);
    expect(validatePage(moved.page)).toEqual([]);

    const removed = session.applyCommand({ type: "node.remove", nodeId: frame });
    expect(removed.page.nodes[frame]).toBeUndefined();
    expect(validatePage(removed.page)).toEqual([]);
    session.destroy();
  });

  it("syncs two clients that share the initial Yjs structure", () => {
    const page = buildPage();
    const title = nodeId(page, "Title");
    const body = nodeId(page, "Body");
    const author = PageSession.fromPage(page);
    const reviewer = PageSession.fromUpdate(author.encodeStateAsUpdate());

    author.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Author edit" },
    });
    reviewer.applyCommand({
      type: "node.update",
      nodeId: body,
      patch: { content: "Reviewer edit" },
    });

    const authorUpdate = author.encodeStateAsUpdate();
    const reviewerUpdate = reviewer.encodeStateAsUpdate();
    author.applyUpdate(reviewerUpdate);
    reviewer.applyUpdate(authorUpdate);

    const merged = author.toPage();
    expectSamePage(merged, reviewer.toPage());
    expect((merged.nodes[title] as TextNode).content).toBe("Author edit");
    expect((merged.nodes[body] as TextNode).content).toBe("Reviewer edit");
    expect(validatePage(merged)).toEqual([]);
    author.destroy();
    reviewer.destroy();
  });

  it("ingests a file write with no live changes", () => {
    const page = buildPage();
    const body = nodeId(page, "Body");
    const session = PageSession.fromPage(page);

    const incoming = clone(page);
    (incoming.nodes[body] as TextNode).content = "From the file";
    const result = session.ingestPage(incoming);

    expect(result.conflicts).toEqual([]);
    expect((result.page.nodes[body] as TextNode).content).toBe("From the file");
    expectSamePage(session.toPage(), result.page);
    expect(session.hasUnpersistedChanges).toBe(false);
    session.destroy();
  });

  it("merges disjoint live and file changes", () => {
    const page = buildPage();
    const title = nodeId(page, "Title");
    const body = nodeId(page, "Body");
    const session = PageSession.fromPage(page);

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Live title" },
    });

    const incoming = clone(page);
    (incoming.nodes[body] as TextNode).content = "File body";
    const result = session.ingestPage(incoming);

    expect(result.conflicts).toEqual([]);
    expect((result.page.nodes[title] as TextNode).content).toBe("Live title");
    expect((result.page.nodes[body] as TextNode).content).toBe("File body");
    expect(validatePage(result.page)).toEqual([]);
    session.destroy();
  });

  it("keeps the live value and reports a conflicting field", () => {
    const page = buildPage();
    const title = nodeId(page, "Title");
    const session = PageSession.fromPage(page);

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Human wins" },
    });

    const incoming = clone(page);
    (incoming.nodes[title] as TextNode).content = "File loses";
    const result = session.ingestPage(incoming);

    expect(result.conflicts.map((conflict) => conflict.path)).toContain(
      `nodes.${title}.content`,
    );
    expect(result.conflicts[0]?.resolution).toBe("kept-current");
    expect((result.page.nodes[title] as TextNode).content).toBe("Human wins");
    expect(validatePage(result.page)).toEqual([]);
    session.destroy();
  });

  it("keeps a modified node when the file removes it", () => {
    const page = buildPage();
    const frame = nodeId(page, "Card");
    const title = nodeId(page, "Title");
    const session = PageSession.fromPage(page);

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Do not lose me" },
    });

    const incoming = clone(page);
    (incoming.nodes[frame] as FrameNode).children = (incoming.nodes[frame] as FrameNode).children.filter(
      (id) => id !== title,
    );
    delete incoming.nodes[title];
    const result = session.ingestPage(incoming);

    expect(result.conflicts.map((conflict) => conflict.path)).toContain(`nodes.${title}`);
    expect((result.page.nodes[title] as TextNode).content).toBe("Do not lose me");
    expect(result.page.nodes[frame]).toBeDefined();
    expect(validatePage(result.page)).toEqual([]);
    session.destroy();
  });

  it("moves a node from a file write while preserving a live field edit", () => {
    const page = buildPage();
    const frame = nodeId(page, "Card");
    const title = nodeId(page, "Title");
    const body = nodeId(page, "Body");
    const session = PageSession.fromPage(page);

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Live title" },
    });

    const incoming = clone(page);
    (incoming.nodes[frame] as FrameNode).children = [title];
    incoming.children = [frame, body];
    const result = session.ingestPage(incoming);

    expect(result.conflicts).toEqual([]);
    expect(result.page.children).toContain(body);
    expect((result.page.nodes[title] as TextNode).content).toBe("Live title");
    expect((result.page.nodes[frame] as FrameNode).children).toEqual([title]);
    expect(validatePage(result.page)).toEqual([]);
    session.destroy();
  });

  it("tracks update events and materialization", () => {
    const page = buildPage();
    const title = nodeId(page, "Title");
    const session = PageSession.fromPage(page);
    let updates = 0;
    const off = session.onUpdate(() => {
      updates += 1;
    });

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Changed" },
    });
    expect(updates).toBeGreaterThan(0);
    expect(session.hasUnpersistedChanges).toBe(true);
    const written = session.markMaterialized();
    expect(written).toEqual(session.toPage());
    expect(session.hasUnpersistedChanges).toBe(false);
    off();
    session.destroy();
  });


});

describe("PageSession subtree removal", () => {
  it("keeps a modified subtree when the file removes its container", () => {
    const page = buildPage();
    const frame = nodeId(page, "Card");
    const title = nodeId(page, "Title");
    const body = nodeId(page, "Body");
    const session = PageSession.fromPage(page);

    session.applyCommand({
      type: "node.update",
      nodeId: title,
      patch: { content: "Keep the whole card" },
    });

    const incoming = clone(page);
    incoming.children = [];
    delete incoming.nodes[frame];
    delete incoming.nodes[title];
    delete incoming.nodes[body];
    const result = session.ingestPage(incoming);

    expect(result.conflicts.map((conflict) => conflict.path)).toContain(`nodes.${frame}`);
    expect(result.page.nodes[frame]).toBeDefined();
    expect(result.page.nodes[title]).toBeDefined();
    expect(result.page.nodes[body]).toBeDefined();
    expect((result.page.nodes[title] as TextNode).content).toBe("Keep the whole card");
    expect(validatePage(result.page)).toEqual([]);
    session.destroy();
  });
});

describe("PageSession safety", () => {
  it("rejects an ingest for a different page id", () => {
    const page = buildPage();
    const session = PageSession.fromPage(page);
    const incoming = clone(page);
    incoming.id = newId("pg");
    expect(() => session.ingestPage(incoming)).toThrow(WeftSessionError);
    session.destroy();
  });
});
