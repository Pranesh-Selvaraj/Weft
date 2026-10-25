/**
 * The Weft document model.
 *
 * A design is a manifest plus one page document per page. Nodes live in a flat
 * map on each page and are linked by id, so an agent can read or rewrite one
 * node without reconstructing the whole tree. The canonical form is JSON;
 * see `serialize.ts` for the deterministic writer.
 *
 * This file defines data only. Validation lives in `validate.ts`, operations in
 * `nodes.ts`, and document construction in `design.ts`.
 */

export const WEFT_FORMAT = "weft" as const;
export const WEFT_PAGE_FORMAT = "weft.page" as const;
export const WEFT_FORMAT_VERSION = 1 as const;
export const WEFT_PAGE_FORMAT_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A design token value. Colors and lengths are both strings or numbers. */
export type TokenValue = string | number;

/** Tokens are addressed by dot-separated paths, for example `color.surface`. */
export interface TokenTree {
  [key: string]: TokenValue | TokenTree;
}

export interface PageRef {
  id: string;
  name: string;
  /** Path relative to the design directory, for example `pages/landing.json`. */
  file: string;
}

export interface Asset {
  id: string;
  /** Path relative to the design directory, for example `assets/hero.avif`. */
  file: string;
  mime: string;
  name?: string;
  width?: number;
  height?: number;
  meta?: JsonObject;
}

export interface DesignManifest {
  format: typeof WEFT_FORMAT;
  version: typeof WEFT_FORMAT_VERSION;
  id: string;
  name: string;
  pages: PageRef[];
  tokens?: TokenTree;
  assets?: Asset[];
  meta?: JsonObject;
}

// ---------------------------------------------------------------------------
// Geometry and layout
// ---------------------------------------------------------------------------

export interface GradientStop {
  offset: number;
  color: string;
}

export type ImageFit = "cover" | "contain" | "fill" | "none";

export type Paint =
  | { type: "solid"; color: string }
  | { type: "linear-gradient"; angle: number; stops: GradientStop[] }
  | { type: "image"; asset: string; fit?: ImageFit };

export type Padding = number | [number, number] | [number, number, number, number];

export type Radius = number | [number, number, number, number];

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: string;
  inset?: boolean;
}

export type FontWeight = number;

export type TextAlign = "left" | "center" | "right" | "justify";
export type FontStyleName = "normal" | "italic";
export type TextDecoration = "none" | "underline" | "line-through";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export interface FontStyle {
  family: string;
  size: number;
  weight?: FontWeight;
  /** Unitless multiplier, for example `1.5`. */
  lineHeight?: number;
  letterSpacing?: number;
  style?: FontStyleName;
  align?: TextAlign;
  decoration?: TextDecoration;
  transform?: TextTransform;
}

export interface Style {
  fills?: Paint[];
  strokes?: Paint[];
  strokeWidth?: number;
  strokeAlign?: "inside" | "center" | "outside";
  radius?: Radius;
  opacity?: number;
  shadows?: Shadow[];
  blur?: number;
  font?: FontStyle;
}

export type FlexDirection = "row" | "column";
export type FlexAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type FlexJustify =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";

export interface AbsoluteLayout {
  mode: "absolute";
}

export interface FlexLayout {
  mode: "flex";
  direction?: FlexDirection;
  gap?: number;
  padding?: Padding;
  align?: FlexAlign;
  justify?: FlexJustify;
  wrap?: boolean;
}

export type Layout = AbsoluteLayout | FlexLayout;

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export type NodeType =
  | "frame"
  | "group"
  | "text"
  | "rect"
  | "ellipse"
  | "image"
  | "snapshot";

export interface BaseNode {
  id: string;
  type: NodeType;
  /** Human-readable layer name. Not used for identity. */
  name: string;
  /** Position and size in CSS pixels, relative to the parent. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  layout?: Layout;
  style?: Style;
  /** Extension area. Unknown data survives a read/write round trip. */
  meta?: JsonObject;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  children: string[];
  clip?: boolean;
}

export interface GroupNode extends BaseNode {
  type: "group";
  children: string[];
}

export interface TextNode extends BaseNode {
  type: "text";
  /** The text content. Text nodes render real text, never outlines. */
  content: string;
}

export interface RectNode extends BaseNode {
  type: "rect";
}

export interface EllipseNode extends BaseNode {
  type: "ellipse";
}

export interface ImageNode extends BaseNode {
  type: "image";
  /** Asset id from the manifest. */
  asset: string;
  fit?: ImageFit;
  alt?: string;
}

export interface SnapshotSource {
  /** Absolute http(s) URL the snapshot was captured from. */
  url: string;
  selector?: string;
  viewport: { width: number; height: number };
  /** ISO 8601 timestamp. */
  capturedAt: string;
  commit?: string;
}

export interface SnapshotFiles {
  /** Path relative to the design directory, for example `snapshots/nd_....html`. */
  html: string;
  /** Optional scoped stylesheet, path relative to the design directory. */
  css?: string;
}

/**
 * A captured region of a running product. Snapshot payloads live beside the
 * page JSON rather than inside it so git diffs stay readable and page files
 * stay small.
 */
export interface SnapshotNode extends BaseNode {
  type: "snapshot";
  source: SnapshotSource;
  files: SnapshotFiles;
}

export type Node =
  | FrameNode
  | GroupNode
  | TextNode
  | RectNode
  | EllipseNode
  | ImageNode
  | SnapshotNode;

export type ContainerNode = FrameNode | GroupNode;

export interface PageDocument {
  format: typeof WEFT_PAGE_FORMAT;
  version: typeof WEFT_PAGE_FORMAT_VERSION;
  id: string;
  name: string;
  /** Flat node map keyed by node id. */
  nodes: Record<string, Node>;
  /** Ordered ids of the top-level nodes on the page. */
  children: string[];
  background?: Paint | null;
  meta?: JsonObject;
}

/** The two documents that make up a design on disk. */
export interface DesignFile {
  manifest: DesignManifest;
  pages: PageDocument[];
}
