import {
  createDesign,
  createNode,
  insertNode,
  type DesignFile,
  type Node,
  type PageDocument,
} from "../src/index.js";

export interface BuiltDesign {
  design: DesignFile;
  page: PageDocument;
  ids: {
    frame: string;
    title: string;
    body: string;
  };
}

/** A small valid design used across the test suite. */
export function buildDesign(): BuiltDesign {
  const design = createDesign({
    name: "Test design",
    tokens: {
      color: {
        surface: "#ffffff",
        ink: "#111111",
        muted: "#666666",
        accent: "#3355ff",
        "accent-ink": "#ffffff",
      },
      space: { md: 16 },
    },
  });

  const basePage = design.pages[0];
  const frame = createNode({
    type: "frame",
    name: "Card",
    x: 12,
    y: 24,
    width: 400,
    height: 300,
    layout: { mode: "flex", direction: "column", gap: 16, padding: 24 },
    style: {
      fills: [{ type: "solid", color: "{color.surface}" }],
      strokes: [{ type: "solid", color: "#00000014" }],
      strokeWidth: 1,
      radius: 12,
    },
  });
  const title = createNode({
    type: "text",
    name: "Title",
    x: 0,
    y: 0,
    width: 200,
    height: 32,
    content: "Hello, Weft",
    style: {
      font: { family: "Inter", size: 24, weight: 600, lineHeight: 1.2 },
      fills: [{ type: "solid", color: "{color.ink}" }],
    },
  });
  const body = createNode({
    type: "text",
    name: "Body",
    x: 0,
    y: 48,
    width: 320,
    height: 48,
    content: "A design file agents can read.",
    style: {
      font: { family: "Inter", size: 16, lineHeight: 1.5 },
      fills: [{ type: "solid", color: "{color.muted}" }],
    },
  });

  let page = insertNode(basePage, frame);
  page = insertNode(page, title, { parentId: frame.id, index: 0 });
  page = insertNode(page, body, { parentId: frame.id, index: 1 });

  return {
    design: { manifest: design.manifest, pages: [page] },
    page,
    ids: { frame: frame.id, title: title.id, body: body.id },
  };
}

/** Insert an arbitrary node at the page root and return the new page. */
export function withRootNode(page: PageDocument, node: Node): PageDocument {
  return insertNode(page, node, { index: page.children.length });
}
