import { isId, newId } from "./ids.js";
import {
  type BaseNode,
  type ContainerNode,
  type FrameNode,
  type ImageFit,
  type ImageNode,
  type JsonObject,
  type Layout,
  type Node,
  type NodeType,
  type PageDocument,
  type SnapshotFiles,
  type SnapshotSource,
  type Style,
} from "./types.js";

export class WeftOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WeftOperationError";
    this.code = code;
  }
}

const CONTAINER_TYPES = new Set<NodeType>(["frame", "group"]);
const NODE_TYPES = new Set<NodeType>([
  "frame",
  "group",
  "text",
  "rect",
  "ellipse",
  "image",
  "snapshot",
]);
const IMAGE_FITS = new Set<ImageFit>(["cover", "contain", "fill", "none"]);

const DEFAULT_NAMES: Record<NodeType, string> = {
  frame: "Frame",
  group: "Group",
  text: "Text",
  rect: "Rectangle",
  ellipse: "Ellipse",
  image: "Image",
  snapshot: "Snapshot",
};

const DEFAULT_SIZES: Record<NodeType, { width: number; height: number }> = {
  frame: { width: 800, height: 600 },
  group: { width: 0, height: 0 },
  text: { width: 320, height: 24 },
  rect: { width: 200, height: 120 },
  ellipse: { width: 120, height: 120 },
  image: { width: 320, height: 200 },
  snapshot: { width: 1440, height: 900 },
};

export interface CreateNodeInput {
  type: NodeType;
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  locked?: boolean;
  layout?: Layout;
  style?: Style;
  meta?: JsonObject;
  children?: string[];
  clip?: boolean;
  content?: string;
  asset?: string;
  fit?: ImageFit;
  alt?: string;
  source?: SnapshotSource;
  files?: SnapshotFiles;
}

function assertNumber(value: number, label: string, min?: number): void {
  if (!Number.isFinite(value)) {
    throw new WeftOperationError("value.invalid", `${label} must be a finite number.`);
  }
  if (min !== undefined && value < min) {
    throw new WeftOperationError("value.invalid", `${label} must be >= ${min}.`);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setOptional<T extends object>(target: T, key: keyof T & string, value: unknown): void {
  if (value !== undefined) {
    (target as unknown as Record<string, unknown>)[key] = value;
  }
}

/**
 * Create a node. Geometry defaults are type-specific so a new frame is large
 * enough to see and a new text node has a sensible line box. The returned node
 * is not on a page yet; use `insertNode` or `insertSubtree`.
 */
export function createNode(input: CreateNodeInput): Node {
  if (!NODE_TYPES.has(input.type)) {
    throw new WeftOperationError("node.type", `Unknown node type ${JSON.stringify(input.type)}.`);
  }
  const id = input.id ?? newId("nd");
  if (!isId(id, "nd")) {
    throw new WeftOperationError("id.invalid", "Node id must be an nd_ ULID.");
  }

  const size = DEFAULT_SIZES[input.type];
  const x = input.x ?? 0;
  const y = input.y ?? 0;
  const width = input.width ?? size.width;
  const height = input.height ?? size.height;
  assertNumber(x, "x");
  assertNumber(y, "y");
  assertNumber(width, "width", 0);
  assertNumber(height, "height", 0);

  const name = input.name ?? DEFAULT_NAMES[input.type];
  if (name.trim().length === 0) {
    throw new WeftOperationError("value.invalid", "Node name must not be empty.");
  }

  const base: BaseNode = { id, type: input.type, name, x, y, width, height };
  setOptional(base, "rotation", input.rotation);
  setOptional(base, "visible", input.visible);
  setOptional(base, "locked", input.locked);
  setOptional(base, "layout", input.layout === undefined ? undefined : clone(input.layout));
  setOptional(base, "style", input.style === undefined ? undefined : clone(input.style));
  setOptional(base, "meta", input.meta === undefined ? undefined : clone(input.meta));

  switch (input.type) {
    case "frame": {
      const frame: FrameNode = {
        ...base,
        type: "frame",
        children: input.children ? [...input.children] : [],
      };
      if (input.clip !== undefined) frame.clip = input.clip;
      return frame;
    }
    case "group": {
      return { ...base, type: "group", children: input.children ? [...input.children] : [] };
    }
    case "text": {
      return { ...base, type: "text", content: input.content ?? "" };
    }
    case "rect": {
      return { ...base, type: "rect" };
    }
    case "ellipse": {
      return { ...base, type: "ellipse" };
    }
    case "image": {
      if (!input.asset) {
        throw new WeftOperationError("image.asset", "An image node requires an asset id.");
      }
      if (!isId(input.asset, "as")) {
        throw new WeftOperationError("id.invalid", "Image asset must be an as_ ULID.");
      }
      if (input.fit !== undefined && !IMAGE_FITS.has(input.fit)) {
        throw new WeftOperationError("image.fit", `Unknown image fit ${JSON.stringify(input.fit)}.`);
      }
      const image: ImageNode = { ...base, type: "image", asset: input.asset };
      if (input.fit !== undefined) image.fit = input.fit;
      if (input.alt !== undefined) image.alt = input.alt;
      return image;
    }
    case "snapshot": {
      if (!input.source || !input.files) {
        throw new WeftOperationError(
          "snapshot.source",
          "A snapshot node requires source metadata and snapshot file paths.",
        );
      }
      return {
        ...base,
        type: "snapshot",
        source: clone(input.source),
        files: clone(input.files),
      };
    }
    default: {
      throw new WeftOperationError("node.type", `Unknown node type ${JSON.stringify(input.type)}.`);
    }
  }
}

/** Whether a node can contain children. */
export function isContainerNode(node: Node): node is ContainerNode {
  return CONTAINER_TYPES.has(node.type);
}

export function getNode(page: PageDocument, nodeId: string): Node | undefined {
  return page.nodes[nodeId];
}

function requireNode(page: PageDocument, nodeId: string): Node {
  const node = page.nodes[nodeId];
  if (!node) {
    throw new WeftOperationError("node.missing", `Node ${nodeId} does not exist on this page.`);
  }
  return node;
}

/**
 * Build a child -> parent map. A node with two parents keeps the first one it
 * is found under; the validator reports the inconsistency separately.
 */
export function buildParentIndex(page: PageDocument): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const id of page.children) {
    if (!parents.has(id)) parents.set(id, null);
  }
  for (const [id, node] of Object.entries(page.nodes)) {
    if (!isContainerNode(node)) continue;
    for (const child of node.children) {
      if (!parents.has(child)) parents.set(child, id);
    }
  }
  return parents;
}

export function getParentId(page: PageDocument, nodeId: string): string | null {
  return buildParentIndex(page).get(nodeId) ?? null;
}

export function getChildren(page: PageDocument, nodeId: string | null): Node[] {
  const ids = nodeId === null ? page.children : (() => {
    const node = page.nodes[nodeId];
    return node && isContainerNode(node) ? node.children : [];
  })();
  return ids.flatMap((id) => {
    const node = page.nodes[id];
    return node ? [node] : [];
  });
}

export function getSiblingIndex(page: PageDocument, nodeId: string): number {
  const parentId = getParentId(page, nodeId);
  const siblings = parentId === null
    ? page.children
    : (page.nodes[parentId] && isContainerNode(page.nodes[parentId])
        ? (page.nodes[parentId] as ContainerNode).children
        : []);
  return siblings.indexOf(nodeId);
}

export function getAncestorIds(page: PageDocument, nodeId: string): string[] {
  const parents = buildParentIndex(page);
  const ancestors: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = parents.get(nodeId) ?? null;
  while (current !== null && !seen.has(current)) {
    ancestors.push(current);
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return ancestors;
}

export function getDescendantIds(page: PageDocument, nodeId: string): string[] {
  const descendants: string[] = [];
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const node = page.nodes[current];
    if (!node || !isContainerNode(node)) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (seen.has(child)) continue;
      seen.add(child);
      descendants.push(child);
      stack.push(child);
    }
  }
  return descendants;
}

/** Walk every node reachable from the page root, in depth-first paint order. */
export function* walkNodes(page: PageDocument): Generator<Node> {
  const seen = new Set<string>();
  const stack = [...page.children].reverse();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const node = page.nodes[id];
    if (!node) continue;
    yield node;
    if (isContainerNode(node)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]);
      }
    }
  }
}

/** Walk every node in the map, including any that are not reachable from the root. */
export function* walkAllNodes(page: PageDocument): Generator<Node> {
  for (const node of Object.values(page.nodes)) yield node;
}

export function findNodes(page: PageDocument, predicate: (node: Node) => boolean): Node[] {
  return [...walkAllNodes(page)].filter(predicate);
}

function copyPage(page: PageDocument): PageDocument {
  return { ...page, nodes: { ...page.nodes }, children: [...page.children] };
}

function cloneNode<T extends Node>(node: T): T {
  return clone(node);
}

export interface InsertOptions {
  /** `null` or omitted inserts at the page root. */
  parentId?: string | null;
  /** Position in the destination after any required removal. Default: append. */
  index?: number;
}

function resolveDestination(
  page: PageDocument,
  parentId: string | null | undefined,
): { children: string[]; owner: string | null } {
  if (parentId === null || parentId === undefined) {
    return { children: page.children, owner: null };
  }
  const parent = page.nodes[parentId];
  if (!parent) {
    throw new WeftOperationError("node.missing", `Parent node ${parentId} does not exist.`);
  }
  if (!isContainerNode(parent)) {
    throw new WeftOperationError(
      "node.parent",
      `Node ${parentId} (${parent.type}) cannot contain children.`,
    );
  }
  return { children: parent.children, owner: parentId };
}

function checkIndex(index: number | undefined, length: number): number {
  const position = index ?? length;
  if (!Number.isInteger(position) || position < 0 || position > length) {
    throw new WeftOperationError(
      "index.range",
      `Index must be an integer between 0 and ${length}, received ${String(index)}.`,
    );
  }
  return position;
}

/**
 * Insert a complete subtree. Every child id referenced by the incoming nodes
 * must be part of the insertion; use `moveNode` to adopt an existing node.
 */
export function insertSubtree(
  page: PageDocument,
  nodes: Node[],
  rootId: string,
  options: InsertOptions = {},
): PageDocument {
  if (nodes.length === 0) {
    throw new WeftOperationError("subtree.empty", "A subtree must contain at least one node.");
  }
  const incoming = new Map<string, Node>();
  for (const node of nodes) {
    if (!isId(node.id, "nd")) {
      throw new WeftOperationError("id.invalid", `Invalid node id ${JSON.stringify(node.id)}.`);
    }
    if (incoming.has(node.id)) {
      throw new WeftOperationError("subtree.duplicate", `Duplicate node id ${node.id} in the subtree.`);
    }
    if (page.nodes[node.id]) {
      throw new WeftOperationError("node.exists", `Node ${node.id} already exists on this page.`);
    }
    incoming.set(node.id, node);
  }
  if (!incoming.has(rootId)) {
    throw new WeftOperationError("subtree.root", `Root node ${rootId} is not part of the subtree.`);
  }

  for (const node of incoming.values()) {
    if (!isContainerNode(node)) continue;
    for (const childId of node.children) {
      if (incoming.has(childId)) continue;
      if (page.nodes[childId]) {
        throw new WeftOperationError(
          "subtree.external",
          `Node ${node.id} references existing node ${childId}; move it instead of re-inserting it.`,
        );
      }
      throw new WeftOperationError(
        "subtree.dangling",
        `Node ${node.id} references missing node ${childId}.`,
      );
    }
  }

  const childOwners = new Map<string, string>();
  for (const node of incoming.values()) {
    if (!isContainerNode(node)) continue;
    const seenChildren = new Set<string>();
    for (const childId of node.children) {
      if (seenChildren.has(childId)) {
        throw new WeftOperationError(
          "subtree.duplicate-child",
          `Node ${node.id} lists child ${childId} more than once.`,
        );
      }
      seenChildren.add(childId);
      const owner = childOwners.get(childId);
      if (owner !== undefined && owner !== node.id) {
        throw new WeftOperationError(
          "subtree.multi-parent",
          `Node ${childId} is a child of both ${owner} and ${node.id}.`,
        );
      }
      childOwners.set(childId, node.id);
    }
  }

  const visiting = new Set<string>();
  const finished = new Set<string>();
  const checkCycle = (id: string): void => {
    if (finished.has(id)) return;
    if (visiting.has(id)) {
      throw new WeftOperationError("subtree.cycle", `Subtree contains a cycle at node ${id}.`);
    }
    visiting.add(id);
    const node = incoming.get(id);
    if (node && isContainerNode(node)) {
      for (const childId of node.children) checkCycle(childId);
    }
    visiting.delete(id);
    finished.add(id);
  };
  checkCycle(rootId);

  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const node = incoming.get(id);
    if (!node || !isContainerNode(node)) return;
    for (const childId of node.children) visit(childId);
  };
  visit(rootId);
  for (const id of incoming.keys()) {
    if (!reachable.has(id)) {
      throw new WeftOperationError(
        "subtree.orphan",
        `Node ${id} is part of the subtree but is not reachable from root ${rootId}.`,
      );
    }
  }

  const destination = resolveDestination(page, options.parentId);
  const position = checkIndex(options.index, destination.children.length);

  const next = copyPage(page);
  for (const node of incoming.values()) {
    next.nodes[node.id] = cloneNode(node);
  }
  if (destination.owner === null) {
    next.children.splice(position, 0, rootId);
  } else {
    const parent = next.nodes[destination.owner];
    if (!parent || !isContainerNode(parent)) {
      throw new WeftOperationError("node.parent", `Parent node ${destination.owner} is not a container.`);
    }
    const clonedParent = cloneNode(parent);
    clonedParent.children.splice(position, 0, rootId);
    next.nodes[destination.owner] = clonedParent;
  }
  return next;
}

/** Insert a single node. A subtree must use `insertSubtree`. */
export function insertNode(
  page: PageDocument,
  node: Node,
  options: InsertOptions = {},
): PageDocument {
  if (isContainerNode(node) && node.children.length > 0) {
    throw new WeftOperationError(
      "subtree.required",
      "insertNode cannot insert a node with children; use insertSubtree.",
    );
  }
  return insertSubtree(page, [node], node.id, options);
}

/** Move a node within the tree, keeping its geometry. */
export function moveNode(
  page: PageDocument,
  nodeId: string,
  newParentId: string | null,
  index?: number,
): PageDocument {
  requireNode(page, nodeId);
  if (newParentId === nodeId) {
    throw new WeftOperationError("node.cycle", "A node cannot be its own parent.");
  }
  if (newParentId !== null) {
    requireNode(page, newParentId);
    if (getDescendantIds(page, nodeId).includes(newParentId)) {
      throw new WeftOperationError("node.cycle", "A node cannot be moved inside its own descendant.");
    }
  }

  const oldParentId = getParentId(page, nodeId);
  const next = copyPage(page);

  const detach = (): void => {
    if (oldParentId === null) {
      next.children = next.children.filter((id) => id !== nodeId);
      return;
    }
    const parent = next.nodes[oldParentId];
    if (!parent || !isContainerNode(parent)) return;
    const cloned = cloneNode(parent);
    cloned.children = cloned.children.filter((id) => id !== nodeId);
    next.nodes[oldParentId] = cloned;
  };
  detach();

  let destination: string[];
  if (newParentId === null) {
    destination = next.children;
  } else if (newParentId === oldParentId) {
    const parent = next.nodes[newParentId];
    if (!parent || !isContainerNode(parent)) {
      throw new WeftOperationError("node.parent", `Parent node ${newParentId} is not a container.`);
    }
    destination = parent.children;
  } else {
    const parent = next.nodes[newParentId];
    if (!parent || !isContainerNode(parent)) {
      throw new WeftOperationError("node.parent", `Parent node ${newParentId} is not a container.`);
    }
    const cloned = cloneNode(parent);
    next.nodes[newParentId] = cloned;
    destination = cloned.children;
  }

  const position = checkIndex(index, destination.length);
  destination.splice(position, 0, nodeId);
  return next;
}

export function reorderNode(page: PageDocument, nodeId: string, index: number): PageDocument {
  return moveNode(page, nodeId, getParentId(page, nodeId), index);
}

/** Remove a node and its whole subtree. */
export function removeNode(page: PageDocument, nodeId: string): PageDocument {
  requireNode(page, nodeId);
  const parentId = getParentId(page, nodeId);
  const next = copyPage(page);

  if (parentId === null) {
    next.children = next.children.filter((id) => id !== nodeId);
  } else {
    const parent = next.nodes[parentId];
    if (parent && isContainerNode(parent)) {
      const cloned = cloneNode(parent);
      cloned.children = cloned.children.filter((id) => id !== nodeId);
      next.nodes[parentId] = cloned;
    }
  }

  delete next.nodes[nodeId];
  for (const descendantId of getDescendantIds(page, nodeId)) {
    delete next.nodes[descendantId];
  }
  return next;
}

export interface DuplicateOptions {
  /** Defaults to the original parent. */
  parentId?: string | null;
  /** Defaults to immediately after the original when the parent is unchanged. */
  index?: number;
}

export interface DuplicateResult {
  page: PageDocument;
  nodeId: string;
}

/** Deep-copy a subtree with fresh ids and insert it next to the original. */
export function duplicateNode(
  page: PageDocument,
  nodeId: string,
  options: DuplicateOptions = {},
): DuplicateResult {
  const original = requireNode(page, nodeId);
  const ids = [nodeId, ...getDescendantIds(page, nodeId)];
  const idMap = new Map<string, string>();
  for (const id of ids) idMap.set(id, newId("nd"));

  const copies: Node[] = ids.map((id) => {
    const node = requireNode(page, id);
    const copy = cloneNode(node);
    copy.id = idMap.get(id) as string;
    if (isContainerNode(copy) && isContainerNode(node)) {
      copy.children = node.children.map((childId) => idMap.get(childId) as string);
    }
    if (id === nodeId) copy.name = `${original.name} copy`;
    return copy;
  });

  const oldParentId = getParentId(page, nodeId);
  const parentId = options.parentId === undefined ? oldParentId : options.parentId;
  const index = options.index === undefined
    ? (parentId === oldParentId ? getSiblingIndex(page, nodeId) + 1 : undefined)
    : options.index;

  const next = insertSubtree(page, copies, idMap.get(nodeId) as string, { parentId, index });
  return { page: next, nodeId: idMap.get(nodeId) as string };
}

export interface NodePatch {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number | null;
  visible?: boolean;
  locked?: boolean;
  layout?: Layout | null;
  /** Shallow merge: nested objects such as `font` are replaced when provided. */
  style?: Partial<Style> | null;
  meta?: JsonObject | null;
  clip?: boolean;
  content?: string;
  asset?: string;
  fit?: ImageFit;
  alt?: string | null;
  source?: SnapshotSource;
  files?: SnapshotFiles;
}

const PATCH_KEYS = new Set<string>([
  "name",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "visible",
  "locked",
  "layout",
  "style",
  "meta",
  "clip",
  "content",
  "asset",
  "fit",
  "alt",
  "source",
  "files",
]);

/**
 * Update a node in place (returning a new page). A style patch is merged one
 * level deep; layout, meta, source, and files are replaced when provided;
 * `null` removes an optional field.
 */
export function updateNode(
  page: PageDocument,
  nodeId: string,
  patch: NodePatch,
): PageDocument {
  const node = requireNode(page, nodeId);

  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.has(key)) {
      throw new WeftOperationError("patch.unknown", `Unknown node patch field ${JSON.stringify(key)}.`);
    }
  }

  const next = copyPage(page);
  const updated = cloneNode(node);

  if (patch.name !== undefined) {
    if (patch.name.trim().length === 0) {
      throw new WeftOperationError("value.invalid", "Node name must not be empty.");
    }
    updated.name = patch.name;
  }
  if (patch.x !== undefined) {
    assertNumber(patch.x, "x");
    updated.x = patch.x;
  }
  if (patch.y !== undefined) {
    assertNumber(patch.y, "y");
    updated.y = patch.y;
  }
  if (patch.width !== undefined) {
    assertNumber(patch.width, "width", 0);
    updated.width = patch.width;
  }
  if (patch.height !== undefined) {
    assertNumber(patch.height, "height", 0);
    updated.height = patch.height;
  }
  if (patch.rotation !== undefined) {
    if (patch.rotation === null) {
      delete updated.rotation;
    } else {
      assertNumber(patch.rotation, "rotation");
      updated.rotation = patch.rotation;
    }
  }
  if (patch.visible !== undefined) updated.visible = patch.visible;
  if (patch.locked !== undefined) updated.locked = patch.locked;
  if (patch.layout !== undefined) {
    if (patch.layout === null) {
      delete updated.layout;
    } else {
      updated.layout = clone(patch.layout);
    }
  }
  if (patch.style !== undefined) {
    if (patch.style === null) {
      delete updated.style;
    } else {
      updated.style = { ...(updated.style ?? {}), ...clone(patch.style) };
    }
  }
  if (patch.meta !== undefined) {
    if (patch.meta === null) {
      delete updated.meta;
    } else {
      updated.meta = clone(patch.meta);
    }
  }

  if (patch.clip !== undefined) {
    if (updated.type !== "frame") {
      throw new WeftOperationError("patch.type", "Only a frame can set `clip`.");
    }
    updated.clip = patch.clip;
  }
  if (patch.content !== undefined) {
    if (updated.type !== "text") {
      throw new WeftOperationError("patch.type", "Only a text node can set `content`.");
    }
    updated.content = patch.content;
  }
  if (patch.asset !== undefined || patch.fit !== undefined || patch.alt !== undefined) {
    if (updated.type !== "image") {
      throw new WeftOperationError("patch.type", "Only an image node can set `asset`, `fit`, or `alt`.");
    }
    if (patch.asset !== undefined) {
      if (!isId(patch.asset, "as")) {
        throw new WeftOperationError("id.invalid", "Image asset must be an as_ ULID.");
      }
      updated.asset = patch.asset;
    }
    if (patch.fit !== undefined) {
      if (!IMAGE_FITS.has(patch.fit)) {
        throw new WeftOperationError("image.fit", `Unknown image fit ${JSON.stringify(patch.fit)}.`);
      }
      updated.fit = patch.fit;
    }
    if (patch.alt !== undefined) {
      if (patch.alt === null) delete updated.alt;
      else updated.alt = patch.alt;
    }
  }
  if (patch.source !== undefined || patch.files !== undefined) {
    if (updated.type !== "snapshot") {
      throw new WeftOperationError("patch.type", "Only a snapshot node can set `source` or `files`.");
    }
    if (patch.source !== undefined) updated.source = clone(patch.source);
    if (patch.files !== undefined) updated.files = clone(patch.files);
  }

  next.nodes[nodeId] = updated;
  return next;
}
