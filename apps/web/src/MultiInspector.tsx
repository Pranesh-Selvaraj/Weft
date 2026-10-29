import type { PageDocument } from "@weft/core";
import type { DesignSource } from "./live";

interface MultiInspectorProps {
  page: PageDocument;
  source: DesignSource;
  ids: ReadonlySet<string>;
  onDelete(): void;
  onClear(): void;
}

function actorLabel(actor: DesignSource["lastActor"]): string {
  if (!actor) return "No edits yet";
  return `${actor.name ?? actor.id} · ${actor.kind}`;
}

export function MultiInspector({
  page,
  source,
  ids,
  onDelete,
  onClear,
}: MultiInspectorProps) {
  const nodes = [...ids]
    .map((id) => page.nodes[id])
    .filter((node): node is NonNullable<typeof node> => Boolean(node));

  return (
    <aside className="inspector" aria-label="Multi-selection inspector">
      <header className="inspector-header">
        <span>Inspector</span>
        <span className={`inspector-status ${source.editable ? "is-editable" : ""}`}>
          {source.editable ? "selection" : "read only"}
        </span>
      </header>
      <div className="inspector-form">
        <div className="inspector-kicker">Multiple layers</div>
        <h2>
          {nodes.length} {nodes.length === 1 ? "layer" : "layers"}
        </h2>
        <ul className="multi-selection-list">
          {nodes.slice(0, 12).map((node) => (
            <li key={node.id}>
              <span>{node.name}</span>
              <code>{node.type}</code>
            </li>
          ))}
          {nodes.length > 12 && <li>+{nodes.length - 12} more</li>}
        </ul>
        <p className="inspector-hint">
          Drag any selected layer to move the group. Shift/Cmd-click adds or removes
          layers. Resize handles are available for a single layer.
        </p>
        <div className="inspector-actions">
          <button
            type="button"
            className="button is-danger"
            disabled={!source.editable || source.pending > 0}
            onClick={onDelete}
          >
            Delete selected
          </button>
          <button type="button" className="button" onClick={onClear}>
            Clear
          </button>
        </div>
        <div className="inspector-footer">
          <span>Last edit</span>
          <strong>{actorLabel(source.lastActor)}</strong>
          <span className="inspector-shortcut">Delete removes the selection</span>
        </div>
      </div>
    </aside>
  );
}
