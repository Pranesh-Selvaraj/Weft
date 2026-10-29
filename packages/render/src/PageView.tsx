import type { CSSProperties, ReactNode } from "react";
import {
  isContainerNode,
  type DesignManifest,
  type ImageNode,
  type PageDocument,
  type SnapshotNode,
  type TextNode,
} from "@weft/core";
import {
  backgroundStyle,
  baseNodeStyle,
  getPageBounds,
  layoutToStyle,
  surfaceStyle,
  textStyle,
  type AssetUrlResolver,
} from "./style.js";

export interface SnapshotPayload {
  html: string;
  css?: string;
}

export interface PageViewProps {
  page: PageDocument;
  manifest: DesignManifest;
  /** Override the computed surface size. */
  width?: number;
  height?: number;
  /** Resolve asset ids to browser URLs. Without it, images render as placeholders. */
  assetUrl?: AssetUrlResolver;
  /** Render the page background. The editor renders it as a full workspace backdrop instead. */
  showBackground?: boolean;
  /** Snapshot payloads keyed by node id. Without one, a snapshot renders as a placeholder. */
  snapshotPayloads?: Record<string, SnapshotPayload>;
  className?: string;
}

const PLACEHOLDER_FONT = "Inter, system-ui, -apple-system, sans-serif";

/**
 * Read-only DOM renderer for one page. Geometry is absolute per frame, flex is
 * mapped to CSS flex, and text stays real text. This is the same renderer the
 * editor and export will use; capture payloads render in a sandboxed iframe.
 */
export function PageView({
  page,
  manifest,
  width,
  height,
  assetUrl,
  snapshotPayloads,
  className,
  showBackground = true,
}: PageViewProps) {
  const tokens = manifest.tokens;
  const bounds = getPageBounds(page);
  const pageWidth = width ?? bounds.width;
  const pageHeight = height ?? bounds.height;
  const pageBackground = showBackground
    ? page.background
      ? backgroundStyle(page.background, tokens, assetUrl)
      : { backgroundColor: "#ffffff" }
    : {};

  const renderNode = (
    id: string,
    inFlex: boolean,
    ancestors: Set<string>,
  ): ReactNode => {
    const node = page.nodes[id];
    if (!node || node.visible === false) return null;
    if (ancestors.has(id)) return null;
    const visited = new Set(ancestors).add(id);

    const base = baseNodeStyle(node, inFlex);
    const data = { "data-node-id": id, "data-node-type": node.type } as const;

    if (isContainerNode(node)) {
      const flex = node.layout?.mode === "flex";
      const style: CSSProperties = {
        ...base,
        ...layoutToStyle(node.layout),
        ...surfaceStyle(node.style, tokens, assetUrl),
        overflow: node.type === "frame" && node.clip ? "hidden" : "visible",
      };
      return (
        <div key={id} {...data} style={style}>
          {node.children.map((childId) => renderNode(childId, flex, visited))}
        </div>
      );
    }

    switch (node.type) {
      case "text": {
        const text = node as TextNode;
        const style: CSSProperties = {
          ...base,
          ...textStyle(text.style?.font, text.style, tokens),
        };
        return (
          <div key={id} {...data} style={style}>
            {text.content}
          </div>
        );
      }
      case "rect": {
        return (
          <div
            key={id}
            {...data}
            style={{
              ...base,
              ...surfaceStyle(node.style, tokens, assetUrl),
            }}
          />
        );
      }
      case "ellipse": {
        return (
          <div
            key={id}
            {...data}
            style={{
              ...base,
              ...surfaceStyle(node.style, tokens, assetUrl),
              borderRadius: "50%",
            }}
          />
        );
      }
      case "image": {
        const image = node as ImageNode;
        const url = assetUrl?.(image.asset);
        const style: CSSProperties = {
          ...base,
          backgroundColor: "#E7E2D7",
          ...surfaceStyle(node.style, tokens, assetUrl),
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        };
        return (
          <div key={id} {...data} style={style}>
            {url ? (
              <img
                src={url}
                alt={image.alt ?? ""}
                draggable={false}
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  objectFit: image.fit ?? "cover",
                }}
              />
            ) : (
              <span
                style={{
                  fontFamily: PLACEHOLDER_FONT,
                  fontSize: 12,
                  color: "#6B665C",
                  padding: 8,
                  textAlign: "center",
                }}
              >
                image · {image.asset}
              </span>
            )}
          </div>
        );
      }
      case "snapshot": {
        const snapshot = node as SnapshotNode;
        const payload = snapshotPayloads?.[id];
        const style: CSSProperties = {
          ...base,
          ...surfaceStyle(node.style, tokens, assetUrl),
          overflow: "hidden",
          backgroundColor: "#FBFAF6",
        };
        const safeCss = (payload?.css ?? "").replace(/<\/style/gi, "<\\/style");
        return (
          <div key={id} {...data} style={style}>
            {payload ? (
              <iframe
                title={`Snapshot ${id}`}
                sandbox=""
                srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>${safeCss}</style></head><body>${payload.html}</body></html>`}
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  border: 0,
                  pointerEvents: "none",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                  border: "1px dashed #C9C3B8",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontFamily: PLACEHOLDER_FONT,
                  color: "#6B665C",
                  fontSize: 12,
                  padding: 16,
                  textAlign: "center",
                }}
              >
                <span>captured page · {snapshot.source.viewport.width}×{snapshot.source.viewport.height}</span>
                <span style={{ opacity: 0.7 }}>{snapshot.source.url}</span>
              </div>
            )}
          </div>
        );
      }
      default: {
        return null;
      }
    }
  };

  return (
    <div
      className={className}
      data-page-id={page.id}
      style={{
        position: "relative",
        width: pageWidth,
        height: pageHeight,
        overflow: "hidden",
        boxSizing: "border-box",
        ...pageBackground,
      }}
    >
      {page.children.map((id) => renderNode(id, false, new Set()))}
    </div>
  );
}
