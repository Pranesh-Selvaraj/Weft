import { useEffect, useRef, useState } from "react";
import {
  getParentId,
  isContainerNode,
  type Node,
  type PageCommand,
  type PageDocument,
  type TextNode,
} from "@weft/core";
import type { DesignSource } from "./live";

interface InspectorProps {
  page: PageDocument | undefined;
  source: DesignSource;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
}

interface Draft {
  name: string;
  x: string;
  y: string;
  width: string;
  height: string;
  opacity: string;
  content: string;
  fill: string;
}

function makeDraft(node: Node): Draft {
  const solid = node.style?.fills?.find((paint) => paint.type === "solid");
  return {
    name: node.name,
    x: String(node.x),
    y: String(node.y),
    width: String(node.width),
    height: String(node.height),
    opacity: node.style?.opacity === undefined ? "" : String(node.style.opacity),
    content: node.type === "text" ? (node as TextNode).content : "",
    fill: solid?.type === "solid" ? solid.color : "",
  };
}

function actorLabel(actor: DesignSource["lastActor"]): string {
  if (!actor) return "No edits yet";
  return `${actor.name ?? actor.id} · ${actor.kind}`;
}

function EmptyInspector({ page, source }: { page: PageDocument; source: DesignSource }) {
  return (
    <div className="inspector-empty">
      <div className="inspector-kicker">Page</div>
      <h2>{page.name}</h2>
      <dl className="inspector-facts">
        <div><dt>Nodes</dt><dd>{Object.keys(page.nodes).length}</dd></div>
        <div><dt>Page</dt><dd className="mono">{page.id}</dd></div>
        <div><dt>Revision</dt><dd>{source.revision ?? "—"}</dd></div>
        <div><dt>Last edit</dt><dd>{actorLabel(source.lastActor)}</dd></div>
      </dl>
      <p className="inspector-hint">
        Select a layer on the canvas to inspect it. Click the page background to clear
        the selection.
      </p>
      {!source.editable && (
        <div className="inspector-banner">
          Read-only. Start <code>weft dev</code> to edit and undo live.
        </div>
      )}
    </div>
  );
}

function LayerEditor({
  page,
  node,
  source,
  onSelect,
}: {
  page: PageDocument;
  node: Node;
  source: DesignSource;
  onSelect: (nodeId: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => makeDraft(node));
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formRef.current?.contains(document.activeElement)) return;
    setDraft(makeDraft(node));
  }, [node.id, source.revision]);

  const editable = source.editable;
  const parentId = getParentId(page, node.id);
  const parent = parentId ? page.nodes[parentId] : undefined;
  const flexChild = Boolean(parent && isContainerNode(parent) && parent.layout?.mode === "flex");
  const solid = node.style?.fills?.find((paint) => paint.type === "solid");
  const currentFill = solid?.type === "solid" ? solid.color : "";

  const update = (patch: PageCommand, label: string): void => {
    if (!editable) return;
    source.sendCommand(page.id, patch, label);
  };

  const commitName = (): void => {
    const name = draft.name.trim();
    if (!editable) return;
    if (name.length === 0) {
      setDraft(makeDraft(node));
      return;
    }
    if (name === node.name) return;
    update({ type: "node.update", nodeId: node.id, patch: { name } }, "Rename layer");
  };

  const commitNumber = (
    field: "x" | "y" | "width" | "height",
    options: { min?: number } = {},
  ): void => {
    if (!editable) return;
    const value = Number(draft[field]);
    if (!Number.isFinite(value) || (options.min !== undefined && value < options.min)) {
      setDraft(makeDraft(node));
      return;
    }
    if (value === node[field]) return;
    update(
      { type: "node.update", nodeId: node.id, patch: { [field]: value } },
      `Update ${field}`,
    );
  };

  const commitOpacity = (): void => {
    if (!editable) return;
    if (draft.opacity.trim() === "") {
      setDraft(makeDraft(node));
      return;
    }
    const value = Number(draft.opacity);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      setDraft(makeDraft(node));
      return;
    }
    if (value === (node.style?.opacity ?? 1)) return;
    update(
      { type: "node.update", nodeId: node.id, patch: { style: { opacity: value } } },
      "Update opacity",
    );
  };

  const commitContent = (): void => {
    if (!editable || node.type !== "text") return;
    if (draft.content === (node as TextNode).content) return;
    update(
      { type: "node.update", nodeId: node.id, patch: { content: draft.content } },
      "Update text",
    );
  };

  const commitFill = (): void => {
    if (!editable) return;
    const value = draft.fill.trim();
    if (value === currentFill) return;
    update(
      {
        type: "node.update",
        nodeId: node.id,
        patch: { style: { fills: value ? [{ type: "solid", color: value }] : [] } },
      },
      "Update fill",
    );
  };

  const remove = (): void => {
    if (!editable || node.locked === true) return;
    source.sendCommand(page.id, { type: "node.remove", nodeId: node.id }, "Remove layer");
    onSelect(null);
  };

  return (
    <div className="inspector-form" ref={formRef}>
      <div className="inspector-kicker">{node.type}</div>
      <div className="inspector-title-row">
        <h2>{node.name}</h2>
        <span className="inspector-id mono">{node.id.slice(0, 10)}…</span>
      </div>

      {!editable && (
        <div className="inspector-banner">
          Read-only. Start <code>weft dev</code> to edit and undo live.
        </div>
      )}

      {flexChild && (
        <div className="inspector-banner">
          Flex child: the parent layout may override x/y changes. Width and height
          still affect its flex size.
        </div>
      )}

      <section className="inspector-section">
        <div className="inspector-section-title">Layer</div>
        <label className="field">
          <span>Name</span>
          <input
            value={draft.name}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </label>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">Layout</div>
        <div className="field-grid">
          {(["x", "y", "width", "height"] as const).map((field) => (
            <label className="field" key={field}>
              <span>{field}</span>
              <input
                type="number"
                value={draft[field]}
                disabled={!editable}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                onBlur={() => commitNumber(field, field === "width" || field === "height" ? { min: 0 } : {})}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <div className="inspector-section-title">Appearance</div>
        <div className="field-grid">
          <label className="field">
            <span>opacity</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={draft.opacity}
              placeholder="1"
              disabled={!editable}
              onChange={(event) => setDraft({ ...draft, opacity: event.target.value })}
              onBlur={commitOpacity}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <label className="field">
            <span>fill</span>
            <input
              value={draft.fill}
              placeholder="transparent"
              disabled={!editable}
              onChange={(event) => setDraft({ ...draft, fill: event.target.value })}
              onBlur={commitFill}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </div>
      </section>

      {node.type === "text" && (
        <section className="inspector-section">
          <div className="inspector-section-title">Content</div>
          <label className="field">
            <span>text</span>
            <textarea
              rows={6}
              value={draft.content}
              disabled={!editable}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              onBlur={commitContent}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </section>
      )}

      <div className="inspector-actions">
        <button type="button" className="button" disabled={!source.canUndo} onClick={source.undo}>
          Undo
        </button>
        <button type="button" className="button" disabled={!source.canRedo} onClick={source.redo}>
          Redo
        </button>
        <button
          type="button"
          className="button is-danger"
          disabled={!editable || node.locked === true}
          onClick={remove}
          title={node.locked === true ? "Unlock the layer before deleting it" : "Delete layer"}
        >
          Delete
        </button>
      </div>

      <div className="inspector-footer">
        <span>Last edit</span>
        <strong>{actorLabel(source.lastActor)}</strong>
        <span className="inspector-shortcut">⌘/Ctrl Z undo · ⇧ for redo</span>
      </div>
    </div>
  );
}

export function Inspector({ page, source, selectedId, onSelect }: InspectorProps) {
  const selected = page && selectedId ? page.nodes[selectedId] : undefined;
  return (
    <aside className="inspector" aria-label="Inspector">
      <header className="inspector-header">
        <span>Inspector</span>
        <span className={`inspector-status ${source.editable ? "is-editable" : ""}`}>
          {source.editable ? "editable" : "read only"}
        </span>
      </header>
      {!page ? (
        <p className="inspector-hint">No page loaded.</p>
      ) : selected ? (
        <LayerEditor
          key={selected.id}
          page={page}
          node={selected}
          source={source}
          onSelect={onSelect}
        />
      ) : (
        <EmptyInspector page={page} source={source} />
      )}
    </aside>
  );
}
