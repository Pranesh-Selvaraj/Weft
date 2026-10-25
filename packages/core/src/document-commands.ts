import { isId } from "./ids.js";
import { WeftCommandError } from "./commands.js";
import type {
  DesignFile,
  PageDocument,
  PageRef,
} from "./types.js";
import { isSafeRelativePath } from "./validate.js";

/**
 * Document-level commands change the design manifest and page list. They are
 * deliberately separate from PageCommand: a page command is applied to one
 * page and written by the bridge, while these commands add/remove whole pages
 * and their files.
 */
export type DocumentCommand =
  | {
      type: "page.create";
      page: PageDocument;
      file: string;
      index?: number;
    }
  | { type: "page.remove"; pageId: string }
  | { type: "page.rename"; pageId: string; name: string }
  | { type: "page.move"; pageId: string; index: number };

export interface AppliedDocumentCommand {
  design: DesignFile;
  inverse: DocumentCommand;
  createdPageIds: string[];
  removedPageIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WeftCommandError("command.type", `${field} must be a non-empty string.`);
  }
  return value;
}

function readIndex(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WeftCommandError("command.index", "page.create.index must be a non-negative integer.");
  }
  return value;
}

/** Parse an untrusted document command. Full page/design validation happens after apply. */
export function readDocumentCommand(input: unknown): DocumentCommand {
  if (!isRecord(input)) {
    throw new WeftCommandError("command.type", "Document command must be a JSON object.");
  }
  const type = readString(input.type, "command.type");
  if (type === "page.create") {
    if (!isRecord(input.page)) {
      throw new WeftCommandError("command.page", "page.create.page must be a page object.");
    }
    const page = input.page as unknown as PageDocument;
    if (typeof page.id !== "string" || !isId(page.id, "pg")) {
      throw new WeftCommandError("command.page", "page.create.page.id must be a pg_ ULID.");
    }
    if (typeof page.name !== "string" || page.name.trim().length === 0) {
      throw new WeftCommandError("command.page", "page.create.page.name must be non-empty.");
    }
    if (typeof input.file !== "string" || !isSafeRelativePath(input.file)) {
      throw new WeftCommandError(
        "command.page",
        "page.create.file must be a safe design-relative path.",
      );
    }
    const index = readIndex(input.index);
    return { type, page, file: input.file, ...(index === undefined ? {} : { index }) };
  }
  if (type === "page.remove") {
    return { type, pageId: readString(input.pageId, "pageId") };
  }
  if (type === "page.rename") {
    const pageId = readString(input.pageId, "pageId");
    const name = readString(input.name, "page.rename.name").trim();
    if (!name) {
      throw new WeftCommandError("command.page", "page.rename.name must not be blank.");
    }
    return { type, pageId, name };
  }
  if (type === "page.move") {
    const pageId = readString(input.pageId, "pageId");
    const index = readIndex(input.index);
    if (index === undefined) {
      throw new WeftCommandError("command.index", "page.move.index is required.");
    }
    return { type, pageId, index };
  }
  throw new WeftCommandError("command.type", `Unknown document command type ${JSON.stringify(type)}.`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Apply one document command. The caller must validate the resulting design
 * before writing it; this function only enforces page-list invariants.
 */
export function applyDocumentCommand(
  design: DesignFile,
  command: DocumentCommand,
): AppliedDocumentCommand {
  switch (command.type) {
    case "page.create": {
      if (design.pages.some((page) => page.id === command.page.id)) {
        throw new WeftCommandError(
          "page.duplicate",
          `Page ${command.page.id} already exists in this design.`,
        );
      }
      if (!isSafeRelativePath(command.file)) {
        throw new WeftCommandError(
          "page.file",
          `Page file ${JSON.stringify(command.file)} must be a safe design-relative path.`,
        );
      }
      if (command.file === "weft.json") {
        throw new WeftCommandError(
          "page.file",
          "A page file cannot replace the design manifest.",
        );
      }
      if (design.manifest.pages.some((ref) => ref.file === command.file)) {
        throw new WeftCommandError(
          "page.file",
          `Page file ${JSON.stringify(command.file)} is already used by another page.`,
        );
      }
      if (design.manifest.pages.some((ref) => ref.id === command.page.id)) {
        throw new WeftCommandError(
          "page.duplicate",
          `Page id ${command.page.id} is already in the manifest.`,
        );
      }
      const index = command.index ?? design.pages.length;
      if (index > design.pages.length) {
        throw new WeftCommandError(
          "page.index",
          `Page index ${index} is beyond the end of the design.`,
        );
      }
      const page = clone(command.page);
      const ref: PageRef = { id: page.id, name: page.name, file: command.file };
      const pages = [...design.pages];
      pages.splice(index, 0, page);
      const manifestPages = [...design.manifest.pages];
      manifestPages.splice(index, 0, ref);
      return {
        design: {
          manifest: { ...design.manifest, pages: manifestPages },
          pages,
        },
        inverse: { type: "page.remove", pageId: page.id },
        createdPageIds: [page.id],
        removedPageIds: [],
      };
    }
    case "page.rename": {
      const pageIndex = design.pages.findIndex((page) => page.id === command.pageId);
      const refIndex = design.manifest.pages.findIndex((page) => page.id === command.pageId);
      if (pageIndex === -1 || refIndex === -1) {
        throw new WeftCommandError("page.missing", `Page ${command.pageId} does not exist.`);
      }
      const name = command.name.trim();
      if (!name) {
        throw new WeftCommandError("command.page", "A page name must not be blank.");
      }
      const oldName = design.pages[pageIndex].name;
      const page = { ...design.pages[pageIndex], name };
      const ref = { ...design.manifest.pages[refIndex], name };
      const pages = [...design.pages];
      pages[pageIndex] = page;
      const manifestPages = [...design.manifest.pages];
      manifestPages[refIndex] = ref;
      return {
        design: {
          manifest: { ...design.manifest, pages: manifestPages },
          pages,
        },
        inverse: { type: "page.rename", pageId: command.pageId, name: oldName },
        createdPageIds: [],
        removedPageIds: [],
      };
    }
    case "page.move": {
      const pageIndex = design.pages.findIndex((page) => page.id === command.pageId);
      const refIndex = design.manifest.pages.findIndex((page) => page.id === command.pageId);
      if (pageIndex === -1 || refIndex === -1) {
        throw new WeftCommandError("page.missing", `Page ${command.pageId} does not exist.`);
      }
      if (command.index >= design.pages.length) {
        throw new WeftCommandError(
          "page.index",
          `Page index ${command.index} is beyond the end of the design.`,
        );
      }
      const pages = [...design.pages];
      const [page] = pages.splice(pageIndex, 1);
      pages.splice(command.index, 0, page);
      const manifestPages = [...design.manifest.pages];
      const [ref] = manifestPages.splice(refIndex, 1);
      manifestPages.splice(command.index, 0, ref);
      return {
        design: {
          manifest: { ...design.manifest, pages: manifestPages },
          pages,
        },
        inverse: { type: "page.move", pageId: command.pageId, index: pageIndex },
        createdPageIds: [],
        removedPageIds: [],
      };
    }
    case "page.remove": {
      const index = design.pages.findIndex((page) => page.id === command.pageId);
      if (index === -1) {
        throw new WeftCommandError("page.missing", `Page ${command.pageId} does not exist.`);
      }
      if (design.pages.length === 1) {
        throw new WeftCommandError("page.last", "A design must contain at least one page.");
      }
      const refIndex = design.manifest.pages.findIndex((ref) => ref.id === command.pageId);
      const ref = design.manifest.pages[refIndex];
      if (!ref) {
        throw new WeftCommandError(
          "page.missing",
          `Page ${command.pageId} is not listed in the manifest.`,
        );
      }
      const page = design.pages[index];
      return {
        design: {
          manifest: {
            ...design.manifest,
            pages: design.manifest.pages.filter((entry) => entry.id !== command.pageId),
          },
          pages: design.pages.filter((entry) => entry.id !== command.pageId),
        },
        inverse: {
          type: "page.create",
          page: clone(page),
          file: ref.file,
          index,
        },
        createdPageIds: [],
        removedPageIds: [page.id],
      };
    }
  }
}
