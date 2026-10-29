import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPage,
  createDesign,
  createNode,
  insertNode,
  newId,
  type DesignFile,
} from "@weft/core";
import { writeDesign, writeSnapshotFiles } from "@weft/design-io";
import { ExportError, exportDesign } from "../src/index.js";

let root: string;
let designDir: string;
let design: DesignFile;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-export-"));
  designDir = join(root, "handoff.weft");
  const base = createDesign({ name: "Handoff design", pageName: "Landing" });
  const heading = createNode({ type: "text", content: "Exported heading" });
  const firstPage = insertNode(base.pages[0], heading);
  const snapshotId = newId("nd");
  const files = await writeSnapshotFiles(designDir, snapshotId, {
    html: '<div class="captured">Captured payload</div>',
    css: ".captured{color:#111}",
  });
  const snapshot = createNode({
    type: "snapshot",
    id: snapshotId,
    source: {
      url: "http://127.0.0.1:3000/",
      viewport: { width: 480, height: 320 },
      capturedAt: "2026-10-25T00:00:00.000Z",
    },
    files: files.files,
  });
  const withSnapshot = insertNode(firstPage, snapshot);
  const withSecond = addPage({ manifest: base.manifest, pages: [withSnapshot] }, "Pricing");
  const secondPage = insertNode(
    withSecond.page,
    createNode({ type: "text", content: "Pricing copy" }),
  );
  design = {
    manifest: withSecond.design.manifest,
    pages: [withSnapshot, secondPage],
  };
  await writeDesign(designDir, design);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("exportDesign", () => {
  it("exports pages, index, tokens and a handoff manifest", async () => {
    const out = join(root, "out");
    const result = await exportDesign({ designDir, outDir: out });
    expect(result.pages.map((page) => page.file)).toEqual([
      "pages/landing.html",
      "pages/pricing.html",
    ]);
    expect(result.files).toEqual(
      expect.arrayContaining([
        "index.html",
        "pages/landing.html",
        "pages/pricing.html",
        "weft.export.json",
      ]),
    );
    const landing = await readFile(join(out, "pages/landing.html"), "utf8");
    expect(landing).toContain("Exported heading");
    expect(landing).toContain("Captured payload");
    expect(landing).toContain('sandbox=""');
    expect(landing).not.toContain("<script");
    const index = await readFile(join(out, "index.html"), "utf8");
    expect(index).toContain("Handoff design");
    expect(index).toContain("Landing");
    expect(index).toContain("Pricing");
    const manifest = JSON.parse(await readFile(join(out, "weft.export.json"), "utf8"));
    expect(manifest).toMatchObject({
      format: "weft.export",
      version: 1,
      design: { name: "Handoff design" },
    });
    expect(manifest.pages).toHaveLength(2);
  });

  it("exports one page by id or name", async () => {
    const out = join(root, "one");
    const result = await exportDesign({ designDir, outDir: out, page: "Pricing" });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].name).toBe("Pricing");
    const html = await readFile(join(out, "pages/pricing.html"), "utf8");
    expect(html).toContain("Pricing copy");
    expect(html).not.toContain("Exported heading");

    await expect(
      exportDesign({ designDir, outDir: join(root, "missing"), page: "Nope" }),
    ).rejects.toMatchObject({ code: "export.page" });
  });

  it("refuses a non-empty output directory unless forced", async () => {
    const out = join(root, "occupied");
    await writeFile(join(out, "keep.txt"), "keep").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, "keep.txt"), "keep");
    });
    await expect(exportDesign({ designDir, outDir: out })).rejects.toBeInstanceOf(
      ExportError,
    );
    await exportDesign({ designDir, outDir: out, force: true });
    expect(await readFile(join(out, "keep.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(out, "index.html"), "utf8")).toContain("Handoff design");
  });
});
