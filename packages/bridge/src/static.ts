import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Serve a built web app from `webDist`, with an index.html fallback for
 * extension-less routes. Returns false when nothing could be served.
 */
export async function serveStatic(
  webDist: string | null,
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  if (!webDist) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = resolve(webDist);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return true;
  }

  let file = target;
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    if (extname(relative) !== "") return false;
    file = join(root, "index.html");
    try {
      data = await readFile(file);
    } catch {
      return false;
    }
  }

  const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(data);
  return true;
}
