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

/**
 * A final, dependency-free defence pass over browser-sanitized markup. The
 * browser capture already removes these nodes and attributes; this pass keeps a
 * regression in that code from writing executable HTML into a design.
 */
export function sanitizeCapturedMarkup(html: string): string {
  let output = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const tag of BLOCKED_ELEMENTS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const unpaired = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    output = output.replace(paired, "").replace(unpaired, "");
  }

  // Event handlers, executable attributes and refresh/navigation surfaces.
  output = output.replace(
    /\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  output = output.replace(
    /\s(srcdoc|formaction|ping|target|download)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );
  output = output.replace(
    /\s(srcdoc|formaction|action|method)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "",
  );

  // Anything that could navigate or fetch outside the snapshot must not remain.
  // Keep data: payloads and same-document #fragment references; remove all
  // other URLs, including relative ones that could reach the network.
  output = output.replace(
    /\s+(src|href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match: string, _name: string, _quoted: string, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const value = double ?? single ?? bare ?? "";
      return value.startsWith("data:image/") || value.startsWith("#") ? match : "";
    },
  );
  output = output.replace(/\s+srcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return output;
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
