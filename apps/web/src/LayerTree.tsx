import { useEffect, useRef, useState } from "react";
import {
  getAncestorIds,
  isContainerNode,
  type Node,
  type PageDocument,
} from "@weft/core";
import {
  ChevronIcon,
  EllipseIcon,
  FrameIcon,
  ImageIcon,
  LayersIcon,
  RectIcon,
  SnapshotIcon,
  TextIcon,
} from "./icons";

interface LayerTreeProps {
  page: PageDocument;
  selectedId: string | null;
  selectedIds: ReadonlySet<string>;
  onSelect(id: string, additive: boolean): void;
}

function NodeIcon({ node }: { node: Node }) {
  switch (node.type) {
    case "frame":
    case "group":
      return <FrameIcon />;
    case "text":
      return <TextIcon />;
    case "rect":
      return <RectIcon />;
    case "ellipse":
      return <EllipseIcon />;
    case "image":
      return <ImageIcon />;
    case "snapshot":
      return <SnapshotIcon />;
    default:
      return <RectIcon />;
  }
}

function LayerRow({
  page,
  id,
  depth,
  selectedId,
  selectedIds,
  onSelect,
}: LayerTreeProps & { id: string; depth: number }) {
  const node = page.nodes[id];
  const [expanded, setExpanded] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  const container = node ? isContainerNode(node) : false;
  const selected = selectedIds.has(id);
  const containsSelection = [...selectedIds].some(
    (candidate) =>
      candidate === id || getAncestorIds(page, candidate).includes(id),
  );

  useEffect(() => {
    if (containsSelection) setExpanded(true);
  }, [containsSelection]);

  useEffect(() => {
    if (selectedId === id) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [id, selectedId]);

  if (!node) return null;

  return (
    <div role="treeitem" aria-selected={selected}>
      <div
        className={`layer-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(event) =>
          onSelect(id, event.shiftKey || event.metaKey || event.ctrlKey)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(id, event.shiftKey);
          }
        }}
        role="button"
        tabIndex={0}
        ref={rowRef}
      >
        {container ? (
          <button
            type="button"
            className="layer-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((open) => !open);
            }}
            aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : (
          <span className="layer-chevron-spacer" aria-hidden="true" />
        )}
        <span className={`layer-icon is-${node.type}`} aria-hidden="true">
          <NodeIcon node={node} />
        </span>
        <span className="layer-name">{node.name}</span>
        {node.visible === false && <span className="layer-hidden">hidden</span>}
      </div>
      {isContainerNode(node) && expanded && node.children.length > 0 && (
        <div className="layer-children" role="group">
          {node.children.map((childId) => (
            <LayerRow
              key={childId}
              page={page}
              id={childId}
              depth={depth + 1}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayerTree({
  page,
  selectedId,
  selectedIds,
  onSelect,
}: LayerTreeProps) {
  return (
    <section className="layers" aria-label="Layers">
      <div className="layers-head">
        <span className="panel-eyebrow">
          <LayersIcon />
          Layers
        </span>
        <span className="layers-count">{Object.keys(page.nodes).length}</span>
      </div>
      <div className="layer-tree" role="tree" aria-label="Page layers">
        {page.children.length === 0 ? (
          <p className="layer-empty">This page has no layers. Draw a frame or shape to start.</p>
        ) : (
          page.children.map((id) => (
            <LayerRow
              key={id}
              page={page}
              id={id}
              depth={0}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}
