import { isId, newId } from "./ids.js";
import { WeftOperationError } from "./nodes.js";
import {
  WEFT_FORMAT,
  WEFT_FORMAT_VERSION,
  WEFT_PAGE_FORMAT,
  WEFT_PAGE_FORMAT_VERSION,
  type DesignFile,
  type DesignManifest,
  type JsonObject,
  type PageDocument,
  type PageRef,
  type Paint,
  type TokenTree,
} from "./types.js";

export interface CreatePageInput {
  name?: string;
  id?: string;
  background?: Paint | null;
}

/** Create an empty page. Pages are added to a design with `addPage`. */
export function createPage(input: CreatePageInput = {}): PageDocument {
  const name = input.name?.trim() || "Page 1";
  const id = input.id ?? newId("pg");
  if (!isId(id, "pg")) {
    throw new WeftOperationError("id.invalid", "Page id must be a pg_ ULID.");
  }
  const page: PageDocument = {
    format: WEFT_PAGE_FORMAT,
    version: WEFT_PAGE_FORMAT_VERSION,
    id,
    name,
    nodes: {},
    children: [],
  };
  if (input.background !== undefined) {
    page.background = input.background === null ? null : structuredClone(input.background);
  }
  return page;
}

/** Turn a human name into a stable-looking file slug. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "page";
}

function uniquePageFile(manifest: DesignManifest, name: string): string {
  const used = new Set(manifest.pages.map((page) => page.file));
  const base = slugify(name);
  let candidate = `pages/${base}.json`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `pages/${base}-${suffix}.json`;
    suffix += 1;
  }
  return candidate;
}

export interface CreateDesignInput {
  name?: string;
  pageName?: string;
  tokens?: TokenTree;
}

/** Create a design with one empty page. Nothing is written to disk here. */
export function createDesign(input: CreateDesignInput = {}): DesignFile {
  const page = createPage({ name: input.pageName ?? "Page 1" });
  const manifest: DesignManifest = {
    format: WEFT_FORMAT,
    version: WEFT_FORMAT_VERSION,
    id: newId("ds"),
    name: input.name?.trim() || "Untitled design",
    pages: [{ id: page.id, name: page.name, file: `pages/${slugify(page.name)}.json` }],
  };
  if (input.tokens !== undefined) manifest.tokens = structuredClone(input.tokens);
  return { manifest, pages: [page] };
}

export interface AddPageResult {
  design: DesignFile;
  page: PageDocument;
}

/** Append a new page and register it in the manifest. */
export function addPage(design: DesignFile, name: string): AddPageResult {
  const page = createPage({ name });
  const ref: PageRef = {
    id: page.id,
    name: page.name,
    file: uniquePageFile(design.manifest, page.name),
  };
  const next: DesignFile = {
    manifest: { ...design.manifest, pages: [...design.manifest.pages, ref] },
    pages: [...design.pages, page],
  };
  return { design: next, page };
}

/** Find a page by id or exact name. */
export function getPage(design: DesignFile, idOrName: string): PageDocument | undefined {
  return design.pages.find((page) => page.id === idOrName || page.name === idOrName);
}

export function getPageRef(
  manifest: DesignManifest,
  pageId: string,
): PageRef | undefined {
  return manifest.pages.find((page) => page.id === pageId);
}

/** Remove a page and its manifest entry. A design must keep at least one page. */
export function removePage(design: DesignFile, pageId: string): DesignFile {
  if (!design.pages.some((page) => page.id === pageId)) {
    throw new WeftOperationError("page.missing", `Page ${pageId} does not exist.`);
  }
  if (design.pages.length === 1) {
    throw new WeftOperationError("page.last", "A design must contain at least one page.");
  }
  return {
    manifest: {
      ...design.manifest,
      pages: design.manifest.pages.filter((page) => page.id !== pageId),
    },
    pages: design.pages.filter((page) => page.id !== pageId),
  };
}

export interface UpdatePagePatch {
  name?: string;
  background?: Paint | null;
  meta?: JsonObject | null;
}

/**
 * Update page-level fields and keep the manifest in sync. Renaming a page does
 * not move its file; the path is part of the document's history.
 */
export function updatePage(
  design: DesignFile,
  pageId: string,
  patch: UpdatePagePatch,
): DesignFile {
  const page = design.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new WeftOperationError("page.missing", `Page ${pageId} does not exist.`);
  }

  const nextPage: PageDocument = { ...page };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) {
      throw new WeftOperationError("value.invalid", "Page name must not be empty.");
    }
    nextPage.name = name;
  }
  if (patch.background !== undefined) {
    nextPage.background = patch.background === null ? null : structuredClone(patch.background);
  }
  if (patch.meta !== undefined) {
    if (patch.meta === null) delete nextPage.meta;
    else nextPage.meta = structuredClone(patch.meta);
  }

  return {
    manifest: {
      ...design.manifest,
      pages: design.manifest.pages.map((ref) =>
        ref.id === pageId && patch.name !== undefined ? { ...ref, name: nextPage.name } : ref,
      ),
    },
    pages: design.pages.map((candidate) => (candidate.id === pageId ? nextPage : candidate)),
  };
}
