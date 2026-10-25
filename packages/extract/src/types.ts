import type { SnapshotNode, SnapshotSource } from "@weft/core";

export interface CaptureRequest {
  /** Absolute http(s) URL. Must match one of allowedOrigins. */
  url: string;
  allowedOrigins: readonly string[];
  selector?: string;
  viewport: { width: number; height: number };
  /** Explicit Chromium/Chrome executable. Defaults to discovery or WEFT_CHROMIUM. */
  browserPath?: string;
  /** Navigation and capture timeout. Default: 30s. */
  timeoutMs?: number;
  /** Per-asset byte cap while inlining images. Default: 2 MiB. */
  maxAssetBytes?: number;
}

export interface CapturedSnapshot {
  html: string;
  css: string;
  source: SnapshotSource;
  warnings: string[];
}

export type CapturePage = (request: CaptureRequest) => Promise<CapturedSnapshot>;

export interface ExtractOptions {
  /** Registered project root that owns weft.project.json. */
  projectRoot: string;
  designDir: string;
  url: string;
  selector?: string;
  viewport?: { width: number; height: number };
  /** Page id or name. Default: the first page. */
  page?: string;
  name?: string;
  x?: number;
  y?: number;
  browserPath?: string;
  timeoutMs?: number;
  maxAssetBytes?: number;
  /** Test seam; production uses the Playwright capture. */
  capture?: CapturePage;
}

export interface ExtractResult {
  node: SnapshotNode;
  pageId: string;
  pageFile: string;
  files: SnapshotNode["files"];
  written: string[];
  source: SnapshotSource;
  warnings: string[];
}
