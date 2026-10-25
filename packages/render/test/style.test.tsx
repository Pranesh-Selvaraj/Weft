import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDesign, createNode, insertNode } from "@weft/core";
import { PageView } from "../src/PageView.js";
import {
  getPageBounds,
  layoutToStyle,
  paddingToCss,
  paintsToStyle,
  radiusToCss,
  resolveColor,
} from "../src/style.js";

const tokens = { color: { ink: "#111111", surface: "#ffffff" } };

describe("renderer styles", () => {
  it("resolves token colors and literals", () => {
    expect(resolveColor(tokens, "{color.ink}")).toBe("#111111");
    expect(resolveColor(tokens, "#ff0000")).toBe("#ff0000");
    expect(resolveColor(tokens, "{color.missing}")).toBe("transparent");
  });

  it("converts solid and gradient paints", () => {
    const solid = paintsToStyle([{ type: "solid", color: "{color.surface}" }], tokens);
    expect(solid.backgroundColor).toBe("#ffffff");

    const gradient = paintsToStyle(
      [
        {
          type: "linear-gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "{color.ink}" },
            { offset: 1, color: "{color.surface}" },
          ],
        },
      ],
      tokens,
    );
    expect(gradient.backgroundImage).toBe(
      "linear-gradient(90deg, #111111 0%, #ffffff 100%)",
    );
  });

  it("maps flex layout to CSS", () => {
    expect(
      layoutToStyle({
        mode: "flex",
        direction: "column",
        gap: 16,
        padding: [8, 12],
        align: "center",
        justify: "space-between",
      }),
    ).toMatchObject({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      padding: "8px 12px",
    });
    expect(layoutToStyle({ mode: "absolute" })).toEqual({});
  });

  it("formats radius and padding", () => {
    expect(radiusToCss(12)).toBe("12px");
    expect(radiusToCss([1, 2, 3, 4])).toBe("1px 2px 3px 4px");
    expect(paddingToCss(24)).toBe("24px");
    expect(paddingToCss([8, 12])).toBe("8px 12px");
    expect(paddingToCss([1, 2, 3, 4])).toBe("1px 2px 3px 4px");
  });

  it("computes page bounds", () => {
    const base = createDesign({ name: "Bounds" });
    const node = createNode({ type: "rect", x: 100, y: 50, width: 200, height: 100 });
    const page = insertNode(base.pages[0], node);
    expect(getPageBounds(page)).toEqual({ width: 300, height: 150 });
  });
});

describe("PageView", () => {
  it("renders a frame and real text", () => {
    const design = createDesign({ name: "View", tokens });
    const frame = createNode({
      type: "frame",
      name: "Frame",
      x: 20,
      y: 30,
      width: 400,
      height: 200,
      layout: { mode: "flex", direction: "column", gap: 8, padding: 16 },
      style: { fills: [{ type: "solid", color: "{color.surface}" }], radius: 12 },
    });
    const text = createNode({
      type: "text",
      name: "Heading",
      content: "Hello, Weft",
      width: 320,
      height: 40,
      style: {
        font: { family: "Inter", size: 24, weight: 600 },
        fills: [{ type: "solid", color: "{color.ink}" }],
      },
    });
    let page = insertNode(design.pages[0], frame);
    page = insertNode(page, text, { parentId: frame.id });

    const markup = renderToStaticMarkup(
      <PageView page={page} manifest={design.manifest} />,
    );
    expect(markup).toContain(`data-page-id="${page.id}"`);
    expect(markup).toContain(`data-node-id="${frame.id}"`);
    expect(markup).toContain(`data-node-id="${text.id}"`);
    expect(markup).toContain("Hello, Weft");
    expect(markup).toContain("display:flex");
    expect(markup).toContain("background-color:#ffffff");
    expect(markup).toContain("border-radius:12px");
  });
});
