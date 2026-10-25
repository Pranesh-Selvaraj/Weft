import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { assertAllowedUrl, normalizeOrigin } from "./allowlist.js";
import { ExtractError } from "./errors.js";
import {
  sanitizeCapturedCss,
  sanitizeCapturedMarkup,
} from "./sanitize.js";
import type { CaptureRequest, CapturedSnapshot } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 8 * 1024 * 1024;

function candidatePaths(): string[] {
  const candidates: string[] = [];
  const env = process.env.WEFT_CHROMIUM ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (env) candidates.push(env);

  try {
    candidates.push(chromium.executablePath());
  } catch {
    // Playwright is not bundled with a browser in this installation.
  }

  candidates.push(
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  );

  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    try {
      for (const entry of readdirSync(cache)) {
        if (!entry.startsWith("chromium")) continue;
        candidates.push(
          join(cache, entry, "chrome-linux", "chrome"),
          join(cache, entry, "chrome-linux64", "chrome"),
          join(cache, entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
          join(cache, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        );
      }
    } catch {
      // An unreadable cache is not a reason to fail before checking system paths.
    }
  }
  return candidates;
}

/** Find a usable Chromium executable, or explain how to provide one. */
export function discoverChromium(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new ExtractError("extract.browser", `Chromium executable not found at ${explicit}.`);
    }
    return explicit;
  }
  const found = candidatePaths().find((candidate) => existsSync(candidate));
  if (!found) {
    throw new ExtractError(
      "extract.browser",
      "No Chromium executable found. Set WEFT_CHROMIUM=/path/to/chrome or pass --browser.",
    );
  }
  return found;
}

function launchArgs(): string[] {
  const args = [
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const noSandbox =
    process.env.WEFT_CHROMIUM_NO_SANDBOX === "1" ||
    (typeof process.getuid === "function" && process.getuid() === 0);
  if (noSandbox) args.push("--no-sandbox", "--disable-setuid-sandbox");
  return args;
}

/**
 * Capture one page with Playwright. Scripts execute during capture so the
 * application renders, but the returned markup has scripts, event handlers,
 * forms, frames and external fetches removed. The final browser context is
 * closed on every path.
 */
export async function captureWithPlaywright(
  request: CaptureRequest,
): Promise<CapturedSnapshot> {
  const allowed = assertAllowedUrl(request.url, request.allowedOrigins);
  const allowedOrigins = new Set(
    request.allowedOrigins.map((origin) => normalizeOrigin(origin, "extract.origins entry")),
  );
  const executablePath = discoverChromium(request.browserPath);
  const timeoutMs = Math.min(
    120_000,
    Math.max(1_000, request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );
  const maxAssetBytes = Math.min(
    8 * 1024 * 1024,
    Math.max(0, request.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES),
  );

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      timeout: timeoutMs,
      args: launchArgs(),
    });
    context = await browser.newContext({
      viewport: request.viewport,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      locale: "en-US",
      acceptDownloads: false,
    });

    await context.route("**/*", async (route) => {
      const target = route.request().url();
      let origin: string | null = null;
      try {
        origin = new URL(target).origin;
      } catch {
        // Non-http schemes (data:, blob:, about:) are handled below.
      }
      if (origin === null || allowedOrigins.has(origin)) {
        await route.continue().catch(() => undefined);
      } else {
        await route.abort("blockedbyclient").catch(() => undefined);
      }
    });

    await context.routeWebSocket(/.*/, async (webSocket) => {
      let origin: string | null = null;
      try {
        const parsed = new URL(webSocket.url());
        if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
          origin = `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
        }
      } catch {
        // Invalid WebSocket URLs are closed below.
      }
      if (origin !== null && allowedOrigins.has(origin)) {
        webSocket.connectToServer();
      } else {
        await webSocket.close({ code: 1008, reason: "origin not allowed" }).catch(() => undefined);
      }
    });

    const page = await context.newPage();
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    page.on("popup", (popup) => {
      void popup.close().catch(() => undefined);
    });

    try {
      await page.goto(allowed.url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      if (request.selector) {
        await page.waitForSelector(request.selector, {
          state: "attached",
          timeout: timeoutMs,
        });
      } else {
        await page.waitForLoadState("load", { timeout: Math.min(timeoutMs, 10_000) }).catch(
          () => undefined,
        );
      }
      await page.waitForTimeout(250);

      const captured = await page.evaluate(
        async ({ selector, viewportWidth, viewportHeight, maxAssetBytes, maxTotalAssetBytes }) => {
          const warnings: string[] = [];
          const STYLE_PROPERTIES = [
            "display", "position", "inset", "top", "right", "bottom", "left",
            "width", "height", "min-width", "min-height", "max-width", "max-height",
            "box-sizing", "margin-top", "margin-right", "margin-bottom", "margin-left",
            "padding-top", "padding-right", "padding-bottom", "padding-left",
            "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
            "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
            "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
            "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
            "background-color", "background-image", "background-position", "background-size",
            "background-repeat", "background-origin", "background-clip", "background-blend-mode",
            "box-shadow", "opacity", "overflow-x", "overflow-y",
            "color", "font-family", "font-size", "font-weight", "font-style", "font-variant",
            "line-height", "letter-spacing", "word-spacing", "text-align",
            "text-decoration-line", "text-decoration-color", "text-transform", "white-space",
            "word-break", "overflow-wrap", "text-overflow", "text-shadow", "vertical-align",
            "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
            "justify-content", "align-items", "align-content", "align-self", "gap", "row-gap",
            "column-gap", "order", "grid-template-columns", "grid-template-rows",
            "grid-template-areas", "grid-auto-flow", "grid-column", "grid-row",
            "transform", "transform-origin", "perspective", "object-fit", "object-position",
            "visibility", "content", "list-style-type", "list-style-position", "list-style-image",
            "z-index", "filter", "backdrop-filter", "clip-path", "mix-blend-mode",
            "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
            "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
          ];
          const SKIP_TAGS = new Set([
            "script", "style", "link", "meta", "base", "iframe", "object", "embed",
            "noscript", "template", "source", "track", "param", "frame", "frameset",
            "applet", "canvas", "animate", "animateTransform", "animateMotion", "set", "discard",
          ]);
          const KEEP_ATTRIBUTES = new Set([
            "alt", "title", "role", "aria-label", "aria-hidden", "dir", "lang",
            "colspan", "rowspan", "scope", "value", "placeholder", "checked", "selected",
            "disabled", "type", "start", "reversed",
          ]);
          const SVG_ATTRIBUTES = new Set([
            "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
            "width", "height", "viewBox", "preserveAspectRatio", "transform", "pathLength",
            "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width",
            "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
            "stroke-dashoffset", "opacity", "offset", "stop-color", "stop-opacity",
            "gradientUnits", "gradientTransform", "patternUnits", "patternTransform",
          ]);
          const target = selector ? document.querySelector(selector) : document.body;
          if (!target) throw new Error(`Selector ${JSON.stringify(selector)} did not match an element.`);

          const total = getComputedStyle(target);
          const rect = target.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.min(
              20_000,
              Math.ceil(rect.width > 0 ? rect.width : Number.parseFloat(total.width) || viewportWidth),
            ),
          );
          const height = Math.max(
            1,
            Math.min(
              20_000,
              Math.ceil(
                target === document.body
                  ? Math.max(document.documentElement.scrollHeight, viewportHeight)
                  : rect.height > 0
                    ? rect.height
                    : Number.parseFloat(total.height) || viewportHeight,
              ),
            ),
          );

          interface StyleMap { [key: string]: string }
          const collected: Array<{ index: number; style: StyleMap; before?: StyleMap; after?: StyleMap }> = [];
          let counter = 0;

          const readStyle = (style: CSSStyleDeclaration, pseudo = false): StyleMap => {
            const output: StyleMap = {};
            for (const property of STYLE_PROPERTIES) {
              const value = style.getPropertyValue(property);
              if (!value || value === "normal" || value === "auto") continue;
              if (value === "none" && property !== "display") continue;
              output[property] = value;
            }
            if (pseudo) {
              const content = style.getPropertyValue("content");
              if (content && content !== "none" && content !== "normal") output.content = content;
            }
            return output;
          };

          const readPseudo = (original: Element, which: "::before" | "::after"): StyleMap | undefined => {
            const style = getComputedStyle(original, which);
            const content = style.getPropertyValue("content");
            if (!content || content === "none" || content === "normal") return undefined;
            if (style.getPropertyValue("display") === "none") return undefined;
            return readStyle(style, true);
          };

          const assignStyles = (original: Element, clone: Element): number => {
            const index = counter++;
            clone.setAttribute("data-weft-k", String(index));
            const style = readStyle(getComputedStyle(original));
            const before = readPseudo(original, "::before");
            const after = readPseudo(original, "::after");
            collected.push({
              index,
              style,
              ...(before ? { before } : {}),
              ...(after ? { after } : {}),
            });
            return index;
          };

          const shouldSkip = (element: Element): boolean => {
            const tag = element.localName.toLowerCase();
            if (SKIP_TAGS.has(tag)) return true;
            if (tag === "input" && (element as HTMLInputElement).type === "hidden") return true;
            return false;
          };

          const addSafeAttributes = (original: Element, clone: Element): void => {
            const tag = original.localName.toLowerCase();
            const isSvg = original.namespaceURI === "http://www.w3.org/2000/svg";
            for (const attribute of Array.from(original.attributes)) {
              const name = attribute.name;
              const lower = name.toLowerCase();
              if (
                lower === "style" || lower === "class" || (lower === "id" && !isSvg) ||
                lower.startsWith("on") || lower === "srcset" || lower === "sizes" ||
                lower === "contenteditable" || lower === "name" || lower === "tabindex" ||
                lower === "srcdoc" || lower === "formaction" || lower === "action" ||
                lower === "method" || lower === "ping" || lower === "download" ||
                lower === "href" || lower === "xlink:href"
              ) {
                continue;
              }
              if (isSvg) {
                if (lower === "id" && /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(attribute.value)) {
                  clone.setAttribute("id", attribute.value);
                } else if (SVG_ATTRIBUTES.has(name) || SVG_ATTRIBUTES.has(lower)) {
                  clone.setAttribute(name, attribute.value);
                }
                continue;
              }
              if (tag === "img" && lower === "src") continue;
              if (KEEP_ATTRIBUTES.has(lower)) clone.setAttribute(lower, attribute.value);
            }

            if (tag === "input") {
              const input = original as HTMLInputElement;
              if (input.type !== "password") clone.setAttribute("value", input.value);
              if (input.checked) clone.setAttribute("checked", "");
            }
            if (tag === "textarea") {
              const textarea = original as HTMLTextAreaElement;
              clone.textContent = textarea.value;
            }
            if (tag === "option") {
              const option = original as HTMLOptionElement;
              if (option.selected) clone.setAttribute("selected", "");
            }
            if (tag === "img") {
              const image = original as HTMLImageElement;
              const src = image.currentSrc || image.src;
              if (src) clone.setAttribute("data-weft-src", src);
            }
            if (isSvg && tag === "image") {
              const href = original.getAttribute("href") ?? original.getAttribute("xlink:href");
              if (href) clone.setAttribute("data-weft-src", new URL(href, document.baseURI).href);
            }
          };

          const copyElement = (original: Element): Element | null => {
            if (shouldSkip(original)) return null;
            const tag = original.localName.toLowerCase() === "form" ? "div" : original.localName;
            const clone = original.namespaceURI === "http://www.w3.org/2000/svg"
              ? document.createElementNS("http://www.w3.org/2000/svg", tag)
              : document.createElement(tag);
            assignStyles(original, clone);
            addSafeAttributes(original, clone);
            for (const child of Array.from(original.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                clone.appendChild(document.createTextNode(child.textContent ?? ""));
              } else if (child.nodeType === Node.ELEMENT_NODE) {
                const copied = copyElement(child as Element);
                if (copied) clone.appendChild(copied);
              }
            }
            return clone;
          };

          let root: Element;
          const targetIsBody = target === document.body || target === document.documentElement;
          if (targetIsBody) {
            root = document.createElement("div");
            assignStyles(document.body, root);
            for (const child of Array.from(document.body.childNodes)) {
              if (child.nodeType === Node.TEXT_NODE) {
                root.appendChild(document.createTextNode(child.textContent ?? ""));
              } else if (child.nodeType === Node.ELEMENT_NODE) {
                const copied = copyElement(child as Element);
                if (copied) root.appendChild(copied);
              }
            }
          } else {
            const copied = copyElement(target);
            if (!copied) throw new Error("The selected element is not capturable.");
            root = copied;
          }

          const assetCache = new Map<string, string | null>();
          let totalAssetBytes = 0;
          const inlineAsset = async (rawUrl: string): Promise<string | null> => {
            if (rawUrl.startsWith("data:")) return rawUrl;
            let absolute: URL;
            try {
              absolute = new URL(rawUrl, document.baseURI);
            } catch {
              return null;
            }
            if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return null;
            // Inline only same-origin assets. Cross-origin resources are
            // blocked by the request route and deliberately not fetched by a
            // second path.
            if (absolute.origin !== window.location.origin) return null;
            const cached = assetCache.get(absolute.href);
            if (cached !== undefined) return cached;
            try {
              const response = await fetch(absolute.href, { credentials: "omit" });
              if (!response.ok) {
                assetCache.set(absolute.href, null);
                return null;
              }
              const declaredLength = Number(response.headers.get("content-length"));
              if (Number.isFinite(declaredLength) && declaredLength > maxAssetBytes) {
                warnings.push(`Skipped asset ${absolute.href}: declared size exceeds the per-asset budget.`);
                assetCache.set(absolute.href, null);
                return null;
              }
              const buffer = await response.arrayBuffer();
              if (buffer.byteLength === 0 || buffer.byteLength > maxAssetBytes) {
                warnings.push(`Skipped asset ${absolute.href}: ${buffer.byteLength} bytes.`);
                assetCache.set(absolute.href, null);
                return null;
              }
              if (totalAssetBytes + buffer.byteLength > maxTotalAssetBytes) {
                warnings.push(`Asset budget exhausted; skipped ${absolute.href}.`);
                assetCache.set(absolute.href, null);
                return null;
              }
              totalAssetBytes += buffer.byteLength;
              const bytes = new Uint8Array(buffer);
              let binary = "";
              const chunk = 0x8000;
              for (let index = 0; index < bytes.length; index += chunk) {
                binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
              }
              const contentType = (
                response.headers.get("content-type") ??
                (absolute.pathname.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream")
              ).toLowerCase();
              if (!contentType.startsWith("image/")) {
                warnings.push(`Skipped non-image asset ${absolute.href}.`);
                assetCache.set(absolute.href, null);
                return null;
              }
              const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
              assetCache.set(absolute.href, dataUrl);
              return dataUrl;
            } catch {
              warnings.push(`Could not inline asset ${absolute.href}.`);
              assetCache.set(absolute.href, null);
              return null;
            }
          };

          const inlineCssValue = async (property: string, value: string): Promise<string> => {
            const matches = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)];
            if (matches.length === 0) return value;
            let next = value;
            for (const match of matches) {
              const asset = await inlineAsset(match[2]);
              if (asset) {
                next = next.replace(match[0], `url("${asset}")`);
              } else {
                return property === "background-image" || property === "list-style-image" || property === "border-image-source"
                  ? "none"
                  : next.replace(match[0], "");
              }
            }
            return next;
          };

          const imageNodes = [
            ...(root.hasAttribute("data-weft-src") ? [root] : []),
            ...Array.from(root.querySelectorAll("[data-weft-src]")),
          ];
          for (const element of imageNodes) {
            const source = element.getAttribute("data-weft-src");
            element.removeAttribute("data-weft-src");
            if (!source) continue;
            const data = await inlineAsset(source);
            if (data && data.startsWith("data:image/")) {
              if (element.localName.toLowerCase() === "img") element.setAttribute("src", data);
              else element.setAttribute("href", data);
            }
          }
          for (const item of collected) {
            for (const [property, value] of Object.entries(item.style)) {
              if (value.includes("url(")) item.style[property] = await inlineCssValue(property, value);
            }
            for (const pseudo of [item.before, item.after]) {
              if (!pseudo) continue;
              for (const [property, value] of Object.entries(pseudo)) {
                if (value.includes("url(")) pseudo[property] = await inlineCssValue(property, value);
              }
            }
          }

          const toCss = (style: StyleMap): string =>
            Object.entries(style)
              .map(([property, value]) => `${property}:${value}`)
              .join(";");
          const rules = [
            "html,body{margin:0;padding:0;background:transparent}",
            "*,*::before,*::after{box-sizing:border-box;animation:none!important;transition:none!important}",
            '[data-weft-k="0"]{margin:0!important;position:relative!important;top:auto!important;right:auto!important;bottom:auto!important;left:auto!important}', 
            ...collected.flatMap((item) => {
              const output = [`[data-weft-k="${item.index}"]{${toCss(item.style)}}`];
              if (item.before) output.push(`[data-weft-k="${item.index}"]::before{${toCss(item.before)}}`);
              if (item.after) output.push(`[data-weft-k="${item.index}"]::after{${toCss(item.after)}}`);
              return output;
            }),
          ];

          return {
            html: root.outerHTML,
            css: rules.join("\n"),
            width,
            height,
            warnings,
          };
        },
        {
          selector: request.selector ?? null,
          viewportWidth: request.viewport.width,
          viewportHeight: request.viewport.height,
          maxAssetBytes,
          maxTotalAssetBytes: MAX_TOTAL_ASSET_BYTES,
        },
      );

      return {
        html: sanitizeCapturedMarkup(captured.html),
        css: sanitizeCapturedCss(captured.css),
        source: {
          url: allowed.url,
          ...(request.selector ? { selector: request.selector } : {}),
          viewport: { width: captured.width, height: captured.height },
          capturedAt: new Date().toISOString(),
        },
        warnings: captured.warnings,
      };
    } catch (error) {
      if (error instanceof ExtractError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new ExtractError(
        "extract.capture",
        `Could not capture ${allowed.url}: ${detail.replace(/\u001b\[[0-9;]*m/g, "")}`,
      );
    }
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
