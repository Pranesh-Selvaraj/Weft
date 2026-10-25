import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createDesign,
  isId,
  serialize,
  validateDesign,
  validateManifest,
  validatePage,
  WeftValidationError,
  type Asset,
  type DesignFile,
  type DesignManifest,
  type PageDocument,
  type SnapshotFiles,
  type TokenTree,
} from "@weft/core";
import { WeftIoError } from "./errors.js";
import { resolveDesignPath } from "./paths.js";
import { MANIFEST_FILE, readDesign } from "./read.js";

export interface WriteDesignResult {
  directory: string;
  written: string[];
}

export interface FormatDesignOptions {
  /** When false, report changes without writing. Default: true. */
  write?: boolean;
}

export interface FormatDesignResult {
  directory: string;
  changed: string[];
  files: string[];
}

export interface InitDesignOptions {
  name?: string;
  pageName?: string;
  /** Allow initializing over an existing non-empty directory. */
  force?: boolean;
}

export interface InitDesignResult {
  directory: string;
  design: DesignFile;
}

export interface WritePageOptions {
  tokens?: TokenTree;
  assets?: Asset[];
}

export interface SnapshotPayloadInput {
  html: string;
  css?: string;
}

export interface WriteSnapshotResult {
  files: SnapshotFiles;
  written: string[];
}

const MAX_SNAPSHOT_FILE_BYTES = 4 * 1024 * 1024;

async function writeFileAtomic(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function assertValid(design: DesignFile): void {
  const issues = validateDesign(design.manifest, design.pages);
  if (issues.length > 0) throw new WeftValidationError(issues);
}

function pageEntries(design: DesignFile): Array<{ file: string; page: PageDocument }> {
  const pages = new Map(design.pages.map((page) => [page.id, page]));
  return design.manifest.pages.map((ref) => {
    const page = pages.get(ref.id);
    if (!page) {
      throw new WeftIoError(
        "page.missing",
        ref.file,
        `Manifest lists page ${ref.id} but no page document was provided.`,
      );
    }
    return { file: ref.file, page };
  });
}

/**
 * Write a design's manifest and page documents. Assets and snapshot payloads
 * are owned by the capture/import pipeline; this function never deletes or
 * rewrites them.
 */
export async function writeDesign(
  directory: string,
  design: DesignFile,
): Promise<WriteDesignResult> {
  assertValid(design);
  const root = resolve(directory);
  const entries = pageEntries(design);

  for (const entry of entries) {
    const target = resolveDesignPath(root, entry.file);
    await writeFileAtomic(target, serialize(entry.page));
  }
  await writeFileAtomic(resolveDesignPath(root, MANIFEST_FILE), serialize(design.manifest));

  return {
    directory: root,
    written: [MANIFEST_FILE, ...entries.map((entry) => entry.file)],
  };
}

/**
 * Write one page file atomically, leaving the manifest and all other pages
 * untouched. This is the bridge's write path for a live command.
 */
export async function writePageFile(
  directory: string,
  file: string,
  page: PageDocument,
  options: WritePageOptions = {},
): Promise<{ directory: string; file: string }> {
  const issues = validatePage(page, {
    tokens: options.tokens,
    assets: options.assets,
  });
  if (issues.length > 0) throw new WeftValidationError(issues);

  const root = resolve(directory);
  const target = resolveDesignPath(root, file);
  await writeFileAtomic(target, serialize(page));
  return { directory: root, file };
}

/** Write only the manifest, atomically, after structural validation. */
export async function writeManifest(
  directory: string,
  manifest: DesignManifest,
): Promise<{ directory: string; file: string }> {
  const issues = validateManifest(manifest);
  if (issues.length > 0) throw new WeftValidationError(issues);
  const root = resolve(directory);
  await writeFileAtomic(resolveDesignPath(root, MANIFEST_FILE), serialize(manifest));
  return { directory: root, file: MANIFEST_FILE };
}

/**
 * Remove a design-relative file. A missing file is already in the desired
 * state; unsafe paths are refused by resolveDesignPath.
 */
export async function removeDesignFile(
  directory: string,
  relativePath: string,
): Promise<{ directory: string; file: string; removed: boolean }> {
  const root = resolve(directory);
  const target = resolveDesignPath(root, relativePath);
  try {
    await unlink(target);
    return { directory: root, file: relativePath, removed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { directory: root, file: relativePath, removed: false };
    }
    throw error;
  }
}

/**
 * Write a captured HTML/CSS payload under snapshots/. The caller inserts the
 * matching snapshot node into a page. Paths are derived from the node id, so a
 * payload cannot escape the design directory.
 */
export async function writeSnapshotFiles(
  directory: string,
  nodeId: string,
  payload: SnapshotPayloadInput,
): Promise<WriteSnapshotResult> {
  if (!isId(nodeId, "nd")) {
    throw new WeftIoError("snapshot.id", nodeId, "Snapshot payloads require an nd_ node id.");
  }
  if (Buffer.byteLength(payload.html, "utf8") > MAX_SNAPSHOT_FILE_BYTES) {
    throw new WeftIoError(
      "snapshot.too-large",
      nodeId,
      `Snapshot HTML is larger than ${MAX_SNAPSHOT_FILE_BYTES} bytes.`,
    );
  }
  if (payload.css !== undefined && Buffer.byteLength(payload.css, "utf8") > MAX_SNAPSHOT_FILE_BYTES) {
    throw new WeftIoError(
      "snapshot.too-large",
      nodeId,
      `Snapshot CSS is larger than ${MAX_SNAPSHOT_FILE_BYTES} bytes.`,
    );
  }

  const root = resolve(directory);
  const htmlFile = `snapshots/${nodeId}.html`;
  const cssFile = payload.css === undefined ? undefined : `snapshots/${nodeId}.css`;
  const written: string[] = [];
  try {
    await writeFileAtomic(resolveDesignPath(root, htmlFile), payload.html);
    written.push(htmlFile);
    if (cssFile !== undefined && payload.css !== undefined) {
      await writeFileAtomic(resolveDesignPath(root, cssFile), payload.css);
      written.push(cssFile);
    }
  } catch (error) {
    for (const file of written) {
      await unlink(resolveDesignPath(root, file)).catch(() => undefined);
    }
    throw error;
  }
  return {
    files: {
      html: htmlFile,
      ...(cssFile !== undefined ? { css: cssFile } : {}),
    },
    written: [htmlFile, ...(cssFile !== undefined ? [cssFile] : [])],
  };
}

/**
 * Rewrite the manifest and page files in canonical form. Returns the files
 * that differ; when `write` is false nothing is modified.
 */
export async function formatDesign(
  directory: string,
  options: FormatDesignOptions = {},
): Promise<FormatDesignResult> {
  const design = await readDesign(directory, { requireFiles: false });
  const entries = pageEntries(design);
  const root = resolve(directory);
  const files: Array<{ file: string; value: unknown }> = [
    { file: MANIFEST_FILE, value: design.manifest },
    ...entries.map((entry) => ({ file: entry.file, value: entry.page })),
  ];

  const changed: string[] = [];
  for (const entry of files) {
    const target = resolveDesignPath(root, entry.file);
    const current = await readFile(target, "utf8");
    const canonical = serialize(entry.value);
    if (current === canonical) continue;
    changed.push(entry.file);
    if (options.write !== false) {
      await writeFileAtomic(target, canonical);
    }
  }

  return { directory: root, changed, files: files.map((entry) => entry.file) };
}

/**
 * Create a new design directory. Refuses a non-empty directory unless `force`
 * is set; forcing still only writes `weft.json` and its page files.
 */
export async function initDesign(
  directory: string,
  options: InitDesignOptions = {},
): Promise<InitDesignResult> {
  const root = resolve(directory);

  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      throw new WeftIoError("init.not-directory", root, `${root} exists and is not a directory.`);
    }
    const entries = await readdir(root);
    if (entries.length > 0 && !options.force) {
      throw new WeftIoError(
        "init.not-empty",
        root,
        `Directory ${root} is not empty. Use --force to replace weft.json and page files.`,
      );
    }
  } catch (error) {
    if (error instanceof WeftIoError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const design = createDesign({ name: options.name, pageName: options.pageName });
  await mkdir(root, { recursive: true });
  await writeDesign(root, design);
  return { directory: root, design };
}
