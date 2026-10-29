import { getParentId, isContainerNode, type PageDocument } from "@weft/core";
import type { DesignSource } from "./live";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

interface MultiInspectorProps {
  page: PageDocument;
  source: DesignSource;
  ids: ReadonlySet<string>;
  onAlign(mode: AlignMode): void;
  onDelete(): void;
  onClear(): void;
}

function actorLabel(actor: DesignSource["lastActor"]): string {
  if (!actor) return "No edits yet";
  return `${actor.name ?? actor.id} · ${actor.kind}`;
}

function AlignIcon({ mode }: { mode: AlignMode }) {
  const horizontal = mode === "left" || mode === "center" || mode === "right";
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      {horizontal ? (
        <>
          <path d={mode === "left" ? "M3 3v14" : mode === "right" ? "M17 3v14" : "M10 3v14"} />
          <rect x="6" y="6" width="8" height="3" rx="0.6" fill="currentColor" stroke="none" />
          <rect x="5" y="11" width="9" height="3" rx="0.6" fill="currentColor" stroke="none" />
          {mode === "center" && <path d="M10 3v14" />}
        </>
      ) : (
        <>
          <path d={mode === "top" ? "M3 3h14" : mode === "bottom" ? "M3 17h14" : "M3 10h14"} />
          <rect x="6" y="6" width="3" height="8" rx="0.6" fill="currentColor" stroke="none" />
          <rect x="11" y="5" width="3" height="9" rx="0.6" fill="currentColor" stroke="none" />
          {mode === "middle" && <path d="M3 10h14" />}
        </>
      )}
    </svg>
  );
}

export function MultiInspector({
  page,
  source,
  ids,
  onAlign,
  onDelete,
  onClear,
}: MultiInspectorProps) {
  const nodes = [...ids]
    .map((id) => page.nodes[id])
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const flexBound = nodes.filter((node) => {
    const parentId = getParentId(page, node.id);
    const parent = parentId ? page.nodes[parentId] : undefined;
    return Boolean(parent && isContainerNode(parent) && parent.layout?.mode === "flex");
  }).length;

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
          layers. Arrow keys nudge by 1 px (Shift: 10 px). Resize handles are available
          for a single layer.
        </p>
        {flexBound > 0 && (
          <div className="inspector-banner">
            {flexBound === 1 ? "One selected layer is" : `${flexBound} selected layers are`}{" "}
            a flex child. Alignment and nudge update x/y, but the flex layout may
            override them.
          </div>
        )}
        <div className="align-grid" role="group" aria-label="Align selection">
          {(
            [
              ["left", "Align left"],
              ["center", "Align horizontal centers"],
              ["right", "Align right"],
              ["top", "Align top"],
              ["middle", "Align vertical centers"],
              ["bottom", "Align bottom"],
            ] as Array<[AlignMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="align-button"
              disabled={!source.editable || source.pending > 0}
              aria-label={label}
              title={label}
              onClick={() => onAlign(mode)}
            >
              <AlignIcon mode={mode} />
            </button>
          ))}
        </div>
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
