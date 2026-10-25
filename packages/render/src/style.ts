import type { CSSProperties } from "react";
import {
  resolveToken,
  type FontStyle,
  type Layout,
  type Node,
  type PageDocument,
  type Paint,
  type Shadow,
  type Style,
  type TokenTree,
} from "@weft/core";

export type AssetUrlResolver = (assetId: string) => string | undefined;

export interface PageBounds {
  width: number;
  height: number;
}

const FALLBACK_COLOR = "transparent";
const DEFAULT_FONT_FAMILY = "Inter, system-ui, -apple-system, sans-serif";

export function resolveColor(tokens: TokenTree | undefined, value: string): string {
  const resolved = resolveToken(tokens, value);
  return typeof resolved === "string" ? resolved : FALLBACK_COLOR;
}

export function resolveString(tokens: TokenTree | undefined, value: string): string {
  const resolved = resolveToken(tokens, value);
  return typeof resolved === "string" ? resolved : value;
}

function gradientCss(paint: Extract<Paint, { type: "linear-gradient" }>, tokens?: TokenTree): string {
  const stops = paint.stops
    .map((stop) => `${resolveColor(tokens, stop.color)} ${stop.offset * 100}%`)
    .join(", ");
  return `linear-gradient(${paint.angle}deg, ${stops})`;
}

/**
 * Convert a paint stack into background CSS. Solid paints become the
 * background color, gradients and images become background images.
 */
export function paintsToStyle(
  paints: Paint[] | undefined,
  tokens?: TokenTree,
  assetUrl?: AssetUrlResolver,
): CSSProperties {
  if (!paints || paints.length === 0) return {};
  let color: string | undefined;
  const images: string[] = [];
  let imageFit: Extract<Paint, { type: "image" }>["fit"];

  for (const paint of paints) {
    if (paint.type === "solid") {
      color = resolveColor(tokens, paint.color);
      continue;
    }
    if (paint.type === "linear-gradient") {
      images.push(gradientCss(paint, tokens));
      continue;
    }
    const url = assetUrl?.(paint.asset);
    if (url) {
      images.push(`url("${url}")`);
      imageFit = imageFit ?? paint.fit;
    }
  }

  const style: CSSProperties = {};
  if (color !== undefined) style.backgroundColor = color;
  if (images.length > 0) {
    style.backgroundImage = images.join(", ");
    style.backgroundRepeat = "no-repeat";
    style.backgroundPosition = "center";
    style.backgroundSize =
      imageFit === "contain"
        ? "contain"
        : imageFit === "fill"
          ? "100% 100%"
          : imageFit === "none"
            ? "auto"
            : "cover";
  }
  return style;
}

export function backgroundStyle(
  paint: Paint | null | undefined,
  tokens?: TokenTree,
  assetUrl?: AssetUrlResolver,
): CSSProperties {
  if (!paint) return {};
  return paintsToStyle([paint], tokens, assetUrl);
}

export function radiusToCss(value: number | [number, number, number, number] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return `${value}px`;
  return value.map((radius) => `${radius}px`).join(" ");
}

export function paddingToCss(value: number | [number, number] | [number, number, number, number] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return `${value}px`;
  return value.map((padding) => `${padding}px`).join(" ");
}

function shadowsToCss(shadows: Shadow[] | undefined, tokens?: TokenTree): string | undefined {
  if (!shadows || shadows.length === 0) return undefined;
  return shadows
    .map((shadow) => {
      const inset = shadow.inset ? "inset " : "";
      return `${inset}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread ?? 0}px ${resolveColor(tokens, shadow.color)}`;
    })
    .join(", ");
}

export function surfaceStyle(style: Style | undefined, tokens?: TokenTree, assetUrl?: AssetUrlResolver): CSSProperties {
  if (!style) return {};
  const css: CSSProperties = {
    ...paintsToStyle(style.fills, tokens, assetUrl),
  };

  const stroke = style.strokes?.find((paint): paint is Extract<Paint, { type: "solid" }> => paint.type === "solid");
  if (stroke) {
    css.border = `${style.strokeWidth ?? 1}px solid ${resolveColor(tokens, stroke.color)}`;
  }

  const radius = radiusToCss(style.radius);
  if (radius) css.borderRadius = radius;

  const shadow = shadowsToCss(style.shadows, tokens);
  if (shadow) css.boxShadow = shadow;

  if (style.opacity !== undefined) css.opacity = style.opacity;
  if (style.blur !== undefined && style.blur > 0) css.filter = `blur(${style.blur}px)`;
  return css;
}

export function textStyle(
  font: FontStyle | undefined,
  style: Style | undefined,
  tokens?: TokenTree,
): CSSProperties {
  const css: CSSProperties = {
    fontFamily: font ? resolveString(tokens, font.family) : DEFAULT_FONT_FAMILY,
    fontSize: font?.size ?? 16,
    fontWeight: font?.weight ?? 400,
    lineHeight: font?.lineHeight ?? 1.4,
    letterSpacing: font?.letterSpacing !== undefined ? `${font.letterSpacing}px` : undefined,
    fontStyle: font?.style ?? "normal",
    textAlign: font?.align,
    textDecorationLine: font?.decoration === "none" ? undefined : font?.decoration,
    textTransform: font?.transform === "none" ? undefined : font?.transform,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    userSelect: "text",
  };

  const fill = style?.fills?.find((paint): paint is Extract<Paint, { type: "solid" }> => paint.type === "solid");
  css.color = fill ? resolveColor(tokens, fill.color) : "#111111";
  if (style?.opacity !== undefined) css.opacity = style.opacity;
  return css;
}

export function layoutToStyle(layout: Layout | undefined): CSSProperties {
  if (!layout || layout.mode !== "flex") return {};
  const css: CSSProperties = {
    display: "flex",
    flexDirection: layout.direction ?? "row",
    alignItems:
      layout.align === "start"
        ? "flex-start"
        : layout.align === "end"
          ? "flex-end"
          : layout.align ?? "stretch",
    justifyContent:
      layout.justify === "start"
        ? "flex-start"
        : layout.justify === "end"
          ? "flex-end"
          : layout.justify ?? "flex-start",
    gap: layout.gap,
    flexWrap: layout.wrap ? "wrap" : "nowrap",
  };
  const padding = paddingToCss(layout.padding);
  if (padding) css.padding = padding;
  return css;
}

/** Geometry, opacity and rotation shared by every node. */
export function baseNodeStyle(node: Node, inFlex: boolean): CSSProperties {
  const style: CSSProperties = {
    position: inFlex ? "relative" : "absolute",
    boxSizing: "border-box",
    width: node.width,
    height: node.height,
    flex: inFlex ? "0 0 auto" : undefined,
    opacity: node.visible === false ? 0 : undefined,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    minWidth: 0,
  };
  if (!inFlex) {
    style.left = node.x;
    style.top = node.y;
  }
  return style;
}

export function getPageBounds(page: PageDocument): PageBounds {
  let maxX = 0;
  let maxY = 0;
  for (const id of page.children) {
    const node = page.nodes[id];
    if (!node) continue;
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return {
    width: Math.max(1, Math.ceil(maxX)),
    height: Math.max(1, Math.ceil(maxY)),
  };
}
