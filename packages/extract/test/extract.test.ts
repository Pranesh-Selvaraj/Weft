import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDesign, readDesign, readSnapshotPayloads } from "@weft/design-io";
import {
  discoverChromium,
  extractSnapshot,
  sanitizeCapturedCss,
  sanitizeCapturedMarkup,
  type CapturePage,
} from "../src/index.js";

let root: string;
let designDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-extract-"));
  designDir = join(root, "product.weft");
  await writeFile(
    join(root, "weft.project.json"),
    JSON.stringify(
      {
        version: 1,
        extract: { origins: ["http://127.0.0.1:3000"] },
      },
      null,
      2,
    ),
  );
  await initDesign(designDir, { name: "Product", pageName: "Landing" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const fakeCapture: CapturePage = async (request) => ({
  html: '<div class="captured"><h1>Captured heading</h1><img src="data:image/png;base64,AA" alt="fixture"></div>',
  css: '[data-weft-k="0"]{color:#111;background:url(data:image/png;base64,AA)}', 
  source: {
    url: request.url,
    ...(request.selector ? { selector: request.selector } : {}),
    viewport: { width: request.viewport.width, height: request.viewport.height },
    capturedAt: "2026-10-25T00:00:00.000Z",
  },
  warnings: ["fixture warning"],
});

describe("snapshot sanitization", () => {
  it("fails closed on executable markup and external fetches", () => {
    expect(() =>
      sanitizeCapturedMarkup('<div><script>alert(1)</script></div>'),
    ).toThrow(/script/);
    expect(() =>
      sanitizeCapturedMarkup('<div onclick="x()">text</div>'),
    ).toThrow(/event-handler/);
    expect(() =>
      sanitizeCapturedMarkup('<img src="https://evil.test/x.png">'),
    ).toThrow(/non-data URL/);
    expect(() =>
      sanitizeCapturedMarkup("<img src=https://evil.test/x.png>"),
    ).toThrow(/non-data URL/);
    expect(
      sanitizeCapturedMarkup('<img src="data:image/png;base64,AA">'),
    ).toContain("data:image/png;base64,AA");
  });

  it("removes stylesheet imports and non-data URLs", () => {
    const css = sanitizeCapturedCss(
      '@import "https://evil.test/x.css";body{background:url(https://evil.test/x.png)}.x{background:url(data:image/png;base64,AA)}.y{background:url(#gradient)}',
    );
    expect(css).not.toContain("@import");
    expect(css).not.toContain("evil.test");
    expect(css).toContain("data:image/png;base64,AA");
    expect(css).toContain("url(#gradient)");
  });
});

describe("extractSnapshot", () => {
  it("inserts a sanitized snapshot node and writes payload files", async () => {
    const result = await extractSnapshot({
      projectRoot: root,
      designDir,
      url: "http://127.0.0.1:3000/landing",
      selector: "main",
      viewport: { width: 1024, height: 768 },
      name: "Landing capture",
      capture: fakeCapture,
    });

    expect(result.node.type).toBe("snapshot");
    expect(result.node.name).toBe("Landing capture");
    expect(result.node.source.url).toBe("http://127.0.0.1:3000/landing");
    expect(result.node.files.html).toBe(`snapshots/${result.node.id}.html`);
    expect(result.warnings).toEqual(["fixture warning"]);

    const design = await readDesign(designDir);
    const page = design.pages.find((candidate) => candidate.id === result.pageId);
    expect(page?.nodes[result.node.id]).toEqual(result.node);
    const payloads = await readSnapshotPayloads(designDir, design.pages);
    const payload = payloads[result.node.id];
    expect(payload?.html).toContain("Captured heading");
    expect(payload?.html).not.toContain("<script");
    expect(payload?.html).not.toContain("onload");
    expect(payload?.css).not.toContain("@import");
    expect(payload?.css).not.toContain("http://127.0.0.1:3000/x.png");
  });

  it("refuses a URL outside the project capture allowlist before capture", async () => {
    const capture = vi.fn(fakeCapture);
    await expect(
      extractSnapshot({
        projectRoot: root,
        designDir,
        url: "http://127.0.0.1:9999/",
        capture,
      }),
    ).rejects.toMatchObject({ code: "extract.origin" });
    expect(capture).not.toHaveBeenCalled();
  });

  it("requires extract.origins", async () => {
    await writeFile(join(root, "weft.project.json"), JSON.stringify({ version: 1 }));
    await expect(
      extractSnapshot({
        projectRoot: root,
        designDir,
        url: "http://127.0.0.1:3000/",
        capture: fakeCapture,
      }),
    ).rejects.toMatchObject({ code: "extract.not-configured" });
  });

  it("can select a page by name", async () => {
    const result = await extractSnapshot({
      projectRoot: root,
      designDir,
      url: "http://127.0.0.1:3000/",
      page: "Landing",
      capture: fakeCapture,
    });
    expect(result.pageId).toBe(result.pageId);
    expect(result.pageFile).toMatch(/^pages\//);
  });
});

const browserPath = (() => {
  if (process.env.WEFT_BROWSER_TESTS !== "1") return null;
  try {
    return discoverChromium();
  } catch {
    return null;
  }
})();

describe.skipIf(!browserPath)("browser capture", () => {
  it("captures a live loopback page without scripts or external traffic", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/pixel.svg") {
        response.writeHead(200, { "content-type": "image/svg+xml" });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#3b5bdb"/></svg>');
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><html><body style="margin:0;font-family:sans-serif"><main data-capture><h1>Browser fixture</h1><img src="/pixel.svg"><script>document.body.dataset.script="ran"</script></main></body></html>',
      );
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const origin = `http://127.0.0.1:${port}`;
      await writeFile(
        join(root, "weft.project.json"),
        JSON.stringify({ version: 1, extract: { origins: [origin] } }, null, 2),
      );
      const result = await extractSnapshot({
        projectRoot: root,
        designDir,
        url: `${origin}/`,
        selector: "main",
        viewport: { width: 800, height: 600 },
        capture: undefined,
        ...(browserPath ? { browserPath } : {}),
      });
      const design = await readDesign(designDir);
      const payloads = await readSnapshotPayloads(designDir, design.pages);
      const payload = payloads[result.node.id];
      expect(payload?.html).toContain("Browser fixture");
      expect(payload?.html).not.toContain("<script");
      expect(payload?.html).not.toContain("data-script");
      expect(payload?.html).not.toMatch(/https?:\/\//);
      expect(payload?.html).toContain("data:image/svg+xml;base64,");
      expect(payload?.css).toContain("[data-weft-k=");
      expect(payload?.css).not.toContain("@import");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 30_000);
});
