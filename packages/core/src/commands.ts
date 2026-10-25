import { newId } from "./ids.js";
import {
  duplicateNode,
  getDescendantIds,
  getParentId,
  getSiblingIndex,
  insertNode,
  insertSubtree,
  isContainerNode,
  moveNode,
  removeNode,
  updateNode,
  type NodePatch,
} from "./nodes.js";
import type { DesignFile, Node, PageDocument } from "./types.js";

/**
 * Serializable page mutations. This is the API shared by the editor, the CLI,
 * and agents; every command returns an inverse so the caller can undo it.
 *
 * `node.replace` is intentionally narrow: it exists for undo and whole-node
 * restoration, and it refuses to change a node's type or reorder its children.
 * Structural changes go through insert, move, and remove.
 */
export type PageCommand =
  | { type: "node.insert"; node: Node; parentId: string | null; index?: number }
  | {
      type: "node.insertSubtree";
      nodes: Node[];
      rootId: string;
      parentId: string | null;
      index?: number;
    }
  | { type: "node.update"; nodeId: string; patch: NodePatch }
  | { type: "node.replace"; node: Node }
  | { type: "node.move"; nodeId: string; parentId: string | null; index?: number }
  | { type: "node.remove"; nodeId: string }
  | { type: "node.duplicate"; nodeId: string; parentId?: string | null; index?: number };

export interface CommandActor {
  id: string;
  name?: string;
  kind: "human" | "agent" | "system";
}

export interface CommandRequest {
  pageId: string;
  command: PageCommand;
  actor?: CommandActor;
  id?: string;
  timestamp?: string;
}

export interface CommandEnvelope {
  /** `cm_` ULID, useful for audit logs and attribution. */
  id: string;
  pageId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  actor?: CommandActor;
  command: PageCommand;
}

export class WeftCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WeftCommandError";
    this.code = code;
  }
}

export interface AppliedCommand {
  page: PageDocument;
  inverse: PageCommand;
  createdNodeIds: string[];
}

export interface AppliedDesignCommand extends AppliedCommand {
  design: DesignFile;
}

function commandError(code: string, message: string): WeftCommandError {
  return new WeftCommandError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw commandError("command.type", `${field} must be a JSON object.`);
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw commandError("command.type", `${field} must be a non-empty string.`);
  }
  return value;
}

function readIndex(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw commandError("command.index", `${field} must be a non-negative integer.`);
  }
  return value;
}

function readParent(
  value: unknown,
  field: string,
  fallback: string | null,
): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return readString(value, field);
}

function readNode(value: unknown, field: string): Node {
  const record = readRecord(value, field);
  if (typeof record.id !== "string" || typeof record.type !== "string") {
    throw commandError("command.node", `${field} must be a node with an id and type.`);
  }
  if (
    (record.type === "frame" || record.type === "group") &&
    !Array.isArray(record.children)
  ) {
    throw commandError("command.node", `${field}.children must be an array for a container.`);
  }
  return record as unknown as Node;
}

/**
 * Parse an untrusted command payload. Structural checks happen here; deeper
 * schema validation happens when the resulting design is validated.
 */
export function readPageCommand(input: unknown): PageCommand {
  const value = readRecord(input, "command");
  const type = readString(value.type, "command.type");

  switch (type) {
    case "node.insert": {
      const node = readNode(value.node, "node");
      const parentId = readParent(value.parentId, "parentId", null);
      const index = readIndex(value.index, "index");
      return { type, node, parentId, ...(index === undefined ? {} : { index }) };
    }
    case "node.insertSubtree": {
      if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
        throw commandError("command.nodes", "nodes must be a non-empty array.");
      }
      const nodes = value.nodes.map((node, index) => readNode(node, `nodes[${index}]`));
      const rootId = readString(value.rootId, "rootId");
      const parentId = readParent(value.parentId, "parentId", null);
      const index = readIndex(value.index, "index");
      return {
        type,
        nodes,
        rootId,
        parentId,
        ...(index === undefined ? {} : { index }),
      };
    }
    case "node.update": {
      const nodeId = readString(value.nodeId, "nodeId");
      const patch = readRecord(value.patch, "patch");
      return { type, nodeId, patch: patch as unknown as NodePatch };
    }
    case "node.replace": {
      return { type, node: readNode(value.node, "node") };
    }
    case "node.move": {
      const nodeId = readString(value.nodeId, "nodeId");
      const parentId = readParent(value.parentId, "parentId", null);
      const index = readIndex(value.index, "index");
      return { type, nodeId, parentId, ...(index === undefined ? {} : { index }) };
    }
    case "node.remove": {
      return { type, nodeId: readString(value.nodeId, "nodeId") };
    }
    case "node.duplicate": {
      const nodeId = readString(value.nodeId, "nodeId");
      const hasParent = Object.prototype.hasOwnProperty.call(value, "parentId");
      const parentId = hasParent ? readParent(value.parentId, "parentId", null) : undefined;
      const index = readIndex(value.index, "index");
      return {
        type,
        nodeId,
        ...(hasParent ? { parentId } : {}),
        ...(index === undefined ? {} : { index }),
      };
    }
    default:
      throw commandError("command.type", `Unknown command type ${JSON.stringify(type)}.`);
  }
}

function cloneNode(node: Node): Node {
  return structuredClone(node);
}

function requireNode(page: PageDocument, nodeId: string): Node {
  const node = page.nodes[nodeId];
  if (!node) {
    throw commandError("node.missing", `Node ${nodeId} does not exist on this page.`);
  }
  return node;
}

function sameChildren(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** Apply one command to a page and return the inverse command. */
export function applyPageCommand(page: PageDocument, command: PageCommand): AppliedCommand {
  switch (command.type) {
    case "node.insert": {
      const next = insertNode(page, command.node, {
        parentId: command.parentId,
        index: command.index,
      });
      return {
        page: next,
        inverse: { type: "node.remove", nodeId: command.node.id },
        createdNodeIds: [command.node.id],
      };
    }
    case "node.insertSubtree": {
      const next = insertSubtree(page, command.nodes, command.rootId, {
        parentId: command.parentId,
        index: command.index,
      });
      return {
        page: next,
        inverse: { type: "node.remove", nodeId: command.rootId },
        createdNodeIds: command.nodes.map((node) => node.id),
      };
    }
    case "node.update": {
      const before = requireNode(page, command.nodeId);
      const next = updateNode(page, command.nodeId, command.patch);
      return {
        page: next,
        inverse: { type: "node.replace", node: cloneNode(before) },
        createdNodeIds: [],
      };
    }
    case "node.replace": {
      const before = requireNode(page, command.node.id);
      if (before.type !== command.node.type) {
        throw commandError(
          "replace.type",
          "node.replace cannot change a node's type; remove and insert instead.",
        );
      }
      if (
        isContainerNode(before) &&
        isContainerNode(command.node) &&
        !sameChildren(before.children, command.node.children)
      ) {
        throw commandError(
          "replace.children",
          "node.replace cannot reorder children; use move or insert/remove.",
        );
      }
      const next: PageDocument = {
        ...page,
        nodes: { ...page.nodes, [command.node.id]: cloneNode(command.node) },
      };
      return {
        page: next,
        inverse: { type: "node.replace", node: cloneNode(before) },
        createdNodeIds: [],
      };
    }
    case "node.move": {
      requireNode(page, command.nodeId);
      const parentId = getParentId(page, command.nodeId);
      const index = getSiblingIndex(page, command.nodeId);
      if (index < 0) {
        throw commandError("node.missing", `Node ${command.nodeId} does not exist on this page.`);
      }
      const next = moveNode(page, command.nodeId, command.parentId, command.index);
      return {
        page: next,
        inverse: { type: "node.move", nodeId: command.nodeId, parentId, index },
        createdNodeIds: [],
      };
    }
    case "node.remove": {
      requireNode(page, command.nodeId);
      const parentId = getParentId(page, command.nodeId);
      const index = getSiblingIndex(page, command.nodeId);
      if (index < 0) {
        throw commandError("node.missing", `Node ${command.nodeId} does not exist on this page.`);
      }
      const removedIds = [command.nodeId, ...getDescendantIds(page, command.nodeId)];
      const removedNodes = removedIds.flatMap((id) => {
        const node = page.nodes[id];
        return node ? [cloneNode(node)] : [];
      });
      const next = removeNode(page, command.nodeId);
      return {
        page: next,
        inverse: {
          type: "node.insertSubtree",
          nodes: removedNodes,
          rootId: command.nodeId,
          parentId,
          index,
        },
        createdNodeIds: [],
      };
    }
    case "node.duplicate": {
      const result = duplicateNode(page, command.nodeId, {
        parentId: command.parentId,
        index: command.index,
      });
      return {
        page: result.page,
        inverse: { type: "node.remove", nodeId: result.nodeId },
        createdNodeIds: [result.nodeId],
      };
    }
    default:
      throw commandError("command.type", "Unknown command.");
  }
}

/** Apply a command to one page of a design, preserving the rest of the design. */
export function applyDesignCommand(
  design: DesignFile,
  pageId: string,
  command: PageCommand,
): AppliedDesignCommand {
  const page = design.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw commandError("page.missing", `Page ${pageId} does not exist in this design.`);
  }
  const result = applyPageCommand(page, command);
  return {
    ...result,
    design: {
      manifest: design.manifest,
      pages: design.pages.map((candidate) =>
        candidate.id === pageId ? result.page : candidate,
      ),
    },
  };
}

/** Create an envelope with a fresh command id and timestamp unless supplied. */
export function createCommandEnvelope(request: CommandRequest): CommandEnvelope {
  return {
    id: request.id ?? newId("cm"),
    pageId: request.pageId,
    timestamp: request.timestamp ?? new Date().toISOString(),
    actor: request.actor,
    command: request.command,
  };
}
