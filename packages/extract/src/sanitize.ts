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
  // The browser keeps inlined images in inert data attributes; promote them
  // only after their data:image/ prefix has been checked below.
  const withImages = html
    .replaceAll(' data-weft-img="', ' src="')
    .replaceAll(' data-weft-href="', ' href="');
  const lower = withImages.toLowerCase();
  for (const tag of BLOCKED_ELEMENTS) {
    if (lower.includes(`<${tag}`)) {
      unsafe(`Captured markup still contains a <${tag}> element.`);
    }
  }
  if (/\son[a-z0-9_-]+\s*=/i.test(withImages)) {
    unsafe("Captured markup still contains an event-handler attribute.");
  }

  const lowerForAttributes = lower;
  for (const name of ["xlink:href", "href", "src"]) {
    let index = 0;
    while (true) {
      const found = lowerForAttributes.indexOf(name, index);
      if (found === -1) break;
      index = found + name.length;
      const before = found === 0 ? " " : lowerForAttributes[found - 1];
      if (before !== " " && before !== "\t" && before !== "\n" && before !== "\r" && before !== "/" && before !== "<") {
        continue;
      }
      let cursor = index;
      while (cursor < lowerForAttributes.length && /\s/.test(lowerForAttributes[cursor])) cursor += 1;
      if (lowerForAttributes[cursor] !== "=") continue;
      cursor += 1;
      while (cursor < lowerForAttributes.length && /\s/.test(lowerForAttributes[cursor])) cursor += 1;
      let value: string;
      if (lowerForAttributes[cursor] === '"' || lowerForAttributes[cursor] === "'") {
        const quote = lowerForAttributes[cursor];
        cursor += 1;
        const end = lowerForAttributes.indexOf(quote, cursor);
        if (end === -1) unsafe("Captured markup has an unterminated URL attribute.");
        value = withImages.slice(cursor, end);
        index = end + 1;
      } else {
        let end = cursor;
        while (end < lowerForAttributes.length && !/\s|>/.test(lowerForAttributes[end])) end += 1;
        value = withImages.slice(cursor, end);
        index = end;
      }
      const normalized = value.toLowerCase();
      if (!normalized.startsWith("data:image/") && !normalized.startsWith("#")) {
        unsafe(`Captured markup still contains a non-data URL attribute: ${value.slice(0, 80)}`);
      }
    }
  }
  return withImages;
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
