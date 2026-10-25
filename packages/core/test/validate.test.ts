import { describe, expect, it } from "vitest";
import {
  addPage,
  assertValidDesign,
  createDesign,
  createNode,
  createPage,
  insertNode,
  isSafeRelativePath,
  newId,
  validateDesign,
  validateManifest,
  validatePage,
  WeftValidationError,
  type FrameNode,
  type JsonObject,
  type TextNode,
  type TokenTree,
  type ValidationIssue,
} from "../src/index.js";
import { buildDesign } from "./helpers.js";

function codes(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("page validation", () => {
  it("accepts a valid page", () => {
    const { design, page } = buildDesign();
    expect(validatePage(page, { tokens: design.manifest.tokens })).toEqual([]);
  });

  it("checks the page envelope", () => {
    const { page } = buildDesign();
    const broken = clone(page) as unknown as Record<string, unknown>;
    broken.format = "not-weft";
    broken.version = 2;
    broken.name = "";
    delete broken.nodes;
    const found = codes(validatePage(broken));
    expect(found).toContain("format.invalid");
    expect(found).toContain("version.unsupported");
    expect(found).toContain("type.non-empty");
    expect(found).toContain("type.object");
  });

  it("rejects a node whose map key does not match its id", () => {
    const { page, ids } = buildDesign();
    const broken = clone(page);
    broken.nodes[ids.title].id = newId("nd");
    expect(codes(validatePage(broken))).toContain("node.key-mismatch");
  });

  it("rejects dangling and duplicated children", () => {
    const { page, ids } = buildDesign();
    const dangling = clone(page);
    const frame = dangling.nodes[ids.frame] as FrameNode;
    frame.children.push(newId("nd"));
    expect(codes(validatePage(dangling))).toContain("children.dangling");

    const duplicated = clone(page);
    (duplicated.nodes[ids.frame] as FrameNode).children.push(ids.title);
    expect(codes(validatePage(duplicated))).toContain("children.duplicate");
  });

  it("rejects self-parenting", () => {
    const { page, ids } = buildDesign();
    const broken = clone(page);
    (broken.nodes[ids.frame] as FrameNode).children.push(ids.frame);
    expect(codes(validatePage(broken))).toContain("children.self");
  });

  it("rejects a node with two parents", () => {
    const { page, ids } = buildDesign();
    const second = createNode({ type: "frame", name: "Second" });
    const next = insertNode(page, second);
    (next.nodes[second.id] as FrameNode).children.push(ids.title);
    const found = codes(validatePage(next));
    expect(found).toContain("children.multi-parent");
  });

  it("rejects cycles", () => {
    const a = createNode({ type: "frame", name: "A" });
    const b = createNode({ type: "frame", name: "B" });
    let page = insertNode(createPage(), a);
    page = insertNode(page, b, { parentId: a.id });
    (page.nodes[b.id] as FrameNode).children.push(a.id);
    expect(codes(validatePage(page))).toContain("children.cycle");
  });

  it("rejects unreachable nodes", () => {
    const { page } = buildDesign();
    const broken = clone(page);
    const orphan = createNode({ type: "rect", name: "Orphan" });
    broken.nodes[orphan.id] = orphan;
    expect(codes(validatePage(broken))).toContain("node.unreachable");
  });

  it("checks geometry and ranges", () => {
    const { page, ids } = buildDesign();
    const broken = clone(page);
    broken.nodes[ids.frame].width = -1;
    const title = broken.nodes[ids.title] as TextNode;
    title.style = { ...title.style, opacity: 2 };
    const found = codes(validatePage(broken));
    expect(found).toContain("number.range");
  });

  it("checks layout, fonts, and gradients", () => {
    const { page, ids } = buildDesign();
    const badLayout = clone(page);
    (badLayout.nodes[ids.frame] as FrameNode).layout = {
      mode: "flex",
      direction: "diagonal" as never,
    };
    expect(codes(validatePage(badLayout))).toContain("enum.invalid");

    const badFont = clone(page);
    (badFont.nodes[ids.title] as TextNode).style = {
      font: { family: "Inter", size: 0 },
    };
    expect(codes(validatePage(badFont))).toContain("font.size");

    const gradient = createNode({
      type: "rect",
      name: "Gradient",
      style: {
        fills: [
          {
            type: "linear-gradient",
            angle: 90,
            stops: [
              { offset: 1, color: "#ffffff" },
              { offset: 0, color: "#000000" },
            ],
          },
        ],
      },
    });
    const withGradient = insertNode(page, gradient);
    expect(codes(validatePage(withGradient))).toContain("gradient.order");
  });

  it("resolves token references and reports missing or mistyped tokens", () => {
    const { design, page, ids } = buildDesign();

    const missing = clone(page);
    (missing.nodes[ids.title] as TextNode).style = {
      fills: [{ type: "solid", color: "{color.missing}" }],
    };
    expect(codes(validatePage(missing, { tokens: design.manifest.tokens }))).toContain(
      "token.unresolved",
    );

    const wrongType = clone(page);
    (wrongType.nodes[ids.title] as TextNode).style = {
      fills: [{ type: "solid", color: "{space.md}" }],
    };
    expect(codes(validatePage(wrongType, { tokens: design.manifest.tokens }))).toContain(
      "token.type",
    );

    const malformed = clone(page);
    (malformed.nodes[ids.title] as TextNode).style = {
      fills: [{ type: "solid", color: "{color.}" }],
    };
    expect(codes(validatePage(malformed, { tokens: design.manifest.tokens }))).toContain(
      "token.malformed",
    );

    const empty = clone(page);
    (empty.nodes[ids.title] as TextNode).style = { fills: [{ type: "solid", color: "" }] };
    expect(codes(validatePage(empty))).toContain("color.invalid");
  });

  it("checks asset references", () => {
    const { page } = buildDesign();
    const image = createNode({ type: "image", name: "Photo", asset: newId("as") });
    const next = insertNode(page, image);
    expect(codes(validatePage(next, { assets: [] }))).toContain("asset.unresolved");
    expect(codes(validatePage(next))).not.toContain("asset.unresolved");
  });

  it("checks snapshot metadata and file paths", () => {
    const { page } = buildDesign();
    const snapshot = createNode({
      type: "snapshot",
      name: "Captured",
      source: {
        url: "ftp://example.com",
        viewport: { width: 0, height: 0 },
        capturedAt: "yesterday",
      },
      files: { html: "../escape.html" },
    });
    const next = insertNode(page, snapshot);
    const found = codes(validatePage(next));
    expect(found).toContain("snapshot.url");
    expect(found).toContain("snapshot.viewport");
    expect(found).toContain("snapshot.date");
    expect(found).toContain("path.unsafe");

    const good = createNode({
      type: "snapshot",
      name: "Good capture",
      source: {
        url: "http://localhost:3000/pricing",
        selector: "main",
        viewport: { width: 1440, height: 900 },
        capturedAt: "2026-10-25T10:00:00.000Z",
        commit: "abc123",
      },
      files: { html: "snapshots/nd_01JAV3Q8ZK4M2TP9W6XH5NR7BC.html" },
    });
    expect(codes(validatePage(insertNode(page, good)))).toEqual([]);
  });

  it("rejects a malformed background paint", () => {
    const { page } = buildDesign();
    const broken = clone(page);
    broken.background = { type: "solid", color: "" };
    expect(codes(validatePage(broken))).toContain("color.invalid");
  });

  it("checks meta is plain JSON", () => {
    const { page } = buildDesign();
    const broken = clone(page);
    broken.meta = { fn: () => 1 } as unknown as JsonObject;
    expect(codes(validatePage(broken))).toContain("json.type");

    const nonFinite = clone(page);
    nonFinite.meta = { n: Number.NaN } as unknown as JsonObject;
    expect(codes(validatePage(nonFinite))).toContain("json.number");
  });

  it("preserves unknown fields", () => {
    const { page, ids } = buildDesign();
    const extended = clone(page) as unknown as Record<string, unknown>;
    extended.future = { enabled: true };
    const nodes = extended.nodes as Record<string, Record<string, unknown>>;
    nodes[ids.frame].future = 42;
    expect(validatePage(extended)).toEqual([]);
  });
});

describe("manifest validation", () => {
  it("accepts a valid manifest", () => {
    expect(validateManifest(createDesign().manifest)).toEqual([]);
  });

  it("checks the envelope and pages", () => {
    const broken = clone(createDesign().manifest) as unknown as Record<string, unknown>;
    broken.format = "nope";
    broken.version = 99;
    broken.id = "nope";
    broken.name = "";
    broken.pages = [];
    const found = codes(validateManifest(broken));
    expect(found).toContain("format.invalid");
    expect(found).toContain("version.unsupported");
    expect(found).toContain("id.invalid");
    expect(found).toContain("type.non-empty");
    expect(found).toContain("pages.empty");
  });

  it("rejects unsafe and duplicate page files", () => {
    const manifest = clone(createDesign().manifest);
    manifest.pages[0].file = "../escape.json";
    expect(codes(validateManifest(manifest))).toContain("path.unsafe");

    const duplicate = clone(createDesign().manifest);
    duplicate.pages.push({ ...duplicate.pages[0] });
    const found = codes(validateManifest(duplicate));
    expect(found).toContain("page.duplicate");
    expect(found).toContain("page.duplicate-file");
  });

  it("checks token names and values", () => {
    const manifest = clone(createDesign().manifest);
    manifest.tokens = {
      "a.b": "#ffffff",
      constructor: "#000000",
      space: { md: Number.NaN },
    } as unknown as TokenTree;
    const found = codes(validateManifest(manifest));
    expect(found.filter((code) => code === "token.key")).toHaveLength(2);
    expect(found).toContain("token.value");
  });

  it("checks assets", () => {
    const manifest = clone(createDesign().manifest);
    const id = newId("as");
    manifest.assets = [
      { id, file: "assets/logo.svg", mime: "image/svg+xml" },
      { id, file: "assets/logo.svg", mime: "" },
    ];
    const found = codes(validateManifest(manifest));
    expect(found).toContain("asset.duplicate");
    expect(found).toContain("asset.duplicate-file");
    expect(found).toContain("asset.mime");
  });

  it("checks manifest meta", () => {
    const manifest = clone(createDesign().manifest);
    manifest.meta = { fn: () => 1 } as unknown as JsonObject;
    expect(codes(validateManifest(manifest))).toContain("json.type");
  });
});

describe("design validation", () => {
  it("accepts a valid design and catches a missing page", () => {
    const { design } = buildDesign();
    expect(validateDesign(design.manifest, design.pages)).toEqual([]);
    expect(codes(validateDesign(design.manifest, []))).toContain("page.missing");
  });

  it("requires page names to match the manifest", () => {
    const { design, page } = buildDesign();
    const renamed = clone(page);
    renamed.name = "Other";
    expect(codes(validateDesign(design.manifest, [renamed]))).toContain("page.name-mismatch");
  });

  it("rejects pages that are not in the manifest", () => {
    const { design } = buildDesign();
    const extra = createPage({ name: "Extra" });
    expect(codes(validateDesign(design.manifest, [...design.pages, extra]))).toContain(
      "page.unreferenced",
    );
  });

  it("rejects duplicate page documents", () => {
    const { design, page } = buildDesign();
    const found = codes(validateDesign(design.manifest, [page, page]));
    expect(found).toContain("page.duplicate-document");
    expect(found).toContain("node.duplicate-global");
  });

  it("rejects node ids reused across pages", () => {
    const { design, page, ids } = buildDesign();
    const { design: twoPages } = addPage(design, "Second");
    const copy = clone(page.nodes[ids.title]);
    const secondPage = twoPages.pages[1];
    secondPage.nodes[copy.id] = copy;
    secondPage.children.push(copy.id);
    expect(codes(validateDesign(twoPages.manifest, twoPages.pages))).toContain(
      "node.duplicate-global",
    );
  });

  it("throws a typed error from assertValidDesign", () => {
    const { design, page } = buildDesign();
    expect(() => assertValidDesign(design.manifest, design.pages)).not.toThrow();
    try {
      assertValidDesign({ ...design.manifest, name: "" }, [page]);
      throw new Error("expected assertion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WeftValidationError);
      expect((error as WeftValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("path safety", () => {
  it("accepts safe relative paths", () => {
    expect(isSafeRelativePath("pages/landing.json")).toBe(true);
    expect(isSafeRelativePath("assets/logo.svg")).toBe(true);
    expect(isSafeRelativePath("snapshots/nd_1.html")).toBe(true);
  });

  it("rejects escapes and absolute paths", () => {
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("../secret.json")).toBe(false);
    expect(isSafeRelativePath("pages/../secret.json")).toBe(false);
    expect(isSafeRelativePath("C:\\secret.json")).toBe(false);
    expect(isSafeRelativePath("pages\\secret.json")).toBe(false);
    expect(isSafeRelativePath("./secret.json")).toBe(false);
    expect(isSafeRelativePath("pages//secret.json")).toBe(false);
  });
});
