import {
  isContainerNode,
  serialize,
  validatePage,
  WeftValidationError,
  type Asset,
  type JsonObject,
  type Node,
  type PageDocument,
  type Paint,
  type TokenTree,
} from "@weft/core";

/**
 * Three-way merge of canonical page documents.
 *
 * The merge is conservative: when both sides changed the same field or the
 * same child order differently, the current (human/live) value wins and the
 * conflict is reported. Every non-conflicting change from the incoming file is
 * still applied. Nodes are never dropped silently: a removed node that the
 * current side modified is kept with a conflict, and an added node is always
 * placed under its parent even if the sibling order had to be chosen.
 *
 * The merge works on top-level node fields. A style object is one field here,
 * so concurrent edits to different style sub-fields resolve as one field; nested
 * CRDT maps are a later refinement.
 */

export interface MergeConflict {
  /** Path such as `nodes.nd_….content`, `children`, or `nodes.nd_….parent`. */
  path: string;
  base?: unknown;
  current?: unknown;
  incoming?: unknown;
  /** This merge always keeps the current value and reports the conflict. */
  resolution: "kept-current";
}

export interface MergeResult {
  page: PageDocument;
  conflicts: MergeConflict[];
}

export interface MergeOptions {
  tokens?: TokenTree;
  assets?: Asset[];
  /** Validate the merged page before returning. Default: true. */
  validate?: boolean;
}

type ParentMap = Map<string, string | null>;
type SequenceMap = Map<string | null, string[]>;
type NodeRecord = Record<string, unknown>;

const PAGE_FIELDS = ["format", "version", "id", "name", "background", "meta"] as const;

function isContainerType(value: unknown): boolean {
  return value === "frame" || value === "group";
}

function copyValue<T>(value: T): T {
  return (value === undefined ? undefined : structuredClone(value)) as T;
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return serialize(left) === serialize(right);
}

function nodeFields(node: Node): NodeRecord {
  const record = { ...(node as unknown as NodeRecord) };
  delete record.children;
  return record;
}

function parentMap(page: PageDocument): ParentMap {
  const parents: ParentMap = new Map();
  for (const id of page.children) parents.set(id, null);
  for (const node of Object.values(page.nodes)) {
    if (!isContainerNode(node)) continue;
    for (const child of node.children) parents.set(child, node.id);
  }
  return parents;
}

function sequenceMap(page: PageDocument): SequenceMap {
  const sequences: SequenceMap = new Map();
  sequences.set(null, [...page.children]);
  for (const node of Object.values(page.nodes)) {
    if (isContainerNode(node)) sequences.set(node.id, [...node.children]);
  }
  return sequences;
}

function subtreeSignature(
  page: PageDocument,
  id: string,
  parents: ParentMap,
  seen = new Set<string>(),
): unknown {
  if (seen.has(id)) return null;
  seen.add(id);
  const node = page.nodes[id];
  const fields = nodeFields(node);
  const children = isContainerNode(node)
    ? node.children.map((child) => subtreeSignature(page, child, parents, seen))
    : undefined;
  seen.delete(id);
  return {
    fields,
    parent: parents.get(id) ?? null,
    children,
  };
}

function nodeSignature(
  page: PageDocument,
  id: string,
  parents: ParentMap,
): string {
  return serialize(subtreeSignature(page, id, parents));
}

function descendantIds(page: PageDocument, id: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const node = page.nodes[current];
    if (!node || !isContainerNode(node)) continue;
    for (const child of node.children) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

function addConflict(
  conflicts: MergeConflict[],
  path: string,
  base: unknown,
  current: unknown,
  incoming: unknown,
): void {
  conflicts.push({
    path,
    base: copyValue(base),
    current: copyValue(current),
    incoming: copyValue(incoming),
    resolution: "kept-current",
  });
}

function mergeValue(
  base: unknown,
  current: unknown,
  incoming: unknown,
  path: string,
  conflicts: MergeConflict[],
): unknown {
  if (same(current, base)) return copyValue(incoming);
  if (same(incoming, base)) return copyValue(current);
  if (same(current, incoming)) return copyValue(current);
  addConflict(conflicts, path, base, current, incoming);
  return copyValue(current);
}

function mergeNodeFields(
  base: Node,
  current: Node,
  incoming: Node,
  id: string,
  conflicts: MergeConflict[],
): NodeRecord {
  const fields = new Set([
    ...Object.keys(nodeFields(base)),
    ...Object.keys(nodeFields(current)),
    ...Object.keys(nodeFields(incoming)),
  ]);
  const merged: NodeRecord = {};
  for (const field of fields) {
    const value = mergeValue(
      nodeFields(base)[field],
      nodeFields(current)[field],
      nodeFields(incoming)[field],
      `nodes.${id}.${field}`,
      conflicts,
    );
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}

function rank(sequence: string[] | undefined, id: string): number {
  if (!sequence) return Number.MAX_SAFE_INTEGER;
  const index = sequence.indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function mergeSequence(
  base: string[],
  current: string[],
  incoming: string[],
  path: string,
  conflicts: MergeConflict[],
): string[] {
  if (same(current, base)) return [...incoming];
  if (same(incoming, base)) return [...current];
  if (same(current, incoming)) return [...current];
  addConflict(conflicts, path, base, current, incoming);
  return [...current];
}

/** Merge a file write against the live page without losing either side. */
export function mergePages(
  base: PageDocument,
  current: PageDocument,
  incoming: PageDocument,
  options: MergeOptions = {},
): MergeResult {
  const conflicts: MergeConflict[] = [];
  const baseParents = parentMap(base);
  const currentParents = parentMap(current);
  const incomingParents = parentMap(incoming);
  const baseSequences = sequenceMap(base);
  const currentSequences = sequenceMap(current);
  const incomingSequences = sequenceMap(incoming);

  const mergedNodes: Record<string, NodeRecord> = {};
  const mergedParents: ParentMap = new Map();
  const ids = new Set([
    ...Object.keys(base.nodes),
    ...Object.keys(current.nodes),
    ...Object.keys(incoming.nodes),
  ]);

  // If the file removes a subtree that the live page changed, keep the whole
  // live subtree: a modified container without its children is worse than one
  // reported conflict. Descendants inherit the decision.
  const keptRemoved = new Set<string>();
  const removalRoots = new Set<string>();
  for (const id of ids) {
    const baseNode = base.nodes[id];
    const currentNode = current.nodes[id];
    if (!baseNode || !currentNode || incoming.nodes[id]) continue;
    if (same(nodeSignature(base, id, baseParents), nodeSignature(current, id, currentParents))) {
      continue;
    }
    removalRoots.add(id);
    keptRemoved.add(id);
    for (const descendant of descendantIds(current, id)) keptRemoved.add(descendant);
  }

  for (const id of ids) {
    const b = base.nodes[id];
    const c = current.nodes[id];
    const i = incoming.nodes[id];

    if (b && c && i) {
      mergedNodes[id] = mergeNodeFields(b, c, i, id, conflicts);
      mergedParents.set(
        id,
        mergeValue(
          baseParents.get(id) ?? null,
          currentParents.get(id) ?? null,
          incomingParents.get(id) ?? null,
          `nodes.${id}.parent`,
          conflicts,
        ) as string | null,
      );
      continue;
    }

    if (b && c && !i) {
      if (keptRemoved.has(id)) {
        if (removalRoots.has(id)) {
          addConflict(conflicts, `nodes.${id}`, b, c, undefined);
        }
        mergedNodes[id] = nodeFields(c);
        mergedParents.set(id, currentParents.get(id) ?? null);
        continue;
      }
      if (same(nodeSignature(base, id, baseParents), nodeSignature(current, id, currentParents))) {
        continue;
      }
      addConflict(conflicts, `nodes.${id}`, b, c, undefined);
      mergedNodes[id] = nodeFields(c);
      mergedParents.set(id, currentParents.get(id) ?? null);
      continue;
    }

    if (b && i && !c) {
      if (same(nodeSignature(base, id, baseParents), nodeSignature(incoming, id, incomingParents))) {
        continue;
      }
      addConflict(conflicts, `nodes.${id}`, b, undefined, i);
      continue;
    }

    if (c && i && !b) {
      if (!same(nodeSignature(current, id, currentParents), nodeSignature(incoming, id, incomingParents))) {
        addConflict(conflicts, `nodes.${id}`, undefined, c, i);
      }
      mergedNodes[id] = nodeFields(c);
      mergedParents.set(id, currentParents.get(id) ?? null);
      continue;
    }

    if (c) {
      mergedNodes[id] = nodeFields(c);
      mergedParents.set(id, currentParents.get(id) ?? null);
    } else if (i) {
      mergedNodes[id] = nodeFields(i);
      mergedParents.set(id, incomingParents.get(id) ?? null);
    }
  }

  // A child cannot stay under a parent that was removed or is no longer a
  // container. Reattach it to the page root and make the repair visible.
  for (const id of Object.keys(mergedNodes)) {
    const parent = mergedParents.get(id) ?? null;
    if (parent === null) continue;
    const parentNode = mergedNodes[parent];
    if (parentNode && isContainerType(parentNode.type)) continue;
    mergedParents.set(id, null);
    addConflict(conflicts, `nodes.${id}.parent`, undefined, parent, undefined);
  }

  const parentIds = new Set<string | null>([null]);
  for (const id of Object.keys(mergedNodes)) {
    if (isContainerType(mergedNodes[id].type)) parentIds.add(id);
  }
  for (const map of [baseSequences, currentSequences, incomingSequences]) {
    for (const parent of map.keys()) parentIds.add(parent);
  }

  const mergedSequences: SequenceMap = new Map();
  for (const parent of parentIds) {
    const keep = (id: string): boolean =>
      Boolean(mergedNodes[id]) && (mergedParents.get(id) ?? null) === parent;

    const baseSeq = (baseSequences.get(parent) ?? []).filter(keep);
    const currentSeq = (currentSequences.get(parent) ?? []).filter(keep);
    const incomingSeq = (incomingSequences.get(parent) ?? []).filter(keep);
    const chosen = mergeSequence(
      baseSeq,
      currentSeq,
      incomingSeq,
      `children.${parent ?? "root"}`,
      conflicts,
    );

    const missing = Object.keys(mergedNodes)
      .filter((id) => keep(id) && !chosen.includes(id))
      .sort((left, right) => {
        const leftRank = Math.min(
          rank(incomingSequences.get(parent), left),
          rank(currentSequences.get(parent), left),
          rank(baseSequences.get(parent), left),
        );
        const rightRank = Math.min(
          rank(incomingSequences.get(parent), right),
          rank(currentSequences.get(parent), right),
          rank(baseSequences.get(parent), right),
        );
        return leftRank === rightRank ? left.localeCompare(right) : leftRank - rightRank;
      });

    mergedSequences.set(parent, [...new Set([...chosen, ...missing])]);
  }

  const pageFields: Record<string, unknown> = {};
  for (const field of PAGE_FIELDS) {
    const value = mergeValue(
      (base as unknown as Record<string, unknown>)[field],
      (current as unknown as Record<string, unknown>)[field],
      (incoming as unknown as Record<string, unknown>)[field],
      field,
      conflicts,
    );
    if (value !== undefined) pageFields[field] = value;
  }

  const nodes: Record<string, Node> = {};
  for (const [id, fields] of Object.entries(mergedNodes)) {
    const node = { ...fields } as unknown as Node;
    if (isContainerNode(node)) {
      node.children = mergedSequences.get(id) ?? [];
    } else {
      delete (node as unknown as NodeRecord).children;
    }
    nodes[id] = node;
  }

  const page: PageDocument = {
    format: (pageFields.format ?? current.format) as PageDocument["format"],
    version: (pageFields.version ?? current.version) as PageDocument["version"],
    id: (pageFields.id ?? current.id) as string,
    name: (pageFields.name ?? current.name) as string,
    nodes,
    children: mergedSequences.get(null) ?? [],
  };
  if (pageFields.background !== undefined) {
    page.background = pageFields.background as Paint | null;
  }
  if (pageFields.meta !== undefined) {
    page.meta = pageFields.meta as JsonObject;
  }

  if (options.validate !== false) {
    const issues = validatePage(page, {
      tokens: options.tokens,
      assets: options.assets,
    });
    if (issues.length > 0) throw new WeftValidationError(issues);
  }

  return { page, conflicts };
}
