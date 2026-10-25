import type { TokenTree, TokenValue } from "./types.js";

/**
 * Token references use the `{path.to.token}` syntax inside strings, so a paint
 * can read `"{color.surface}"` and still be valid JSON. Values that are not
 * wrapped in braces are literal CSS values.
 */
const TOKEN_REF_RE = /^\{([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\}$/;

/** Parse a token reference, returning its dot-separated path or `null`. */
export function parseTokenRef(value: string): string | null {
  const match = TOKEN_REF_RE.exec(value);
  return match ? match[1] : null;
}

/** Whether a value is a complete token reference, not just a string with braces. */
export function isTokenRef(value: unknown): value is string {
  return typeof value === "string" && TOKEN_REF_RE.test(value);
}

function isTokenGroup(value: unknown): value is TokenTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenValue(value: unknown): value is TokenValue {
  return typeof value === "string" || typeof value === "number";
}

/** Look up a token by path. Returns `undefined` for missing paths and groups. */
export function lookupToken(tokens: TokenTree | undefined, path: string): TokenValue | undefined {
  if (!tokens || path.length === 0) return undefined;
  let current: TokenTree | TokenValue | undefined = tokens;
  for (const segment of path.split(".")) {
    if (!isTokenGroup(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return isTokenValue(current) ? current : undefined;
}

/**
 * Resolve a literal or a token reference to a value. Literal values pass
 * through. An unresolved reference returns `undefined` so callers can report a
 * missing token rather than silently rendering the braces.
 */
export function resolveToken(
  tokens: TokenTree | undefined,
  value: TokenValue,
): TokenValue | undefined {
  if (typeof value === "number") return value;
  const path = parseTokenRef(value);
  if (path === null) return value;
  return lookupToken(tokens, path);
}

/** List every leaf token path, in tree order. Useful for completion and export. */
export function listTokenPaths(tokens: TokenTree | undefined): string[] {
  if (!tokens) return [];
  const paths: string[] = [];
  const walk = (tree: TokenTree, prefix: string): void => {
    for (const [key, value] of Object.entries(tree)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (isTokenGroup(value)) {
        walk(value, path);
      } else if (isTokenValue(value)) {
        paths.push(path);
      }
    }
  };
  walk(tokens, "");
  return paths;
}

/**
 * Collect token-reference paths from an arbitrary JSON-ish value. Used by the
 * validator and by the editor to know which tokens a node depends on.
 */
export function collectTokenRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const seen = new WeakSet<object>();

  const walk = (current: unknown): void => {
    if (typeof current === "string") {
      const path = parseTokenRef(current);
      if (path !== null) refs.add(path);
      return;
    }
    if (typeof current !== "object" || current === null) return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    for (const item of Object.values(current)) walk(item);
  };

  walk(value);
  return [...refs];
}
