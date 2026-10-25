import { isId } from "./ids.js";
import { lookupToken, parseTokenRef } from "./tokens.js";
import {
  WEFT_FORMAT,
  WEFT_FORMAT_VERSION,
  WEFT_PAGE_FORMAT,
  WEFT_PAGE_FORMAT_VERSION,
  type Asset,
  type DesignManifest,
  type PageDocument,
  type TokenTree,
  type NodeType,
} from "./types.js";

export interface ValidationIssue {
  /** Dot/bracket path into the document, for example `nodes.nd_x.width`. */
  path: string;
  code: string;
  message: string;
}

export interface ValidatePageOptions {
  tokens?: TokenTree;
  assets?: Asset[];
}

export class WeftValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const details = issues.slice(0, 20).map((issue) => `  ${issue.path || "<root>"}: ${issue.message}`);
    const extra = issues.length > 20 ? `\n  …and ${issues.length - 20} more.` : "";
    super(`Invalid Weft document:\n${details.join("\n")}${extra}`);
    this.name = "WeftValidationError";
    this.issues = issues;
  }
}

const NODE_TYPES = new Set<NodeType>([
  "frame",
  "group",
  "text",
  "rect",
  "ellipse",
  "image",
  "snapshot",
]);

const IMAGE_FITS = ["cover", "contain", "fill", "none"] as const;
const FLEX_DIRECTIONS = ["row", "column"] as const;
const FLEX_ALIGNS = ["start", "center", "end", "stretch", "baseline"] as const;
const FLEX_JUSTIFIES = [
  "start",
  "center",
  "end",
  "space-between",
  "space-around",
  "space-evenly",
] as const;
const TEXT_ALIGNS = ["left", "center", "right", "justify"] as const;
const FONT_STYLES = ["normal", "italic"] as const;
const TEXT_DECORATIONS = ["none", "underline", "line-through"] as const;
const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
const STROKE_ALIGNS = ["inside", "center", "outside"] as const;
const RESERVED_TOKEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TOKEN_KEY_RE = /^[A-Za-z0-9_-]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

type Issues = ValidationIssue[];

function add(issues: Issues, path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") {
    const preview = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    return JSON.stringify(preview);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "undefined") return "undefined";
  return typeof value;
}

function checkRecord(
  value: unknown,
  issues: Issues,
  path: string,
  code = "type.object",
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    add(issues, path, code, `Expected an object, received ${describe(value)}.`);
    return false;
  }
  return true;
}

function checkString(
  value: unknown,
  issues: Issues,
  path: string,
  code = "type.string",
): value is string {
  if (typeof value !== "string") {
    add(issues, path, code, `Expected a string, received ${describe(value)}.`);
    return false;
  }
  return true;
}

function checkNonEmptyString(
  value: unknown,
  issues: Issues,
  path: string,
  code = "type.non-empty",
): value is string {
  if (!checkString(value, issues, path, code)) return false;
  if (value.trim().length === 0) {
    add(issues, path, code, "Expected a non-empty string.");
    return false;
  }
  return true;
}

function checkBoolean(value: unknown, issues: Issues, path: string): value is boolean {
  if (typeof value !== "boolean") {
    add(issues, path, "type.boolean", `Expected a boolean, received ${describe(value)}.`);
    return false;
  }
  return true;
}

interface NumberCheck {
  min?: number;
  max?: number;
  integer?: boolean;
}

function checkNumber(
  value: unknown,
  issues: Issues,
  path: string,
  options: NumberCheck = {},
): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    add(issues, path, "type.number", `Expected a finite number, received ${describe(value)}.`);
    return false;
  }
  if (options.integer && !Number.isInteger(value)) {
    add(issues, path, "number.integer", `Expected an integer, received ${value}.`);
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    add(issues, path, "number.range", `Expected a number >= ${options.min}, received ${value}.`);
    return false;
  }
  if (options.max !== undefined && value > options.max) {
    add(issues, path, "number.range", `Expected a number <= ${options.max}, received ${value}.`);
    return false;
  }
  return true;
}

function checkEnum(
  value: unknown,
  issues: Issues,
  path: string,
  allowed: readonly string[],
): value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    add(
      issues,
      path,
      "enum.invalid",
      `Expected one of ${allowed.map((item) => JSON.stringify(item)).join(", ")}, received ${describe(value)}.`,
    );
    return false;
  }
  return true;
}

function checkId(
  value: unknown,
  issues: Issues,
  path: string,
  prefix: "ds" | "pg" | "nd" | "as",
): value is string {
  if (!checkString(value, issues, path, "id.type")) return false;
  if (!isId(value, prefix)) {
    add(issues, path, "id.invalid", `Expected a ${prefix}_ ULID.`);
    return false;
  }
  return true;
}

/** A safe path is relative, slash-separated, and cannot escape the design directory. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  if (value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function checkRelativePath(
  value: unknown,
  issues: Issues,
  path: string,
  extensions: readonly string[],
): value is string {
  if (!checkNonEmptyString(value, issues, path, "path.invalid")) return false;
  if (!isSafeRelativePath(value)) {
    add(issues, path, "path.unsafe", "Expected a relative path that stays inside the design directory.");
    return false;
  }
  if (!extensions.some((extension) => value.endsWith(extension))) {
    add(issues, path, "path.extension", `Expected a path ending in ${extensions.join(" or ")}.`);
    return false;
  }
  return true;
}

function checkJson(
  value: unknown,
  issues: Issues,
  path: string,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 64) {
    add(issues, path, "json.depth", "JSON value is nested too deeply.");
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) add(issues, path, "json.number", "JSON numbers must be finite.");
    return;
  }
  if (typeof value !== "object") {
    add(issues, path, "json.type", `Expected a JSON value, received ${describe(value)}.`);
    return;
  }
  if (ancestors.has(value)) {
    add(issues, path, "json.cycle", "JSON value contains a circular reference.");
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    add(issues, path, "json.type", "Expected a plain JSON object.");
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkJson(item, issues, `${path}[${index}]`, ancestors, depth + 1));
  } else {
    for (const [key, item] of Object.entries(value)) {
      checkJson(item, issues, path ? `${path}.${key}` : key, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function checkJsonObject(value: unknown, issues: Issues, path: string): void {
  if (!checkRecord(value, issues, path, "json.type")) return;
  checkJson(value, issues, path);
}

function validateTokens(tokens: unknown, issues: Issues, path = "tokens", depth = 0): void {
  if (!checkRecord(tokens, issues, path, "token.type")) return;
  if (depth > 24) {
    add(issues, path, "token.depth", "Token tree is nested too deeply.");
    return;
  }
  for (const [key, value] of Object.entries(tokens)) {
    const childPath = `${path}.${key}`;
    if (!TOKEN_KEY_RE.test(key) || RESERVED_TOKEN_KEYS.has(key)) {
      add(
        issues,
        childPath,
        "token.key",
        "Token names may contain only letters, digits, `_` and `-`, and may not be reserved words.",
      );
      continue;
    }
    if (typeof value === "string") {
      if (value.length === 0) add(issues, childPath, "token.value", "Token string must not be empty.");
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) add(issues, childPath, "token.value", "Token number must be finite.");
    } else if (isRecord(value)) {
      validateTokens(value, issues, childPath, depth + 1);
    } else {
      add(issues, childPath, "token.value", `Expected a token value or group, received ${describe(value)}.`);
    }
  }
}

function validateAssets(assets: unknown, issues: Issues, path = "assets"): void {
  if (!Array.isArray(assets)) {
    add(issues, path, "type.array", `Expected an array, received ${describe(assets)}.`);
    return;
  }
  const ids = new Set<string>();
  const files = new Set<string>();
  assets.forEach((asset, index) => {
    const assetPath = `${path}[${index}]`;
    if (!checkRecord(asset, issues, assetPath)) return;
    if (checkId(asset.id, issues, `${assetPath}.id`, "as")) {
      if (ids.has(asset.id)) add(issues, `${assetPath}.id`, "asset.duplicate", `Duplicate asset id ${asset.id}.`);
      ids.add(asset.id);
    }
    if (checkRelativePath(asset.file, issues, `${assetPath}.file`, [".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".woff2", ".mp4", ".webm"])) {
      if (files.has(asset.file)) {
        add(issues, `${assetPath}.file`, "asset.duplicate-file", `Duplicate asset file ${asset.file}.`);
      }
      files.add(asset.file);
    }
    checkNonEmptyString(asset.mime, issues, `${assetPath}.mime`, "asset.mime");
    if (asset.name !== undefined) checkString(asset.name, issues, `${assetPath}.name`);
    if (asset.width !== undefined) checkNumber(asset.width, issues, `${assetPath}.width`, { min: 0 });
    if (asset.height !== undefined) checkNumber(asset.height, issues, `${assetPath}.height`, { min: 0 });
    if (asset.meta !== undefined) checkJsonObject(asset.meta, issues, `${assetPath}.meta`);
  });
}

export function validateManifest(input: unknown): ValidationIssue[] {
  const issues: Issues = [];
  if (!checkRecord(input, issues, "")) return issues;

  if (input.format !== WEFT_FORMAT) {
    add(issues, "format", "format.invalid", `Expected format ${JSON.stringify(WEFT_FORMAT)}.`);
  }
  if (input.version !== WEFT_FORMAT_VERSION) {
    add(issues, "version", "version.unsupported", `Expected format version ${WEFT_FORMAT_VERSION}.`);
  }
  checkId(input.id, issues, "id", "ds");
  checkNonEmptyString(input.name, issues, "name");

  if (!Array.isArray(input.pages)) {
    add(issues, "pages", "type.array", `Expected an array, received ${describe(input.pages)}.`);
  } else if (input.pages.length === 0) {
    add(issues, "pages", "pages.empty", "A design must contain at least one page.");
  } else {
    const ids = new Set<string>();
    const files = new Set<string>();
    input.pages.forEach((page, index) => {
      const pagePath = `pages[${index}]`;
      if (!checkRecord(page, issues, pagePath)) return;
      if (checkId(page.id, issues, `${pagePath}.id`, "pg")) {
        if (ids.has(page.id)) add(issues, `${pagePath}.id`, "page.duplicate", `Duplicate page id ${page.id}.`);
        ids.add(page.id);
      }
      checkNonEmptyString(page.name, issues, `${pagePath}.name`);
      if (checkRelativePath(page.file, issues, `${pagePath}.file`, [".json"])) {
        if (files.has(page.file)) add(issues, `${pagePath}.file`, "page.duplicate-file", `Duplicate page file ${page.file}.`);
        files.add(page.file);
      }
    });
  }

  if (input.tokens !== undefined) validateTokens(input.tokens, issues);
  if (input.assets !== undefined) validateAssets(input.assets, issues);
  if (input.meta !== undefined) checkJsonObject(input.meta, issues, "meta");

  return issues;
}

interface InternalPageOptions {
  tokens?: TokenTree;
  assetIds?: Set<string>;
}

function validateColor(value: unknown, issues: Issues, path: string, tokens?: TokenTree): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    add(issues, path, "color.invalid", "Expected a CSS color string.");
    return;
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const tokenPath = parseTokenRef(value);
    if (tokenPath === null) {
      add(issues, path, "token.malformed", "Token reference must look like `{path.to.token}`.");
      return;
    }
    if (tokens) {
      const resolved = lookupToken(tokens, tokenPath);
      if (resolved === undefined) {
        add(issues, path, "token.unresolved", `Token ${tokenPath} does not exist.`);
      } else if (typeof resolved !== "string") {
        add(issues, path, "token.type", `Token ${tokenPath} is not a color.`);
      }
    }
  }
}

function validatePaint(
  paint: unknown,
  issues: Issues,
  path: string,
  options: InternalPageOptions,
): void {
  if (!checkRecord(paint, issues, path, "paint.type")) return;
  if (!checkEnum(paint.type, issues, `${path}.type`, ["solid", "linear-gradient", "image"])) return;

  if (paint.type === "solid") {
    validateColor(paint.color, issues, `${path}.color`, options.tokens);
    return;
  }

  if (paint.type === "linear-gradient") {
    checkNumber(paint.angle, issues, `${path}.angle`);
    if (!Array.isArray(paint.stops) || paint.stops.length < 2) {
      add(issues, `${path}.stops`, "gradient.stops", "A gradient needs at least two stops.");
      return;
    }
    let previous = -1;
    paint.stops.forEach((stop, index) => {
      const stopPath = `${path}.stops[${index}]`;
      if (!checkRecord(stop, issues, stopPath)) return;
      if (checkNumber(stop.offset, issues, `${stopPath}.offset`, { min: 0, max: 1 })) {
        if (stop.offset < previous) {
          add(issues, `${stopPath}.offset`, "gradient.order", "Gradient offsets must be non-decreasing.");
        }
        previous = stop.offset;
      }
      validateColor(stop.color, issues, `${stopPath}.color`, options.tokens);
    });
    return;
  }

  // image
  if (checkId(paint.asset, issues, `${path}.asset`, "as") && options.assetIds) {
    if (!options.assetIds.has(paint.asset)) {
      add(issues, `${path}.asset`, "asset.unresolved", `Asset ${paint.asset} does not exist in the manifest.`);
    }
  }
  if (paint.fit !== undefined) checkEnum(paint.fit, issues, `${path}.fit`, IMAGE_FITS);
}

function validatePaintList(
  paints: unknown,
  issues: Issues,
  path: string,
  options: InternalPageOptions,
): void {
  if (!Array.isArray(paints)) {
    add(issues, path, "type.array", `Expected an array, received ${describe(paints)}.`);
    return;
  }
  paints.forEach((paint, index) => validatePaint(paint, issues, `${path}[${index}]`, options));
}

function validatePadding(value: unknown, issues: Issues, path: string): void {
  if (typeof value === "number") {
    checkNumber(value, issues, path, { min: 0 });
    return;
  }
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 4)) {
    add(issues, path, "padding.invalid", "Padding must be a number or an array of 2 or 4 numbers.");
    return;
  }
  value.forEach((item, index) => checkNumber(item, issues, `${path}[${index}]`, { min: 0 }));
}

function validateRadius(value: unknown, issues: Issues, path: string): void {
  if (typeof value === "number") {
    checkNumber(value, issues, path, { min: 0 });
    return;
  }
  if (!Array.isArray(value) || value.length !== 4) {
    add(issues, path, "radius.invalid", "Radius must be a number or an array of 4 numbers.");
    return;
  }
  value.forEach((item, index) => checkNumber(item, issues, `${path}[${index}]`, { min: 0 }));
}

function validateFont(value: unknown, issues: Issues, path: string): void {
  if (!checkRecord(value, issues, path)) return;
  checkNonEmptyString(value.family, issues, `${path}.family`);
  checkNumber(value.size, issues, `${path}.size`, { min: 0 });
  if (value.size === 0) add(issues, `${path}.size`, "font.size", "Font size must be greater than zero.");
  if (value.weight !== undefined) {
    checkNumber(value.weight, issues, `${path}.weight`, { min: 1, max: 1000 });
  }
  if (value.lineHeight !== undefined) {
    checkNumber(value.lineHeight, issues, `${path}.lineHeight`, { min: 0 });
  }
  if (value.letterSpacing !== undefined) checkNumber(value.letterSpacing, issues, `${path}.letterSpacing`);
  if (value.style !== undefined) checkEnum(value.style, issues, `${path}.style`, FONT_STYLES);
  if (value.align !== undefined) checkEnum(value.align, issues, `${path}.align`, TEXT_ALIGNS);
  if (value.decoration !== undefined) {
    checkEnum(value.decoration, issues, `${path}.decoration`, TEXT_DECORATIONS);
  }
  if (value.transform !== undefined) {
    checkEnum(value.transform, issues, `${path}.transform`, TEXT_TRANSFORMS);
  }
}

function validateShadow(value: unknown, issues: Issues, path: string, tokens?: TokenTree): void {
  if (!checkRecord(value, issues, path)) return;
  checkNumber(value.x, issues, `${path}.x`);
  checkNumber(value.y, issues, `${path}.y`);
  checkNumber(value.blur, issues, `${path}.blur`, { min: 0 });
  if (value.spread !== undefined) checkNumber(value.spread, issues, `${path}.spread`, { min: 0 });
  validateColor(value.color, issues, `${path}.color`, tokens);
  if (value.inset !== undefined) checkBoolean(value.inset, issues, `${path}.inset`);
}

function validateStyle(
  style: unknown,
  issues: Issues,
  path: string,
  options: InternalPageOptions,
): void {
  if (!checkRecord(style, issues, path)) return;
  if (style.fills !== undefined) validatePaintList(style.fills, issues, `${path}.fills`, options);
  if (style.strokes !== undefined) validatePaintList(style.strokes, issues, `${path}.strokes`, options);
  if (style.strokeWidth !== undefined) checkNumber(style.strokeWidth, issues, `${path}.strokeWidth`, { min: 0 });
  if (style.strokeAlign !== undefined) {
    checkEnum(style.strokeAlign, issues, `${path}.strokeAlign`, STROKE_ALIGNS);
  }
  if (style.radius !== undefined) validateRadius(style.radius, issues, `${path}.radius`);
  if (style.opacity !== undefined) checkNumber(style.opacity, issues, `${path}.opacity`, { min: 0, max: 1 });
  if (style.blur !== undefined) checkNumber(style.blur, issues, `${path}.blur`, { min: 0 });
  if (style.font !== undefined) validateFont(style.font, issues, `${path}.font`);
  if (style.shadows !== undefined) {
    if (!Array.isArray(style.shadows)) {
      add(issues, `${path}.shadows`, "type.array", "Expected an array of shadows.");
    } else {
      style.shadows.forEach((shadow, index) =>
        validateShadow(shadow, issues, `${path}.shadows[${index}]`, options.tokens),
      );
    }
  }
}

function validateLayout(value: unknown, issues: Issues, path: string): void {
  if (!checkRecord(value, issues, path)) return;
  if (!checkEnum(value.mode, issues, `${path}.mode`, ["absolute", "flex"])) return;
  if (value.mode === "absolute") return;
  if (value.direction !== undefined) {
    checkEnum(value.direction, issues, `${path}.direction`, FLEX_DIRECTIONS);
  }
  if (value.gap !== undefined) checkNumber(value.gap, issues, `${path}.gap`, { min: 0 });
  if (value.padding !== undefined) validatePadding(value.padding, issues, `${path}.padding`);
  if (value.align !== undefined) checkEnum(value.align, issues, `${path}.align`, FLEX_ALIGNS);
  if (value.justify !== undefined) checkEnum(value.justify, issues, `${path}.justify`, FLEX_JUSTIFIES);
  if (value.wrap !== undefined) checkBoolean(value.wrap, issues, `${path}.wrap`);
}

function validateChildren(value: unknown, issues: Issues, path: string): void {
  if (!Array.isArray(value)) {
    add(issues, path, "children.type", `Expected an array of node ids, received ${describe(value)}.`);
    return;
  }
  value.forEach((child, index) => {
    if (typeof child !== "string") {
      add(issues, `${path}[${index}]`, "children.type", `Expected a node id, received ${describe(child)}.`);
      return;
    }
    if (!isId(child, "nd")) {
      add(issues, `${path}[${index}]`, "id.invalid", "Expected an nd_ ULID.");
    }
  });
}

function validateSnapshotSource(value: unknown, issues: Issues, path: string): void {
  if (!checkRecord(value, issues, path)) return;
  if (checkNonEmptyString(value.url, issues, `${path}.url`)) {
    try {
      const url = new URL(value.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        add(issues, `${path}.url`, "snapshot.url", "Snapshot URLs must use http or https.");
      }
    } catch {
      add(issues, `${path}.url`, "snapshot.url", "Snapshot URL must be absolute.");
    }
  }
  if (value.selector !== undefined) {
    checkNonEmptyString(value.selector, issues, `${path}.selector`);
  }
  if (checkRecord(value.viewport, issues, `${path}.viewport`)) {
    checkNumber(value.viewport.width, issues, `${path}.viewport.width`, { min: 0 });
    checkNumber(value.viewport.height, issues, `${path}.viewport.height`, { min: 0 });
    if (value.viewport.width === 0 || value.viewport.height === 0) {
      add(issues, `${path}.viewport`, "snapshot.viewport", "Snapshot viewport must be larger than zero.");
    }
  }
  if (checkNonEmptyString(value.capturedAt, issues, `${path}.capturedAt`)) {
    if (!ISO_DATE_RE.test(value.capturedAt) || Number.isNaN(Date.parse(value.capturedAt))) {
      add(issues, `${path}.capturedAt`, "snapshot.date", "capturedAt must be an ISO 8601 UTC timestamp.");
    }
  }
  if (value.commit !== undefined) checkNonEmptyString(value.commit, issues, `${path}.commit`);
}

function validateSnapshotFiles(value: unknown, issues: Issues, path: string): void {
  if (!checkRecord(value, issues, path)) return;
  checkRelativePath(value.html, issues, `${path}.html`, [".html"]);
  if (value.css !== undefined) checkRelativePath(value.css, issues, `${path}.css`, [".css"]);
}

function validateNode(
  node: Record<string, unknown>,
  issues: Issues,
  path: string,
  options: InternalPageOptions,
): void {
  checkId(node.id, issues, `${path}.id`, "nd");
  checkNonEmptyString(node.name, issues, `${path}.name`);

  const type = node.type;
  if (typeof type !== "string" || !NODE_TYPES.has(type as NodeType)) {
    add(
      issues,
      `${path}.type`,
      "node.type",
      `Expected a node type (${[...NODE_TYPES].join(", ")}), received ${describe(type)}.`,
    );
  }

  checkNumber(node.x, issues, `${path}.x`);
  checkNumber(node.y, issues, `${path}.y`);
  checkNumber(node.width, issues, `${path}.width`, { min: 0 });
  checkNumber(node.height, issues, `${path}.height`, { min: 0 });
  if (node.rotation !== undefined) checkNumber(node.rotation, issues, `${path}.rotation`);
  if (node.visible !== undefined) checkBoolean(node.visible, issues, `${path}.visible`);
  if (node.locked !== undefined) checkBoolean(node.locked, issues, `${path}.locked`);
  if (node.layout !== undefined) validateLayout(node.layout, issues, `${path}.layout`);
  if (node.style !== undefined) validateStyle(node.style, issues, `${path}.style`, options);
  if (node.meta !== undefined) checkJsonObject(node.meta, issues, `${path}.meta`);

  switch (type) {
    case "frame": {
      validateChildren(node.children, issues, `${path}.children`);
      if (node.clip !== undefined) checkBoolean(node.clip, issues, `${path}.clip`);
      break;
    }
    case "group": {
      validateChildren(node.children, issues, `${path}.children`);
      break;
    }
    case "text": {
      checkString(node.content, issues, `${path}.content`);
      break;
    }
    case "image": {
      if (checkId(node.asset, issues, `${path}.asset`, "as") && options.assetIds) {
        if (!options.assetIds.has(node.asset)) {
          add(issues, `${path}.asset`, "asset.unresolved", `Asset ${node.asset} does not exist in the manifest.`);
        }
      }
      if (node.fit !== undefined) checkEnum(node.fit, issues, `${path}.fit`, IMAGE_FITS);
      if (node.alt !== undefined) checkString(node.alt, issues, `${path}.alt`);
      break;
    }
    case "snapshot": {
      validateSnapshotSource(node.source, issues, `${path}.source`);
      validateSnapshotFiles(node.files, issues, `${path}.files`);
      break;
    }
    case "rect":
    case "ellipse":
      break;
    default:
      break;
  }
}

export function validatePage(
  input: unknown,
  options: ValidatePageOptions = {},
): ValidationIssue[] {
  const issues: Issues = [];
  if (!checkRecord(input, issues, "")) return issues;

  if (input.format !== WEFT_PAGE_FORMAT) {
    add(issues, "format", "format.invalid", `Expected format ${JSON.stringify(WEFT_PAGE_FORMAT)}.`);
  }
  if (input.version !== WEFT_PAGE_FORMAT_VERSION) {
    add(issues, "version", "version.unsupported", `Expected format version ${WEFT_PAGE_FORMAT_VERSION}.`);
  }
  checkId(input.id, issues, "id", "pg");
  checkNonEmptyString(input.name, issues, "name");
  if (input.meta !== undefined) checkJsonObject(input.meta, issues, "meta");

  const internal: InternalPageOptions = {
    tokens: options.tokens,
    assetIds: options.assets ? new Set(options.assets.map((asset) => asset.id)) : undefined,
  };

  if (input.background !== undefined && input.background !== null) {
    validatePaint(input.background, issues, "background", internal);
  }

  const nodes = input.nodes;
  if (!checkRecord(nodes, issues, "nodes")) return issues;

  for (const [key, node] of Object.entries(nodes)) {
    const nodePath = `nodes.${key}`;
    if (!checkRecord(node, issues, nodePath)) continue;
    if (node.id !== key) {
      add(issues, `${nodePath}.id`, "node.key-mismatch", "Node map key must equal the node id.");
    }
    validateNode(node, issues, nodePath, internal);
  }

  const topLevel = input.children;
  if (!Array.isArray(topLevel)) {
    add(issues, "children", "children.type", `Expected an array of node ids, received ${describe(topLevel)}.`);
  }

  const childOwner = new Map<string, string>();
  const registerChildren = (owner: string, children: unknown, path: string): void => {
    if (!Array.isArray(children)) return;
    const local = new Set<string>();
    children.forEach((child, index) => {
      if (typeof child !== "string") return;
      if (local.has(child)) {
        add(issues, `${path}[${index}]`, "children.duplicate", `Node ${child} appears twice under the same parent.`);
        return;
      }
      local.add(child);
      if (!Object.prototype.hasOwnProperty.call(nodes, child)) {
        add(issues, `${path}[${index}]`, "children.dangling", `Node ${child} does not exist on this page.`);
        return;
      }
      if (child === owner) {
        add(issues, `${path}[${index}]`, "children.self", "A node cannot be its own child.");
      }
      const previous = childOwner.get(child);
      if (previous !== undefined) {
        add(issues, `${path}[${index}]`, "children.multi-parent", `Node ${child} already has parent ${previous}.`);
      } else {
        childOwner.set(child, owner);
      }
    });
  };

  registerChildren("page", topLevel, "children");
  for (const [id, node] of Object.entries(nodes)) {
    if (!isRecord(node)) continue;
    if (node.type === "frame" || node.type === "group") {
      registerChildren(id, node.children, `nodes.${id}.children`);
    }
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string, path: string): void => {
    if (!Object.prototype.hasOwnProperty.call(nodes, id)) return;
    if (stack.has(id)) {
      add(issues, path, "children.cycle", `Node ${id} is part of a cycle.`);
      return;
    }
    if (visited.has(id)) return;
    stack.add(id);
    const node = nodes[id];
    if (isRecord(node) && Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        if (typeof child === "string") visit(child, `nodes.${id}.children[${index}]`);
      });
    }
    stack.delete(id);
    visited.add(id);
  };

  if (Array.isArray(topLevel)) {
    topLevel.forEach((id, index) => {
      if (typeof id === "string") visit(id, `children[${index}]`);
    });
  }
  for (const id of Object.keys(nodes)) {
    if (!visited.has(id)) {
      add(issues, `nodes.${id}`, "node.unreachable", "Node is not reachable from the page root.");
    }
  }

  return issues;
}

export function validateDesign(
  manifestInput: unknown,
  pageInputs: unknown[],
): ValidationIssue[] {
  const issues = validateManifest(manifestInput);
  if (!Array.isArray(pageInputs)) {
    add(issues, "pages", "type.array", "Design pages must be an array.");
    return issues;
  }

  const manifest = isRecord(manifestInput) ? manifestInput : null;
  const tokens =
    manifest && isRecord(manifest.tokens) ? (manifest.tokens as TokenTree) : undefined;
  const assets =
    manifest && Array.isArray(manifest.assets)
      ? (manifest.assets.filter(
          (asset): asset is Asset => isRecord(asset) && typeof asset.id === "string",
        ) as Asset[])
      : undefined;

  const refs = new Map<string, Record<string, unknown>>();
  if (manifest && Array.isArray(manifest.pages)) {
    for (const ref of manifest.pages) {
      if (isRecord(ref) && typeof ref.id === "string" && !refs.has(ref.id)) {
        refs.set(ref.id, ref);
      }
    }
  }

  const seen = new Set<string>();
  const nodeOwners = new Map<string, number>();

  pageInputs.forEach((pageInput, index) => {
    const pagePath = `pages[${index}]`;
    const pageIssues = validatePage(pageInput, { tokens, assets });
    for (const issue of pageIssues) {
      issues.push({ ...issue, path: issue.path ? `${pagePath}.${issue.path}` : pagePath });
    }

    if (!isRecord(pageInput) || typeof pageInput.id !== "string") return;

    if (seen.has(pageInput.id)) {
      add(issues, `${pagePath}.id`, "page.duplicate-document", `Duplicate page document ${pageInput.id}.`);
    }
    seen.add(pageInput.id);

    const ref = refs.get(pageInput.id);
    if (!ref) {
      add(issues, `${pagePath}.id`, "page.unreferenced", `Page ${pageInput.id} is not listed in the manifest.`);
    } else if (ref.name !== pageInput.name) {
      add(issues, `${pagePath}.name`, "page.name-mismatch", "Page name must match the manifest entry.");
    }

    if (isRecord(pageInput.nodes)) {
      for (const nodeId of Object.keys(pageInput.nodes)) {
        const owner = nodeOwners.get(nodeId);
        if (owner !== undefined) {
          add(
            issues,
            `${pagePath}.nodes.${nodeId}`,
            "node.duplicate-global",
            `Node id also appears on pages[${owner}]; node ids must be unique across a design.`,
          );
        } else {
          nodeOwners.set(nodeId, index);
        }
      }
    }
  });

  for (const [id, ref] of refs) {
    if (!seen.has(id)) {
      add(
        issues,
        "pages",
        "page.missing",
        `Manifest lists page ${JSON.stringify(ref.name)} (${id}) but no page document was provided.`,
      );
    }
  }

  return issues;
}

export function assertValidManifest(input: unknown): asserts input is DesignManifest {
  const issues = validateManifest(input);
  if (issues.length > 0) throw new WeftValidationError(issues);
}

export function assertValidPage(
  input: unknown,
  options: ValidatePageOptions = {},
): asserts input is PageDocument {
  const issues = validatePage(input, options);
  if (issues.length > 0) throw new WeftValidationError(issues);
}

export function assertValidDesign(manifest: unknown, pages: unknown[]): void {
  const issues = validateDesign(manifest, pages);
  if (issues.length > 0) throw new WeftValidationError(issues);
}
