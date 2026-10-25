import {
  applyPageCommand,
  isContainerNode,
  serialize,
  validatePage,
  WeftValidationError,
  type Asset,
  type Node,
  type PageCommand,
  type PageDocument,
  type TokenTree,
} from "@weft/core";
import { generateNKeysBetween } from "fractional-indexing";
import * as Y from "yjs";
import { mergePages, type MergeConflict } from "./merge.js";

/**
 * A live page backed by Yjs.
 *
 * The canonical page JSON remains the durable artifact. This session is the
 * collaborative state: node fields are Y.Map registers, parent/order are a
 * separate placement map with fractional order keys, and children arrays are
 * derived during materialization. There is no Y.Array move operation to fight:
 * moving a node changes two placement fields.
 *
 * External file writes are ingested with a three-way merge against the last
 * materialized baseline. Conflicts keep the live value and are reported; they
 * are never resolved by silently dropping a node or a field.
 */

export interface PageSessionOptions {
  tokens?: TokenTree;
  assets?: Asset[];
  /** Validate every materialized page. Default: true. */
  validate?: boolean;
}

export interface AppliedSessionCommand {
  page: PageDocument;
  inverse: PageCommand;
  createdNodeIds: string[];
}

export interface IngestResult {
  page: PageDocument;
  conflicts: MergeConflict[];
}

export class WeftSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WeftSessionError";
    this.code = code;
  }
}

const ROOT_KEY = "page";
const NODES_KEY = "nodes";
const PLACEMENT_KEY = "placement";
const PARENT_KEY = "parentId";
const ORDER_KEY = "order";

type NodeRecord = Record<string, unknown>;
type SequenceMap = Map<string | null, string[]>;

function copy<T>(value: T): T {
  return (value === undefined ? undefined : structuredClone(value)) as T;
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return serialize(left) === serialize(right);
}

function fieldsOf(node: Node): NodeRecord {
  const fields = { ...(node as unknown as NodeRecord) };
  delete fields.children;
  return fields;
}

function sequenceMap(page: PageDocument): SequenceMap {
  const sequences: SequenceMap = new Map();
  sequences.set(null, [...page.children]);
  for (const node of Object.values(page.nodes)) {
    if (isContainerNode(node)) sequences.set(node.id, [...node.children]);
  }
  return sequences;
}

function allowPage(options: PageSessionOptions, page: PageDocument): void {
  if (options.validate === false) return;
  const issues = validatePage(page, {
    tokens: options.tokens,
    assets: options.assets,
  });
  if (issues.length > 0) throw new WeftValidationError(issues);
}

export class PageSession {
  readonly doc: Y.Doc;

  private readonly options: PageSessionOptions;
  private readonly root: Y.Map<unknown>;
  private readonly nodes: Y.Map<Y.Map<unknown>>;
  private readonly placements: Y.Map<Y.Map<string | null>>;
  private persistedPage!: PageDocument;

  private constructor(doc: Y.Doc, options: PageSessionOptions) {
    this.doc = doc;
    this.options = { ...options };
    this.root = doc.getMap<unknown>(ROOT_KEY);

    const existingNodes = this.root.get(NODES_KEY);
    this.nodes =
      existingNodes instanceof Y.Map
        ? (existingNodes as Y.Map<Y.Map<unknown>>)
        : new Y.Map<Y.Map<unknown>>();
    const existingPlacements = this.root.get(PLACEMENT_KEY);
    this.placements =
      existingPlacements instanceof Y.Map
        ? (existingPlacements as Y.Map<Y.Map<string | null>>)
        : new Y.Map<Y.Map<string | null>>();

    if (!this.root.has(NODES_KEY)) this.root.set(NODES_KEY, this.nodes);
    if (!this.root.has(PLACEMENT_KEY)) this.root.set(PLACEMENT_KEY, this.placements);
  }

  /** Create a session from canonical page JSON. */
  static fromPage(page: PageDocument, options: PageSessionOptions = {}): PageSession {
    const session = new PageSession(new Y.Doc(), options);
    session.load(page);
    return session;
  }

  /**
   * Join a session from a Yjs update. Use this rather than loading the same
   * page twice when two clients must share the initial Yjs structure.
   */
  static fromUpdate(
    update: Uint8Array,
    options: PageSessionOptions = {},
  ): PageSession {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const session = new PageSession(doc, options);
    const page = session.toPage();
    session.persistedPage = copy(page);
    return session;
  }

  private load(page: PageDocument): void {
    allowPage(this.options, page);
    this.doc.transact(() => {
      this.root.set("format", page.format);
      this.root.set("version", page.version);
      this.root.set("id", page.id);
      this.root.set("name", page.name);
      if (page.background === undefined) this.root.delete("background");
      else this.root.set("background", copy(page.background));
      if (page.meta === undefined) this.root.delete("meta");
      else this.root.set("meta", copy(page.meta));

      this.nodes.clear();
      this.placements.clear();

      for (const [id, node] of Object.entries(page.nodes)) {
        const ynode = new Y.Map<unknown>();
        for (const [key, value] of Object.entries(fieldsOf(node))) {
          ynode.set(key, copy(value));
        }
        this.nodes.set(id, ynode);
      }

      for (const [parent, ids] of sequenceMap(page)) {
        const orders = generateNKeysBetween(null, null, ids.length);
        ids.forEach((id, index) => {
          const placement = new Y.Map<string | null>();
          placement.set(PARENT_KEY, parent);
          placement.set(ORDER_KEY, orders[index]);
          this.placements.set(id, placement);
        });
      }
    }, "load");
    this.persistedPage = copy(page);
  }

  /** Materialize the current live state as canonical page JSON. */
  toPage(): PageDocument {
    const nodes: Record<string, Node> = {};
    const parents = new Map<string, string | null>();
    const orders = new Map<string, string>();
    const groups: SequenceMap = new Map();

    for (const [id, ynode] of this.nodes.entries()) {
      const record = Object.fromEntries(ynode.entries()) as unknown as Node;
      const fields = fieldsOf(record);
      nodes[id] = fields as unknown as Node;
      const placement = this.placements.get(id);
      const parent = placement?.get(PARENT_KEY) ?? null;
      const order = placement?.get(ORDER_KEY) ?? `~${id}`;
      parents.set(id, parent);
      orders.set(id, order);
    }

    for (const id of Object.keys(nodes)) {
      const parent = parents.get(id) ?? null;
      const list = groups.get(parent) ?? [];
      list.push(id);
      groups.set(parent, list);
    }

    for (const [parent, ids] of groups) {
      ids.sort((left, right) => {
        const leftOrder = orders.get(left) ?? "";
        const rightOrder = orders.get(right) ?? "";
        if (leftOrder !== rightOrder) return leftOrder < rightOrder ? -1 : 1;
        return left.localeCompare(right);
      });
      groups.set(parent, ids);
    }

    for (const [id, node] of Object.entries(nodes)) {
      if (isContainerNode(node)) {
        node.children = groups.get(id) ?? [];
      } else {
        delete (node as unknown as NodeRecord).children;
      }
    }

    const page: PageDocument = {
      format: this.root.get("format") as PageDocument["format"],
      version: this.root.get("version") as PageDocument["version"],
      id: this.root.get("id") as string,
      name: this.root.get("name") as string,
      nodes,
      children: groups.get(null) ?? [],
    };
    if (this.root.has("background")) {
      page.background = this.root.get("background") as PageDocument["background"];
    }
    if (this.root.has("meta")) {
      page.meta = this.root.get("meta") as PageDocument["meta"];
    }

    allowPage(this.options, page);
    return page;
  }

  /** The page as last materialized to the file (or marked persisted). */
  get baseline(): PageDocument {
    return copy(this.persistedPage);
  }

  get pageId(): string {
    return String(this.root.get("id") ?? "");
  }

  get hasUnpersistedChanges(): boolean {
    return !same(this.persistedPage, this.toPage());
  }

  /**
   * Mark the current live state as persisted. The bridge calls this after
   * writing the materialized page to disk.
   */
  markMaterialized(page: PageDocument = this.toPage()): PageDocument {
    const next = copy(page);
    this.persistedPage = next;
    return copy(next);
  }

  /**
   * Apply a semantic command to the live page. The returned inverse can be
   * applied with another call. Persistence is the bridge's job; call
   * `markMaterialized` after writing the returned page.
   */
  applyCommand(command: PageCommand): AppliedSessionCommand {
    const before = this.toPage();
    const applied = applyPageCommand(before, command);
    this.reconcile(before, applied.page, "command");
    const materialized = this.toPage();
    if (!same(materialized, applied.page)) {
      throw new WeftSessionError(
        "session.materialization",
        "The live page did not materialize to the command result.",
      );
    }
    return {
      page: materialized,
      inverse: applied.inverse,
      createdNodeIds: applied.createdNodeIds,
    };
  }

  /**
   * Ingest a whole-page file write. Changes that do not collide with live edits
   * are applied; conflicting fields keep the live value and are returned in
   * `conflicts`. The baseline advances to the materialized result.
   */
  ingestPage(incoming: PageDocument): IngestResult {
    allowPage(this.options, incoming);
    const base = this.baseline;
    const current = this.toPage();
    if (incoming.id !== current.id) {
      throw new WeftSessionError(
        "session.page-id",
        `Incoming page id ${incoming.id} does not match live page ${current.id}.`,
      );
    }

    let page: PageDocument;
    let conflicts: MergeConflict[];
    if (same(base, current)) {
      page = copy(incoming);
      conflicts = [];
    } else {
      const merged = mergePages(base, current, incoming, {
        tokens: this.options.tokens,
        assets: this.options.assets,
        validate: this.options.validate,
      });
      page = merged.page;
      conflicts = merged.conflicts;
    }

    this.reconcile(current, page, "ingest");
    const materialized = this.toPage();
    if (!same(materialized, page)) {
      throw new WeftSessionError(
        "session.materialization",
        "The live page did not materialize to the ingested page.",
      );
    }
    this.persistedPage = copy(materialized);
    return { page: materialized, conflicts };
  }

  applyUpdate(update: Uint8Array, origin: unknown = "remote"): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  encodeStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  onUpdate(handler: (update: Uint8Array, origin: unknown) => void): () => void {
    const listener = (update: Uint8Array, origin: unknown): void => handler(update, origin);
    this.doc.on("update", listener);
    return () => this.doc.off("update", listener);
  }

  destroy(): void {
    this.doc.destroy();
  }

  private reconcile(from: PageDocument, to: PageDocument, origin: unknown): void {
    this.doc.transact(() => {
      const setRoot = (key: string, value: unknown): void => {
        const current = this.root.get(key);
        if (value === undefined) {
          if (current !== undefined) this.root.delete(key);
          return;
        }
        if (!same(current, value)) this.root.set(key, copy(value));
      };

      setRoot("format", to.format);
      setRoot("version", to.version);
      setRoot("id", to.id);
      setRoot("name", to.name);
      setRoot("background", to.background);
      setRoot("meta", to.meta);

      for (const id of Object.keys(from.nodes)) {
        if (to.nodes[id]) continue;
        this.nodes.delete(id);
        this.placements.delete(id);
      }

      for (const [id, node] of Object.entries(to.nodes)) {
        const after = fieldsOf(node);
        const ynode = this.nodes.get(id);
        if (!ynode) {
          const created = new Y.Map<unknown>();
          for (const [key, value] of Object.entries(after)) {
            created.set(key, copy(value));
          }
          this.nodes.set(id, created);
          continue;
        }

        const before = from.nodes[id] ? fieldsOf(from.nodes[id]) : {};
        const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
        for (const field of fields) {
          if (same(before[field], after[field])) continue;
          if (after[field] === undefined) ynode.delete(field);
          else ynode.set(field, copy(after[field]));
        }
      }

      const fromSequences = sequenceMap(from);
      const toSequences = sequenceMap(to);
      const parents = new Set<string | null>([
        null,
        ...Object.keys(to.nodes),
        ...fromSequences.keys(),
        ...toSequences.keys(),
      ]);
      for (const parent of parents) {
        const before = fromSequences.get(parent) ?? [];
        const after = toSequences.get(parent) ?? [];
        if (same(before, after)) continue;
        const orders = generateNKeysBetween(null, null, after.length);
        after.forEach((id, index) => {
          let placement = this.placements.get(id);
          if (!placement) {
            placement = new Y.Map<string | null>();
            this.placements.set(id, placement);
          }
          placement.set(PARENT_KEY, parent);
          placement.set(ORDER_KEY, orders[index]);
        });
      }
    }, origin);
  }
}
