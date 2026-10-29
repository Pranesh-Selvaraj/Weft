import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { slugify, type DesignFile, type PageDocument } from "@weft/core";
import { readDesign, readSnapshotPayloads, resolveDesignPath } from "@weft/design-io";
import { getPageBounds, PageView } from "@weft/render";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportError } from "./errors.js";

export const EXPORT_FORMAT = "weft.export" as const;
export const EXPORT_VERSION = 1 as const;

export interface ExportOptions {
  designDir: string;
  outDir: string;
  /** Page id or exact name. Defaults to all pages. */
  page?: string;
  /** Overwrite generated files in a non-empty output directory. */
  force?: boolean;
}

export interface ExportedPage {
  id: string;
  name: string;
  file: string;
  width: number;
  height: number;
}

export interface ExportedAsset {
  id: string;
  name?: string;
  mime: string;
  file: string;
}

export interface ExportResult {
  design: { id: string; name: string };
  outDir: string;
  pages: ExportedPage[];
  assets: ExportedAsset[];
  files: string[];
  exportedAt: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function writeAtomic(target: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temp, content);
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function prepareOutDir(outDir: string, force: boolean): Promise<void> {
  let info;
  try {
    info = await stat(outDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ExportError("export.outdir", `Could not inspect ${outDir}.`);
    }
    await mkdir(outDir, { recursive: true });
    return;
  }
  if (!info.isDirectory()) {
    throw new ExportError("export.outdir", `${outDir} is not a directory.`);
  }
  const entries = await readdir(outDir);
  if (entries.length > 0 && !force) {
    throw new ExportError(
      "export.outdir",
      `${outDir} is not empty. Pass --force to overwrite generated files.`,
    );
  }
}

function selectPages(design: DesignFile, selector?: string): PageDocument[] {
  if (!selector) return design.pages;
  const matches = design.pages.filter(
    (page) => page.id === selector || page.name === selector,
  );
  if (matches.length === 0) {
    throw new ExportError("export.page", `No page matches ${JSON.stringify(selector)}.`);
  }
  if (matches.length > 1) {
    throw new ExportError(
      "export.page",
      `Page name ${JSON.stringify(selector)} is ambiguous; use a page id.`,
    );
  }
  return matches;
}

function pageFiles(pages: readonly PageDocument[]): Map<string, string> {
  const used = new Set<string>();
  const files = new Map<string, string>();
  pages.forEach((page, index) => {
    const base = slugify(page.name);
    let file = `pages/${base}.html`;
    if (used.has(file)) file = `pages/${base}-${index + 1}.html`;
    used.add(file);
    files.set(page.id, file);
  });
  return files;
}

function pageShell(
  design: DesignFile,
  page: PageDocument,
  body: string,
  width: number,
  height: number,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.name)} · ${escapeHtml(design.manifest.name)}</title>
<style>
html,body{margin:0;padding:0;background:#efeae0}
body{padding:40px;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.weft-export-page{position:relative;width:${width}px;height:${height}px;margin:0 auto;overflow:hidden;box-shadow:0 2px 6px rgba(39,33,23,.08),0 28px 80px rgba(39,33,23,.18);background:#fff}
@media (max-width: 900px){body{padding:0}.weft-export-page{box-shadow:none;max-width:100%;height:auto}}
</style>
</head>
<body>
<main class="weft-export-page" data-weft-page="${escapeHtml(page.id)}">${body}</main>
</body>
</html>`;
}

function indexShell(design: DesignFile, pages: ExportedPage[]): string {
  const items = pages
    .map(
      (page) =>
        `<li><a href="${escapeHtml(page.file)}">${escapeHtml(page.name)}</a> <span>${page.width}×${page.height}</span></li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(design.manifest.name)} · Weft export</title>
<style>
html,body{margin:0;padding:48px;background:#efeae0;color:#17150f;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;background:#fffdf8;border:1px solid #e6e0d4;border-radius:14px;padding:32px}
h1{font:500 40px Georgia,serif;margin:0 0 8px}
p{color:#6b665c;margin:0 0 24px}
ul{list-style:none;padding:0;margin:0;border-top:1px solid #eee8dc}
li{display:flex;justify-content:space-between;gap:24px;padding:12px 0;border-bottom:1px solid #eee8dc}
a{color:#3b5bdb;text-decoration:none}
a:hover{text-decoration:underline}
span{font:10px ui-monospace,monospace;color:#a49a89}
</style>
</head>
<body><main><h1>${escapeHtml(design.manifest.name)}</h1><p>Static handoff exported from Weft.</p><ul>${items}</ul></main></body>
</html>`;
}

/**
 * Render selected pages to standalone HTML plus an index, tokens and an export
 * manifest. No scripts are added to the output; snapshot payloads remain inside
 * sandboxed iframes supplied by the renderer.
 */
export async function exportDesign(options: ExportOptions): Promise<ExportResult> {
  const designDir = resolve(options.designDir);
  const outDir = resolve(options.outDir);
  const design = await readDesign(designDir);
  const pages = selectPages(design, options.page);
  await prepareOutDir(outDir, options.force === true);
  const snapshots = await readSnapshotPayloads(designDir, design.pages);
  const files = pageFiles(pages);
  const exportedAt = new Date().toISOString();
  const exported: ExportedPage[] = [];
  const exportedAssets: ExportedAsset[] = [];
  const assetUrls = new Map<string, string>();
  const written: string[] = [];

  for (const asset of design.manifest.assets ?? []) {
    const extension = extname(asset.file).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
    const file = `assets/${asset.id}${safeExtension}`;
    const bytes = await readFile(resolveDesignPath(designDir, asset.file));
    await writeAtomic(resolve(outDir, file), bytes);
    written.push(file);
    assetUrls.set(asset.id, file);
    exportedAssets.push({
      id: asset.id,
      ...(asset.name ? { name: asset.name } : {}),
      mime: asset.mime,
      file,
    });
  }

  for (const page of pages) {
    const bounds = getPageBounds(page);
    const width = Math.max(800, bounds.width);
    const height = Math.max(600, bounds.height);
    const markup = renderToStaticMarkup(
      createElement(PageView, {
        page,
        manifest: design.manifest,
        width,
        height,
        snapshotPayloads: snapshots,
        assetUrl: (assetId: string) => {
          const file = assetUrls.get(assetId);
          return file ? `../${file}` : undefined;
        },
      }),
    );
    const file = files.get(page.id) ?? `pages/${slugify(page.name)}.html`;
    await writeAtomic(resolve(outDir, file), pageShell(design, page, markup, width, height));
    written.push(file);
    exported.push({ id: page.id, name: page.name, file, width, height });
  }

  await writeAtomic(resolve(outDir, "index.html"), indexShell(design, exported));
  written.push("index.html");

  if (design.manifest.tokens) {
    await writeAtomic(
      resolve(outDir, "tokens.json"),
      `${JSON.stringify(design.manifest.tokens, null, 2)}\n`,
    );
    written.push("tokens.json");
  }

  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    design: { id: design.manifest.id, name: design.manifest.name },
    exportedAt,
    pages: exported,
    assets: exportedAssets,
  };
  await writeAtomic(
    resolve(outDir, "weft.export.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  written.push("weft.export.json");

  return {
    design: manifest.design,
    outDir,
    pages: exported,
    assets: exportedAssets,
    files: written,
    exportedAt,
  };
}
