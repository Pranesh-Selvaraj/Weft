import { ExtractError } from "./errors.js";

const BLOCKED_ELEMENTS = [
  "script",
  "style",
  "link",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "noscript",
  "template",
  "form",
] as const;

function unsafe(message: string): never {
  throw new ExtractError("extract.sanitize", message);
}

/**
 * The browser clone is the primary sanitizer. This Node pass verifies that
 * executable markup, event attributes and network-capable URL attributes did
 * not survive; it fails closed instead of trying to repair HTML with regular
 * expressions. That makes a browser-sanitizer regression loud and leaves no
 * partially cleaned string to write into a design.
 */
export function sanitizeCapturedMarkup(html: string): string {
  const lower = html.toLowerCase();
  for (const tag of BLOCKED_ELEMENTS) {
    if (lower.includes(`<${tag}`)) {
      unsafe(`Captured markup still contains a <${tag}> element.`);
    }
  }
  if (/\son[a-z0-9_-]+\s*=/i.test(html)) {
    unsafe("Captured markup still contains an event-handler attribute.");
  }

  const urlAttribute = /\s+(src|href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const match of html.matchAll(urlAttribute)) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!value.startsWith("data:image/") && !value.startsWith("#")) {
      unsafe(`Captured markup still contains a non-data URL attribute: ${value.slice(0, 80)}`);
    }
  }
  return html;
}

/** Remove stylesheet escapes and external network fetches from captured CSS. */
export function sanitizeCapturedCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/javascript\s*:/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:|#)[^)]*\)/gi, "none")
    .replace(/behavior\s*:[^;]*;?/gi, "")
    .replace(/-moz-binding\s*:[^;]*;?/gi, "");
}
