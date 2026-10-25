import { describe, expect, it } from "vitest";
import {
  addPage,
  applyDocumentCommand,
  createDesign,
  createNode,
  createPage,
  insertNode,
  nextPageFile,
  readDocumentCommand,
  serialize,
  type DocumentCommand,
} from "../src/index.js";

function twoPageDesign() {
  const base = createDesign({ name: "Document", pageName: "First" });
  return addPage(base, "Second").design;
}

describe("document commands", () => {
  it("creates a page and an inverse that restores the design", () => {
    const design = twoPageDesign();
    const page = createPage({ name: "Third" });
    const command: DocumentCommand = {
      type: "page.create",
      page,
      file: nextPageFile(design.manifest, page.name),
    };
    const applied = applyDocumentCommand(design, command);
    expect(applied.createdPageIds).toEqual([page.id]);
    expect(applied.design.pages.map((candidate) => candidate.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(applied.design.manifest.pages.at(-1)).toMatchObject({
      id: page.id,
      name: "Third",
      file: command.file,
    });

    const undone = applyDocumentCommand(applied.design, applied.inverse);
    expect(serialize(undone.design.manifest)).toBe(serialize(design.manifest));
    expect(undone.design.pages.map((candidate) => candidate.id)).toEqual(
      design.pages.map((candidate) => candidate.id),
    );
  });

  it("removes a page with its nodes and restores them through the inverse", () => {
    const design = twoPageDesign();
    const page = design.pages[1];
    const node = createNode({ type: "text", content: "Keep me" });
    const withNode = {
      ...design,
      pages: design.pages.map((candidate, index) =>
        index === 1 ? insertNode(candidate, node) : candidate,
      ),
    };
    const applied = applyDocumentCommand(withNode, { type: "page.remove", pageId: page.id });
    expect(applied.removedPageIds).toEqual([page.id]);
    expect(applied.design.pages).toHaveLength(1);
    expect(applied.inverse.type).toBe("page.create");
    if (applied.inverse.type !== "page.create") throw new Error("expected create inverse");
    expect(applied.inverse.page.nodes[node.id]).toEqual(node);

    const restored = applyDocumentCommand(applied.design, applied.inverse);
    expect(restored.design.pages.map((candidate) => candidate.id)).toEqual(
      withNode.pages.map((candidate) => candidate.id),
    );
    expect(restored.design.pages[1].nodes[node.id]).toEqual(node);
  });

  it("renames a page and restores the old name through the inverse", () => {
    const design = twoPageDesign();
    const page = design.pages[1];
    const applied = applyDocumentCommand(design, {
      type: "page.rename",
      pageId: page.id,
      name: "Pricing",
    });
    expect(applied.design.pages[1].name).toBe("Pricing");
    expect(applied.design.manifest.pages[1].name).toBe("Pricing");
    expect(applied.inverse).toEqual({
      type: "page.rename",
      pageId: page.id,
      name: "Second",
    });
    const undone = applyDocumentCommand(applied.design, applied.inverse);
    expect(undone.design.pages[1].name).toBe("Second");
    expect(undone.design.manifest.pages[1].name).toBe("Second");
  });

  it("moves a page in both the page and manifest order with an inverse", () => {
    const design = twoPageDesign();
    const third = createPage({ name: "Third" });
    const withThree = applyDocumentCommand(design, {
      type: "page.create",
      page: third,
      file: nextPageFile(design.manifest, third.name),
    }).design;
    const applied = applyDocumentCommand(withThree, {
      type: "page.move",
      pageId: third.id,
      index: 0,
    });
    expect(applied.design.pages.map((page) => page.name)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
    expect(applied.design.manifest.pages.map((page) => page.name)).toEqual([
      "Third",
      "First",
      "Second",
    ]);
    expect(applied.inverse).toEqual({
      type: "page.move",
      pageId: third.id,
      index: 2,
    });
    const undone = applyDocumentCommand(applied.design, applied.inverse);
    expect(undone.design.pages.map((page) => page.name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("refuses the last page and duplicate files or ids", () => {
    const one = createDesign({ name: "One" });
    expect(() => applyDocumentCommand(one, { type: "page.remove", pageId: one.pages[0].id })).toThrow(
      /at least one page/,
    );

    const design = twoPageDesign();
    const page = createPage({ name: "Duplicate file" });
    expect(() =>
      applyDocumentCommand(design, {
        type: "page.create",
        page,
        file: design.manifest.pages[0].file,
      }),
    ).toThrow(/already used/);

    expect(() =>
      applyDocumentCommand(design, {
        type: "page.create",
        page: design.pages[0],
        file: nextPageFile(design.manifest, "Clone"),
      }),
    ).toThrow(/already exists/);

    expect(() =>
      applyDocumentCommand(design, {
        type: "page.create",
        page: createPage({ name: "Unsafe" }),
        file: "../outside.json",
      }),
    ).toThrow(/safe/);
  });

  it("parses only safe document commands", () => {
    const page = createPage({ name: "Unsafe" });
    expect(() =>
      readDocumentCommand({ type: "page.create", page, file: "../outside.json" }),
    ).toThrow(/safe/);
    expect(() => readDocumentCommand({ type: "pageremove", pageId: page.id })).toThrow(/Unknown/);
    expect(readDocumentCommand({ type: "page.remove", pageId: page.id })).toEqual({
      type: "page.remove",
      pageId: page.id,
    });
  });
});
