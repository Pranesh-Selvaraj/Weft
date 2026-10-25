import {
  listTokenPaths,
  type DesignManifest,
  type PageDocument,
} from "@weft/core";

export interface PageSummary {
  id: string;
  name: string;
  file: string;
  nodeCount: number;
}

export interface DesignSummary {
  id: string;
  name: string;
  pages: PageSummary[];
  pageCount: number;
  nodeCount: number;
  nodeTypes: Record<string, number>;
  tokenCount: number;
  assetCount: number;
  snapshotCount: number;
}

/** Compact, machine-friendly overview of a design for agents and `weft inspect`. */
export function summarizeDesign(
  manifest: DesignManifest,
  pages: PageDocument[],
  pageFiles: string[] = [],
): DesignSummary {
  const fileById = new Map(manifest.pages.map((ref) => [ref.id, ref.file]));
  const nodeTypes: Record<string, number> = {};
  let nodeCount = 0;

  for (const page of pages) {
    for (const node of Object.values(page.nodes)) {
      nodeCount += 1;
      nodeTypes[node.type] = (nodeTypes[node.type] ?? 0) + 1;
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    pages: pages.map((page, index) => ({
      id: page.id,
      name: page.name,
      file: pageFiles[index] ?? fileById.get(page.id) ?? "",
      nodeCount: Object.keys(page.nodes).length,
    })),
    pageCount: pages.length,
    nodeCount,
    nodeTypes,
    tokenCount: listTokenPaths(manifest.tokens).length,
    assetCount: manifest.assets?.length ?? 0,
    snapshotCount: nodeTypes.snapshot ?? 0,
  };
}
