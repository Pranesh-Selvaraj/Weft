import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDesign,
  createNode,
  insertNode,
  newId,
  serialize,
  WeftValidationError,
  type DesignFile,
  type SnapshotNode,
  type TextNode,
} from "@weft/core";
import {
  formatDesign,
  initDesign,
  inspectDesign,
  MANIFEST_FILE,
  readDesign,
  readSnapshotPayloads,
  resolveDesignPath,
  summarizeDesign,
  writeDesign,
  writePageFile,
  writeSnapshotFiles,
  WeftIoError,
} from "../src/index.js";

let root: string;
let designDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-io-"));
  designDir = join(root, "demo.weft");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildDesign(): DesignFile {
  const base = createDesign({
    name: "Demo",
    pageName: "Landing",
    tokens: { color: { ink: "#111111", surface: "#ffffff" }, space: { md: 16 } },
  });
  const frame = createNode({
    type: "frame",
    name: "Card",
    width: 400,
    height: 300,
    style: { fills: [{ type: "solid", color: "{color.surface}" }] },
  });
  const title = createNode({
    type: "text",
    name: "Title",
    content: "Hello",
    style: { fills: [{ type: "solid", color: "{color.ink}" }] },
  });
  let page = insertNode(base.pages[0], frame);
  page = insertNode(page, title, { parentId: frame.id });
  return { manifest: base.manifest, pages: [page] };
}

async function pagePath(design: DesignFile): Promise<string> {
  return join(designDir, design.manifest.pages[0].file);
}

describe("initDesign", () => {
  it("creates a valid design directory", async () => {
    const result = await initDesign(designDir, { name: "Demo", pageName: "Landing" });
    expect(result.design.manifest.name).toBe("Demo");
    expect(await readDesign(designDir)).toEqual(result.design);

    const manifestText = await readFile(join(designDir, MANIFEST_FILE), "utf8");
    expect(manifestText).toBe(serialize(result.design.manifest));
    const pageText = await readFile(join(designDir, result.design.manifest.pages[0].file), "utf8");
    expect(pageText).toBe(serialize(result.design.pages[0]));
  });

  it("refuses a non-empty directory unless forced", async () => {
    await mkdir(designDir, { recursive: true });
    await writeFile(join(designDir, "keep.txt"), "hello", "utf8");
    try {
      await initDesign(designDir);
      throw new Error("expected init to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WeftIoError);
      expect((error as WeftIoError).code).toBe("init.not-empty");
    }

    const forced = await initDesign(designDir, { force: true, name: "Forced" });
    expect(forced.design.manifest.name).toBe("Forced");
    expect(await readFile(join(designDir, "keep.txt"), "utf8")).toBe("hello");
  });
});

describe("writeDesign and readDesign", () => {
  it("round-trips a design", async () => {
    const design = buildDesign();
    const result = await writeDesign(designDir, design);
    expect(result.written[0]).toBe(MANIFEST_FILE);
    expect(await readDesign(designDir)).toEqual(design);
    expect((await inspectDesign(designDir)).issues).toEqual([]);
  });

  it("does not delete unrelated files", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    await writeFile(join(designDir, "notes.md"), "keep me", "utf8");
    await writeDesign(designDir, design);
    expect(await readFile(join(designDir, "notes.md"), "utf8")).toBe("keep me");
  });

  it("throws a validation error for an invalid design", async () => {
    const design = buildDesign();
    design.pages[0].nodes[design.pages[0].children[0]].width = -1;
    await expect(writeDesign(designDir, design)).rejects.toBeInstanceOf(WeftValidationError);
  });

  it("throws when a page file is missing", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    await rm(await pagePath(design));
    await expect(readDesign(designDir)).rejects.toBeInstanceOf(WeftValidationError);
  });
});

describe("inspectDesign", () => {
  it("reports a missing manifest", async () => {
    await mkdir(designDir, { recursive: true });
    const inspection = await inspectDesign(designDir);
    expect(inspection.issues.map((issue) => issue.code)).toContain("file.missing");
    expect(inspection.pages).toEqual([]);
  });

  it("reports broken JSON and the missing page", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    await writeFile(await pagePath(design), "{", "utf8");
    const codes = (await inspectDesign(designDir)).issues.map((issue) => issue.code);
    expect(codes).toContain("file.json");
    expect(codes).toContain("page.missing");
  });

  it("reports a page id that does not match the manifest", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const path = await pagePath(design);
    const page = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    page.id = newId("pg");
    await writeFile(path, JSON.stringify(page, null, 2), "utf8");

    const codes = (await inspectDesign(designDir)).issues.map((issue) => issue.code);
    expect(codes).toContain("page.id-mismatch");
    expect(codes).toContain("page.missing");
  });

  it("reports missing assets and snapshots", async () => {
    const base = createDesign({ name: "Assets", pageName: "Landing" });
    const assetId = newId("as");
    base.manifest.assets = [
      { id: assetId, file: "assets/missing.svg", mime: "image/svg+xml" },
    ];
    const snapshot = createNode({
      type: "snapshot",
      name: "Capture",
      source: {
        url: "http://localhost:3000/",
        viewport: { width: 1440, height: 900 },
        capturedAt: "2026-10-25T00:00:00.000Z",
      },
      files: { html: `snapshots/${"nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE"}.html` },
    });
    const page = insertNode(base.pages[0], snapshot);
    const design: DesignFile = { manifest: base.manifest, pages: [page] };
    await writeDesign(designDir, design);

    const inspection = await inspectDesign(designDir);
    const codes = inspection.issues.map((issue) => issue.code);
    expect(codes).toContain("asset.missing");
    expect(codes).toContain("snapshot.missing");

    const withoutFiles = await inspectDesign(designDir, { requireFiles: false });
    expect(withoutFiles.issues).toEqual([]);
  });

  it("rejects unsafe page paths", async () => {
    await mkdir(designDir, { recursive: true });
    const pageId = newId("pg");
    await writeFile(
      join(designDir, MANIFEST_FILE),
      serialize({
        format: "weft",
        version: 1,
        id: newId("ds"),
        name: "Unsafe",
        pages: [{ id: pageId, name: "Landing", file: "../escape.json" }],
      }),
      "utf8",
    );
    const codes = (await inspectDesign(designDir)).issues.map((issue) => issue.code);
    expect(codes).toContain("path.unsafe");
    expect(codes).toContain("page.missing");
  });

  it("is stable for the starter example", async () => {
    const starter = join(process.cwd(), "../../examples/starter.weft");
    const inspection = await inspectDesign(starter);
    expect(inspection.issues).toEqual([]);
    expect(inspection.manifest?.name).toBe("Weft starter");
    expect(inspection.pages).toHaveLength(1);
  });
});

describe("formatDesign", () => {
  it("reports and rewrites non-canonical JSON", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const file = await pagePath(design);
    const page = JSON.parse(await readFile(file, "utf8")) as unknown;
    await writeFile(file, JSON.stringify(page, null, 4), "utf8");

    const check = await formatDesign(designDir, { write: false });
    expect(check.changed).toEqual([design.manifest.pages[0].file]);
    expect(await readFile(file, "utf8")).toBe(JSON.stringify(page, null, 4));

    const written = await formatDesign(designDir);
    expect(written.changed).toEqual([design.manifest.pages[0].file]);
    expect(await readFile(file, "utf8")).toBe(serialize(design.pages[0]));

    const second = await formatDesign(designDir, { write: false });
    expect(second.changed).toEqual([]);
  });

  it("formats the manifest too", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const path = join(designDir, MANIFEST_FILE);
    const manifest = JSON.parse(await readFile(path, "utf8")) as unknown;
    await writeFile(path, JSON.stringify(manifest, null, 4), "utf8");
    expect((await formatDesign(designDir)).changed).toEqual([MANIFEST_FILE]);
  });

  it("refuses to format an invalid design", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const file = await pagePath(design);
    const page = JSON.parse(await readFile(file, "utf8")) as {
      nodes: Record<string, { width: number }>;
      children: string[];
    };
    page.nodes[page.children[0]].width = -1;
    await writeFile(file, JSON.stringify(page), "utf8");
    await expect(formatDesign(designDir)).rejects.toBeInstanceOf(WeftValidationError);
  });
});

describe("summary and paths", () => {
  it("summarizes pages, nodes, tokens and assets", async () => {
    const design = buildDesign();
    const assetId = newId("as");
    design.manifest.assets = [{ id: assetId, file: "assets/logo.svg", mime: "image/svg+xml" }];
    await writeDesign(designDir, design);
    const inspection = await inspectDesign(designDir, { requireFiles: false });
    const summary = summarizeDesign(
      inspection.manifest!,
      inspection.pages,
      inspection.pageFiles,
    );
    expect(summary.pageCount).toBe(1);
    expect(summary.nodeCount).toBe(2);
    expect(summary.nodeTypes).toEqual({ frame: 1, text: 1 });
    expect(summary.tokenCount).toBe(3);
    expect(summary.assetCount).toBe(1);
    expect(summary.snapshotCount).toBe(0);
    expect(summary.pages[0].file).toBe("pages/landing.json");
  });

  it("rejects paths that escape the design", () => {
    expect(() => resolveDesignPath(designDir, "../secret.json")).toThrow(WeftIoError);
    expect(() => resolveDesignPath(designDir, "/etc/passwd")).toThrow(WeftIoError);
    expect(() => resolveDesignPath(designDir, "pages/../secret.json")).toThrow(WeftIoError);
    expect(resolveDesignPath(designDir, "pages/landing.json")).toBe(
      join(designDir, "pages/landing.json"),
    );
  });
});

describe("writePageFile", () => {
  it("writes one page without touching the manifest", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const manifestBefore = await readFile(join(designDir, MANIFEST_FILE), "utf8");

    const page = structuredClone(design.pages[0]);
    const text = Object.values(page.nodes).find((node) => node.type === "text") as TextNode;
    text.content = "Single page update";
    await writePageFile(designDir, design.manifest.pages[0].file, page);

    const loaded = await readDesign(designDir);
    expect((loaded.pages[0].nodes[text.id] as TextNode).content).toBe("Single page update");
    expect(await readFile(join(designDir, MANIFEST_FILE), "utf8")).toBe(manifestBefore);
  });

  it("refuses an invalid page", async () => {
    const design = buildDesign();
    await writeDesign(designDir, design);
    const page = structuredClone(design.pages[0]);
    page.nodes[page.children[0]].width = -1;
    await expect(
      writePageFile(designDir, design.manifest.pages[0].file, page),
    ).rejects.toBeInstanceOf(WeftValidationError);
  });
});

describe("snapshot payloads", () => {
  it("writes and reads snapshot files with derived safe paths", async () => {
    const design = buildDesign();
    const nodeId = newId("nd");
    const written = await writeSnapshotFiles(designDir, nodeId, {
      html: '<div data-weft-k="0">captured</div>',
      css: '[data-weft-k="0"]{color:#111}',
    });
    expect(written.files.html).toBe(`snapshots/${nodeId}.html`);
    expect(written.files.css).toBe(`snapshots/${nodeId}.css`);

    const snapshot = createNode({
      type: "snapshot",
      id: nodeId,
      source: {
        url: "http://127.0.0.1:3000/",
        viewport: { width: 800, height: 600 },
        capturedAt: "2026-10-25T00:00:00.000Z",
      },
      files: written.files,
    }) as SnapshotNode;
    const page = insertNode(design.pages[0], snapshot);
    await writeDesign(designDir, { ...design, pages: [page] });

    const payloads = await readSnapshotPayloads(designDir, [page]);
    expect(payloads[nodeId]).toEqual({
      html: '<div data-weft-k="0">captured</div>',
      css: '[data-weft-k="0"]{color:#111}',
    });
  });

  it("skips missing payloads and rejects unsafe paths", async () => {
    const design = buildDesign();
    const nodeId = newId("nd");
    const written = await writeSnapshotFiles(designDir, nodeId, { html: "<div />" });
    const snapshot = createNode({
      type: "snapshot",
      id: nodeId,
      source: {
        url: "http://127.0.0.1:3000/",
        viewport: { width: 800, height: 600 },
        capturedAt: "2026-10-25T00:00:00.000Z",
      },
      files: { html: written.files.html, css: "snapshots/missing.css" },
    }) as SnapshotNode;
    const page = insertNode(design.pages[0], snapshot);
    const payloads = await readSnapshotPayloads(designDir, [page]);
    expect(payloads[nodeId]).toEqual({ html: "<div />" });

    const unsafe = structuredClone(snapshot);
    unsafe.files.html = "../outside.html";
    await expect(readSnapshotPayloads(designDir, [insertNode(design.pages[0], unsafe)])).rejects.toBeInstanceOf(
      WeftIoError,
    );
  });
});
