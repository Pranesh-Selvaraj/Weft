import { describe, expect, it } from "vitest";
import {
  addPage,
  createDesign,
  createPage,
  getPage,
  getPageRef,
  removePage,
  slugify,
  updatePage,
  validateDesign,
  validateManifest,
  WeftOperationError,
} from "../src/index.js";

describe("design construction", () => {
  it("creates a design with one empty page", () => {
    const design = createDesign({ name: "Marketing", pageName: "Landing" });
    expect(design.pages).toHaveLength(1);
    expect(design.pages[0].name).toBe("Landing");
    expect(design.manifest.pages).toEqual([
      { id: design.pages[0].id, name: "Landing", file: "pages/landing.json" },
    ]);
    expect(validateDesign(design.manifest, design.pages)).toEqual([]);
  });

  it("trims names and falls back when empty", () => {
    const design = createDesign({ name: "  ", pageName: "  " });
    expect(design.manifest.name).toBe("Untitled design");
    expect(design.pages[0].name).toBe("Page 1");
  });

  it("copies tokens into the manifest", () => {
    const tokens = { color: { ink: "#111111" } };
    const design = createDesign({ tokens });
    expect(design.manifest.tokens).toEqual(tokens);
    tokens.color.ink = "#000000";
    expect(design.manifest.tokens).toEqual({ color: { ink: "#111111" } });
  });

  it("adds pages with unique file names", () => {
    const first = createDesign({ pageName: "Landing" });
    const second = addPage(first, "Landing");
    expect(second.design.pages).toHaveLength(2);
    expect(second.design.manifest.pages.map((page) => page.file)).toEqual([
      "pages/landing.json",
      "pages/landing-2.json",
    ]);
    expect(validateDesign(second.design.manifest, second.design.pages)).toEqual([]);
  });

  it("updates a page name in the manifest but not its file", () => {
    const design = createDesign({ pageName: "Landing" });
    const renamed = updatePage(design, design.pages[0].id, { name: "Home" });
    expect(renamed.pages[0].name).toBe("Home");
    expect(renamed.manifest.pages[0].name).toBe("Home");
    expect(renamed.manifest.pages[0].file).toBe("pages/landing.json");
    expect(validateDesign(renamed.manifest, renamed.pages)).toEqual([]);
  });

  it("updates background and meta", () => {
    const design = createDesign();
    const pageId = design.pages[0].id;
    const updated = updatePage(design, pageId, {
      background: { type: "solid", color: "#ffffff" },
      meta: { note: "hello" },
    });
    expect(updated.pages[0].background).toEqual({ type: "solid", color: "#ffffff" });
    expect(updated.pages[0].meta).toEqual({ note: "hello" });
    const cleared = updatePage(updated, pageId, { background: null, meta: null });
    expect(cleared.pages[0].background).toBeNull();
    expect(cleared.pages[0].meta).toBeUndefined();
  });

  it("finds pages by id and name", () => {
    const design = createDesign({ pageName: "Landing" });
    const page = design.pages[0];
    expect(getPage(design, page.id)).toBe(page);
    expect(getPage(design, "Landing")).toBe(page);
    expect(getPage(design, "Missing")).toBeUndefined();
    expect(getPageRef(design.manifest, page.id)?.file).toBe("pages/landing.json");
  });

  it("removes pages but keeps the last one", () => {
    const first = createDesign();
    const withSecond = addPage(first, "Second").design;
    const removed = removePage(withSecond, withSecond.pages[1].id);
    expect(removed.pages).toHaveLength(1);
    expect(validateDesign(removed.manifest, removed.pages)).toEqual([]);
    expect(() => removePage(removed, removed.pages[0].id)).toThrow(WeftOperationError);
    expect(() => removePage(removed, "pg_missing")).toThrow(WeftOperationError);
  });

  it("rejects inconsistent page updates", () => {
    const design = createDesign();
    expect(() => updatePage(design, "pg_missing", { name: "x" })).toThrow(WeftOperationError);
    expect(() => updatePage(design, design.pages[0].id, { name: "  " })).toThrow(WeftOperationError);
  });

  it("slugifies names for file paths", () => {
    expect(slugify("Landing Page")).toBe("landing-page");
    expect(slugify("  Crème brûlée  ")).toBe("creme-brulee");
    expect(slugify("!!!")).toBe("page");
    expect(slugify("A".repeat(80))).toHaveLength(48);
  });

  it("rejects an invalid page id", () => {
    expect(() => createPage({ id: "nope" })).toThrow(WeftOperationError);
  });

  it("reports manifest errors through validation", () => {
    const design = createDesign();
    const broken = {
      ...design.manifest,
      pages: [{ ...design.manifest.pages[0], file: "../escape.json" }],
    };
    const issues = validateManifest(broken);
    expect(issues.map((issue) => issue.code)).toContain("path.unsafe");
  });
});
