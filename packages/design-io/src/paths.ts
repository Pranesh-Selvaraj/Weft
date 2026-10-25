import { isAbsolute, relative, resolve, sep } from "node:path";
import { isSafeRelativePath } from "@weft/core";
import { WeftIoError } from "./errors.js";

/**
 * Resolve a design-relative path and refuse anything that could escape the
 * design directory. The lexical check is deliberately strict: no absolute
 * paths, no `..`, no backslashes. A symlink inside the design can still point
 * outside; writers replace symlinks rather than following them.
 */
export function resolveDesignPath(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new WeftIoError(
      "path.unsafe",
      relativePath,
      `Path ${JSON.stringify(relativePath)} must stay inside the design directory.`,
    );
  }
  const base = resolve(root);
  const target = resolve(base, relativePath);
  const rel = relative(base, target);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new WeftIoError(
      "path.escape",
      relativePath,
      `Path ${JSON.stringify(relativePath)} escapes the design directory.`,
    );
  }
  return target;
}

/** Display a design-relative path with forward slashes on every platform. */
export function displayPath(root: string, target: string): string {
  return relative(resolve(root), target).split(sep).join("/");
}

/** Return the directory part of a design-relative file path. */
export function designFileDirectory(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}
