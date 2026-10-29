import { unlink } from "node:fs/promises";
import {
  createNode,
  insertNode,
  newId,
  type PageDocument,
  type SnapshotNode,
} from "@weft/core";
import {
  readDesign,
  resolveDesignPath,
  writePageFile,
  writeSnapshotFiles,
  type SnapshotPayload,
} from "@weft/design-io";
import { loadProjectConfig } from "@weft/dev-server";
import { assertAllowedUrl } from "./allowlist.js";
import { captureWithPlaywright } from "./browser.js";
import { ExtractError } from "./errors.js";
import {
  sanitizeCapturedCss,
  sanitizeCapturedMarkup,
} from "./sanitize.js";
import type { CapturePage, ExtractOptions, ExtractResult } from "./types.js";

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function validateViewport(value: { width: number; height: number }): { width: number; height: number } {
  if (
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width > 20_000 ||
    value.height > 20_000
  ) {
    throw new ExtractError(
      "extract.viewport",
      "Viewport width and height must be integers between 1 and 20000.",
    );
  }
  return value;
}

function selectPage(
  pages: readonly PageDocument[],
  selector: string | undefined,
): PageDocument {
  if (!selector) {
    const first = pages[0];
    if (!first) throw new ExtractError("extract.page", "The design has no pages.");
    return first;
  }
  const matches = pages.filter((page) => page.id === selector || page.name === selector);
  if (matches.length === 0) {
    throw new ExtractError("extract.page", `No page matches ${JSON.stringify(selector)}.`);
  }
  if (matches.length > 1) {
    throw new ExtractError(
      "extract.page",
      `Page name ${JSON.stringify(selector)} is ambiguous; pass a page id.`,
    );
  }
  return matches[0];
}

function defaultName(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `Captured ${parsed.host}${path}`.slice(0, 120);
}

function sanitizePayload(payload: SnapshotPayload): SnapshotPayload {
  return {
    html: sanitizeCapturedMarkup(payload.html),
    css: sanitizeCapturedCss(payload.css ?? ""),
  };
}

/**
 * Capture an allowlisted loopback page and insert it as a snapshot node.
 *
 * Snapshot files are written first and the page last, so a page reader never
 * observes a node whose payload is missing. A failed page write removes the
 * files written for this capture.
 */
export async function extractSnapshot(options: ExtractOptions): Promise<ExtractResult> {
  const viewport = validateViewport(options.viewport ?? DEFAULT_VIEWPORT);
  let config;
  try {
    config = await loadProjectConfig(options.projectRoot);
  } catch (error) {
    if (!options.allowedOrigins) {
      throw new ExtractError(
        "extract.config",
        `Could not load the project config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const origins = options.allowedOrigins ?? config?.extract?.origins ?? [];
  if (origins.length === 0) {
    throw new ExtractError(
      "extract.not-configured",
      `${options.projectRoot}/weft.project.json needs extract.origins before capture.`,
    );
  }
  const allowed = assertAllowedUrl(options.url, origins);

  const design = await readDesign(options.designDir, { requireFiles: false });
  const page = selectPage(design.pages, options.page);
  const pageRef = design.manifest.pages.find((ref) => ref.id === page.id);
  if (!pageRef) {
    throw new ExtractError("extract.page", `Page ${page.id} is not listed in the manifest.`);
  }

  const capture: CapturePage = options.capture ?? captureWithPlaywright;
  const captured = await capture({
    url: allowed.url,
    allowedOrigins: origins,
    ...(options.selector ? { selector: options.selector } : {}),
    viewport,
    ...(options.browserPath ? { browserPath: options.browserPath } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxAssetBytes !== undefined ? { maxAssetBytes: options.maxAssetBytes } : {}),
  });
  const payload = sanitizePayload({ html: captured.html, css: captured.css });
  const nodeId = newId("nd");
  const files = await writeSnapshotFiles(options.designDir, nodeId, payload);

  const bottom = page.children.reduce((max, id) => {
    const child = page.nodes[id];
    return child ? Math.max(max, child.y + child.height) : max;
  }, 0);
  const sourceViewport = captured.source.viewport;
  const node = createNode({
    type: "snapshot",
    id: nodeId,
    name: options.name ?? defaultName(allowed.url),
    x: options.x ?? 0,
    y: options.y ?? bottom + 40,
    width: sourceViewport.width,
    height: sourceViewport.height,
    source: {
      ...captured.source,
      url: allowed.url,
      viewport: sourceViewport,
    },
    files: files.files,
  }) as SnapshotNode;

  const updated = insertNode(page, node);
  try {
    await writePageFile(options.designDir, pageRef.file, updated, {
      tokens: design.manifest.tokens,
      assets: design.manifest.assets,
    });
  } catch (error) {
    for (const file of files.written) {
      await unlink(resolveDesignPath(options.designDir, file)).catch(() => undefined);
    }
    throw error;
  }

  return {
    node,
    pageId: page.id,
    pageFile: pageRef.file,
    files: files.files,
    written: [...files.written, pageRef.file],
    source: node.source,
    warnings: captured.warnings,
  };
}
