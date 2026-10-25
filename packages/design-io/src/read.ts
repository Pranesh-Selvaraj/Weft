import { lstat, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isSafeRelativePath,
  parseJson,
  validateManifest,
  validatePage,
  walkAllNodes,
  WeftValidationError,
  type Asset,
  type DesignFile,
  type DesignManifest,
  type PageDocument,
  type SnapshotNode,
  type TokenTree,
  type ValidationIssue,
} from "@weft/core";
import { WeftIoError } from "./errors.js";
import { resolveDesignPath } from "./paths.js";

export const MANIFEST_FILE = "weft.json";
const MAX_SNAPSHOT_FILE_BYTES = 4 * 1024 * 1024;

/** Captured HTML/CSS keyed by snapshot node id, ready for the sandboxed renderer. */
export interface SnapshotPayload {
  html: string;
  css?: string;
}

async function readSnapshotFile(
  root: string,
  relativePath: string,
  nodeId: string,
): Promise<string | null> {
  const target = resolveDesignPath(root, relativePath);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      throw new WeftIoError(
        "snapshot.symlink",
        relativePath,
        `Snapshot payload for ${nodeId} must not be a symbolic link.`,
      );
    }
    if (!info.isFile()) {
      throw new WeftIoError(
        "snapshot.file",
        relativePath,
        `Snapshot payload for ${nodeId} is not a regular file.`,
      );
    }
    if (info.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new WeftIoError(
        "snapshot.too-large",
        relativePath,
        `Snapshot payload for ${nodeId} is larger than ${MAX_SNAPSHOT_FILE_BYTES} bytes.`,
      );
    }
    const content = await readFile(target, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_SNAPSHOT_FILE_BYTES) {
      throw new WeftIoError(
        "snapshot.too-large",
        relativePath,
        `Snapshot payload for ${nodeId} is larger than ${MAX_SNAPSHOT_FILE_BYTES} bytes.`,
      );
    }
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Load the HTML/CSS payloads referenced by snapshot nodes. Missing payloads are
 * skipped so the renderer can keep a readable placeholder; unsafe paths and
 * oversized files are errors.
 */
export async function readSnapshotPayloads(
  directory: string,
  pages: readonly PageDocument[],
): Promise<Record<string, SnapshotPayload>> {
  const root = resolve(directory);
  const payloads: Record<string, SnapshotPayload> = {};
  for (const page of pages) {
    for (const node of walkAllNodes(page)) {
      if (node.type !== "snapshot") continue;
      const snapshot = node as SnapshotNode;
      const html = await readSnapshotFile(root, snapshot.files.html, snapshot.id);
      if (html === null) continue;
      const css = snapshot.files.css
        ? await readSnapshotFile(root, snapshot.files.css, snapshot.id)
        : null;
      payloads[snapshot.id] = {
        html,
        ...(css !== null ? { css } : {}),
      };
    }
  }
  return payloads;
}

export interface InspectDesignOptions {
  /** Check that assets and snapshot payloads exist on disk. Default: true. */
  requireFiles?: boolean;
}

export interface DesignInspection {
  /** Absolute path of the design directory. */
  directory: string;
  manifestPath: string;
  manifest?: DesignManifest;
  /** Page documents in manifest order, skipping pages that could not be read. */
  pages: PageDocument[];
  /** Design-relative file path for each entry in `pages`. */
  pageFiles: string[];
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withFile(file: string, issue: ValidationIssue): ValidationIssue {
  return {
    ...issue,
    path: issue.path ? `${file}:${issue.path}` : file,
  };
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read and validate a design directory without throwing. Schema issues and
 * file-level issues are collected together, with each issue path prefixed by
 * the file it belongs to.
 */
export async function inspectDesign(
  directory: string,
  options: InspectDesignOptions = {},
): Promise<DesignInspection> {
  const root = resolve(directory);
  const manifestPath = resolve(root, MANIFEST_FILE);
  const issues: ValidationIssue[] = [];
  const loaded: Array<{ page: PageDocument; file: string }> = [];

  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      issues.push(issue(MANIFEST_FILE, "directory.invalid", `${root} is not a directory.`));
      return { directory: root, manifestPath, pages: [], pageFiles: [], issues };
    }
  } catch (error) {
    issues.push(
      issue(MANIFEST_FILE, "directory.missing", `Could not open ${root}: ${errorMessage(error)}`),
    );
    return { directory: root, manifestPath, pages: [], pageFiles: [], issues };
  }

  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, "utf8");
  } catch (error) {
    issues.push(
      issue(MANIFEST_FILE, "file.missing", `Could not read weft.json: ${errorMessage(error)}`),
    );
    return { directory: root, manifestPath, pages: [], pageFiles: [], issues };
  }

  let parsed: unknown;
  try {
    parsed = parseJson(manifestText);
  } catch (error) {
    issues.push(issue(MANIFEST_FILE, "file.json", errorMessage(error)));
    return { directory: root, manifestPath, pages: [], pageFiles: [], issues };
  }

  if (!isRecord(parsed)) {
    issues.push(issue(MANIFEST_FILE, "file.type", "weft.json must contain a JSON object."));
    return { directory: root, manifestPath, pages: [], pageFiles: [], issues };
  }

  const manifest = parsed as unknown as DesignManifest;
  for (const manifestIssue of validateManifest(manifest)) {
    issues.push(withFile(MANIFEST_FILE, manifestIssue));
  }

  const tokens = isRecord(manifest.tokens) ? (manifest.tokens as TokenTree) : undefined;
  const assets = Array.isArray(manifest.assets)
    ? (manifest.assets.filter(
        (asset): asset is Asset => isRecord(asset) && typeof asset.id === "string",
      ) as Asset[])
    : undefined;

  const rawRefs = Array.isArray(manifest.pages) ? manifest.pages : [];
  const refs: Array<Record<string, unknown> & { index: number }> = [];
  rawRefs.forEach((ref, index) => {
    if (isRecord(ref)) refs.push({ ...ref, index });
  });

  const loadedById = new Map<string, { page: PageDocument; file: string }>();
  const readFiles = new Set<string>();

  for (const ref of refs) {
    const file = typeof ref.file === "string" ? ref.file : "";
    if (file.length === 0 || !isSafeRelativePath(file) || readFiles.has(file)) {
      continue;
    }
    readFiles.add(file);

    let pageText: string;
    try {
      pageText = await readFile(resolveDesignPath(root, file), "utf8");
    } catch (error) {
      issues.push(
        issue(file, "file.missing", `Could not read page file: ${errorMessage(error)}`),
      );
      continue;
    }

    let pageJson: unknown;
    try {
      pageJson = parseJson(pageText);
    } catch (error) {
      issues.push(issue(file, "file.json", errorMessage(error)));
      continue;
    }

    if (!isRecord(pageJson)) {
      issues.push(issue(file, "file.type", "Page file must contain a JSON object."));
      continue;
    }

    for (const pageIssue of validatePage(pageJson, { tokens, assets })) {
      issues.push(withFile(file, pageIssue));
    }

    const page = pageJson as unknown as PageDocument;

    if (typeof ref.id === "string" && page.id !== ref.id) {
      issues.push(
        issue(
          `${file}:id`,
          "page.id-mismatch",
          `Manifest expects page id ${ref.id}, file contains ${String(page.id)}.`,
        ),
      );
    }
    if (typeof ref.name === "string" && page.name !== ref.name) {
      issues.push(
        issue(
          `${file}:name`,
          "page.name-mismatch",
          `Manifest expects page name ${JSON.stringify(ref.name)}, file contains ${JSON.stringify(page.name)}.`,
        ),
      );
    }

    if (typeof page.id === "string") {
      const previous = loadedById.get(page.id);
      if (previous) {
        issues.push(
          issue(
            file,
            "page.duplicate-document",
            `Page ${page.id} is also loaded from ${previous.file}.`,
          ),
        );
      } else {
        loadedById.set(page.id, { page, file });
      }
    }

    loaded.push({ page, file });
  }

  for (const ref of refs) {
    if (typeof ref.id !== "string") continue;
    if (!loadedById.has(ref.id)) {
      issues.push(
        issue(
          `${MANIFEST_FILE}:pages[${ref.index}]`,
          "page.missing",
          `Manifest lists page ${ref.id} but its document could not be loaded.`,
        ),
      );
    }
  }

  const nodeOwners = new Map<string, string>();
  for (const { page, file } of loaded) {
    if (!isRecord(page.nodes)) continue;
    for (const nodeId of Object.keys(page.nodes)) {
      const previous = nodeOwners.get(nodeId);
      if (previous) {
        issues.push(
          issue(
            `${file}:nodes.${nodeId}`,
            "node.duplicate-global",
            `Node id also appears in ${previous}; ids must be unique across a design.`,
          ),
        );
      } else {
        nodeOwners.set(nodeId, file);
      }
    }
  }

  if (options.requireFiles !== false) {
    if (assets) {
      for (const asset of assets) {
        if (typeof asset.file !== "string" || !isSafeRelativePath(asset.file)) continue;
        if (!(await isFile(resolveDesignPath(root, asset.file)))) {
          issues.push(
            issue(
              asset.file,
              "asset.missing",
              `Asset ${asset.id} is listed in the manifest but the file does not exist.`,
            ),
          );
        }
      }
    }

    for (const { page, file } of loaded) {
      if (!isRecord(page.nodes)) continue;
      for (const node of walkAllNodes(page)) {
        if (node.type !== "snapshot") continue;
        const files = (node as { files?: unknown }).files;
        if (!isRecord(files)) continue;
        for (const key of ["html", "css"] as const) {
          const referenced = files[key];
          if (typeof referenced !== "string" || !isSafeRelativePath(referenced)) continue;
          if (!(await isFile(resolveDesignPath(root, referenced)))) {
            issues.push(
              issue(
                referenced,
                "snapshot.missing",
                `Snapshot file for node ${node.id} (${node.name}) does not exist; referenced from ${file}.`,
              ),
            );
          }
        }
      }
    }
  }

  return {
    directory: root,
    manifestPath,
    manifest,
    pages: loaded.map((entry) => entry.page),
    pageFiles: loaded.map((entry) => entry.file),
    issues,
  };
}

/** Read a design and throw if it is invalid or a required file is missing. */
export async function readDesign(
  directory: string,
  options: InspectDesignOptions = {},
): Promise<DesignFile> {
  const inspection = await inspectDesign(directory, options);
  if (inspection.issues.length > 0) {
    throw new WeftValidationError(inspection.issues);
  }
  if (!inspection.manifest) {
    throw new WeftIoError(
      "manifest.missing",
      inspection.manifestPath,
      "Design manifest could not be loaded.",
    );
  }
  return { manifest: inspection.manifest, pages: inspection.pages };
}

/** Validate a design directory and return all issues instead of throwing. */
export async function validateDesignDirectory(
  directory: string,
  options: InspectDesignOptions = {},
): Promise<ValidationIssue[]> {
  return (await inspectDesign(directory, options)).issues;
}
