import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  collectTokenRefs,
  findNodes,
  getChildren,
  lookupToken,
  parseJson,
  serialize,
  validateDesign,
  walkAllNodes,
  type DesignManifest,
  type FrameNode,
  type PageDocument,
  type TextNode,
} from "../src/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const designDir = path.join(repoRoot, "examples/starter.weft");

const manifestText = readFileSync(path.join(designDir, "weft.json"), "utf8");
const manifest = parseJson(manifestText) as DesignManifest;
const pageTexts = manifest.pages.map((ref) => ({
  ref,
  text: readFileSync(path.join(designDir, ref.file), "utf8"),
}));
const pages = pageTexts.map(({ text }) => parseJson(text) as PageDocument);

function named(page: PageDocument, name: string) {
  const [node] = findNodes(page, (candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing fixture node ${name}`);
  return node;
}

describe("starter example", () => {
  it("is a valid design", () => {
    expect(validateDesign(manifest, pages)).toEqual([]);
  });

  it("is stored in canonical form", () => {
    expect(serialize(manifest)).toBe(manifestText);
    for (const { ref, text } of pageTexts) {
      expect(text.startsWith("{\n")).toBe(true);
      expect(text.endsWith("\n")).toBe(true);
      expect(serialize(parseJson(text) as PageDocument)).toBe(text);
      expect(ref.file).toBe("pages/landing.json");
    }
  });

  it("keeps the manifest and page in sync", () => {
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe(manifest.pages[0].id);
    expect(pages[0].name).toBe(manifest.pages[0].name);
    expect(manifest.pages[0].file).toBe("pages/landing.json");
  });

  it("has a readable, unique layer tree", () => {
    const page = pages[0];
    const nodes = [...walkAllNodes(page)];
    expect(nodes).toHaveLength(13);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(13);
    expect(nodes.every((node) => node.name.trim().length > 0)).toBe(true);

    const hero = named(page, "Hero") as FrameNode;
    expect(hero.type).toBe("frame");
    expect(getChildren(page, hero.id).map((node) => node.name)).toEqual([
      "Eyebrow",
      "Heading",
      "Body",
      "Button",
      "Feature row",
    ]);
    const row = named(page, "Feature row");
    expect(getChildren(page, row.id).map((node) => node.name)).toEqual([
      "Extract card",
      "Together card",
    ]);
    expect(getChildren(page, named(page, "Button").id).map((node) => node.name)).toEqual([
      "Button label",
    ]);
    expect(getChildren(page, named(page, "Extract card").id)).toHaveLength(2);
    expect(getChildren(page, named(page, "Together card").id)).toHaveLength(2);
  });

  it("keeps content as real text", () => {
    expect((named(pages[0], "Heading") as TextNode).content).toBe(
      "Design files agents can read.",
    );
    expect((named(pages[0], "Eyebrow") as TextNode).content).toBe("AGENT-NATIVE DESIGN");
    expect((named(pages[0], "Button label") as TextNode).content).toBe("Open the canvas");
    expect((named(pages[0], "Body") as TextNode).content).toContain("coding agent");
  });

  it("resolves every token reference in the page", () => {
    const page = pages[0];
    const tokens = manifest.tokens;
    expect(tokens).toBeDefined();

    const refs = new Set<string>(collectTokenRefs(page.background));
    for (const node of walkAllNodes(page)) {
      for (const ref of collectTokenRefs(node.style)) refs.add(ref);
    }

    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(lookupToken(tokens, ref), `missing token ${ref}`).toBeDefined();
    }
    expect(lookupToken(tokens, "color.surface")).toBe("#F4F1E8");
    expect(lookupToken(tokens, "color.accent")).toBe("#3B5BDB");
    expect(lookupToken(tokens, "space.3xl")).toBe(96);
    expect(lookupToken(tokens, "radius.pill")).toBe(999);
  });

  it("uses only schema features that the first editor will support", () => {
    const page = pages[0];
    expect(page.background).toEqual({ type: "solid", color: "{color.surface}" });
    expect(manifest.assets).toBeUndefined();
    for (const node of walkAllNodes(page)) {
      expect(["frame", "text"]).toContain(node.type);
      expect(Number.isFinite(node.width)).toBe(true);
      expect(Number.isFinite(node.height)).toBe(true);
    }
  });
});
