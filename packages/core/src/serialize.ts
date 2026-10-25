import type { JsonValue } from "./types.js";

/**
 * Deterministic JSON for design files.
 *
 * Two clients that hold the same logical document must write byte-identical
 * files, otherwise every save produces a spurious diff and the file watcher in
 * the bridge sees a conflict that is not real. The rules are:
 *
 * - object keys are sorted;
 * - array order is preserved because it is semantic;
 * - numbers are rounded to three decimals (sub-pixel precision) and `-0`
 *   becomes `0`;
 * - `undefined` object properties are omitted, as JSON would;
 * - non-JSON values (functions, bigint, symbol, NaN, Infinity, class instances,
 *   cycles) throw instead of silently disappearing;
 * - the output ends with one newline and uses two-space indentation.
 *
 * Unknown fields are preserved because they are part of the input object and
 * are not filtered by this module.
 */

const DEFAULT_PRECISION = 3;

export class WeftSerializeError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(path ? `${message} (at ${path})` : message);
    this.name = "WeftSerializeError";
    this.path = path;
  }
}

export interface SerializeOptions {
  /** Spaces per indent level. `0` writes compact JSON. Default: 2. */
  indent?: number;
  /** Decimal places for numbers. Default: 3. */
  precision?: number;
}

export class WeftParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WeftParseError";
  }
}

function joinPath(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function normalizeNumber(value: number, path: string, precision: number): number {
  if (!Number.isFinite(value)) {
    throw new WeftSerializeError(`Number must be finite, received ${String(value)}`, path);
  }
  if (Object.is(value, -0)) return 0;
  const factor = 10 ** precision;
  const scaled = Math.abs(value) * factor;
  if (!Number.isFinite(scaled)) return value;
  const rounded = (Math.sign(value) * Math.round(scaled)) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalize(
  value: unknown,
  path: string,
  precision: number,
  ancestors: WeakSet<object>,
): JsonValue {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return normalizeNumber(value, path, precision);
    case "undefined":
      throw new WeftSerializeError("Undefined is not a JSON value", path);
    case "bigint":
      throw new WeftSerializeError("BigInt is not a JSON value", path);
    case "function":
      throw new WeftSerializeError("Functions are not JSON values", path);
    case "symbol":
      throw new WeftSerializeError("Symbols are not JSON values", path);
    case "object":
      break;
    default:
      throw new WeftSerializeError(`Unsupported value type: ${typeof value}`, path);
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new WeftSerializeError("Circular reference", path);
  }
  ancestors.add(object);

  try {
    if (Array.isArray(object)) {
      return object.map((item, index) => normalize(item, joinPath(path, index), precision, ancestors));
    }

    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WeftSerializeError("Expected a plain object", path);
    }

    const source = object as Record<string, unknown>;
    const result: Record<string, JsonValue> = Object.create(null);
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) continue;
      result[key] = normalize(item, joinPath(path, key), precision, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(object);
  }
}

/** Return a deep, key-sorted, number-normalized copy safe for deterministic JSON. */
export function canonicalize(value: unknown, precision = DEFAULT_PRECISION): JsonValue {
  if (value === undefined) {
    throw new WeftSerializeError("Undefined is not a JSON value", "");
  }
  return normalize(value, "", precision, new WeakSet());
}

/** Serialize any JSON-compatible value deterministically. Always ends with `\n`. */
export function serialize(value: unknown, options: SerializeOptions = {}): string {
  const indent = options.indent ?? 2;
  const precision = options.precision ?? DEFAULT_PRECISION;
  if (!Number.isInteger(indent) || indent < 0) {
    throw new WeftSerializeError("Indent must be a non-negative integer", "");
  }
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
    throw new WeftSerializeError("Precision must be an integer between 0 and 12", "");
  }
  const canonical = canonicalize(value, precision);
  return `${JSON.stringify(canonical, null, indent)}\n`;
}

/** Parse JSON and wrap syntax errors in a typed error with the original cause. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WeftParseError(`Invalid JSON: ${message}`, { cause: error });
  }
}
