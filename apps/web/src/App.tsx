import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { getPageBounds, PageView } from "@weft/render";
import {
  createNode,
  getParentId,
  isContainerNode,
  newId,
  type Node,
  type PageDocument,
} from "@weft/core";
import { Inspector } from "./Inspector";
import { LayerTree } from "./LayerTree";
import { ServerPanel } from "./ServerPanel";
import {
  CursorIcon,
  EllipseIcon,
  FrameIcon,
  MoonIcon,
  RectIcon,
  ServerIcon,
  SunIcon,
  TextIcon,
} from "./icons";

type Tool = "select" | "frame" | "text" | "rect" | "ellipse";
type CreateTool = Exclude<Tool, "select">;

interface DragState {
  start: { x: number; y: number };
  current: { x: number; y: number };
}

const TOOL_ORDER: Tool[] = ["select", "frame", "text", "rect", "ellipse"];
const TOOL_META: Record<Tool, { label: string; shortcut: string }> = {
  select: { label: "Select", shortcut: "V" },
  frame: { label: "Frame", shortcut: "F" },
  text: { label: "Text", shortcut: "T" },
  rect: { label: "Rectangle", shortcut: "R" },
  ellipse: { label: "Ellipse", shortcut: "O" },
};
const CREATE_DEFAULT_SIZE: Record<CreateTool, { width: number; height: number }> = {
  frame: { width: 800, height: 600 },
  text: { width: 320, height: 44 },
  rect: { width: 200, height: 120 },
  ellipse: { width: 120, height: 120 },
};

function ToolGlyph({ tool }: { tool: Tool }) {
  switch (tool) {
    case "select":
      return <CursorIcon />;
    case "frame":
      return <FrameIcon />;
    case "text":
      return <TextIcon />;
    case "rect":
      return <RectIcon />;
    case "ellipse":
      return <EllipseIcon />;
  }
}

function absoluteOrigin(page: PageDocument, nodeId: string): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const node = page.nodes[current];
    if (!node) break;
    x += node.x;
    y += node.y;
    current = getParentId(page, current);
  }
  return { x, y };
}

function makeEditorNode(
  type: CreateTool,
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Node {
  switch (type) {
    case "frame":
      return createNode({
        type,
        id,
        name,
        x,
        y,
        width,
        height,
        clip: true,
        style: {
          fills: [{ type: "solid", color: "#ffffff" }],
          radius: 12,
        },
      });
    case "text":
      return createNode({
        type,
        id,
        name,
        x,
        y,
        width,
        height,
        content: "Text",
        style: {
          fills: [{ type: "solid", color: "#17150f" }],
          font: { family: "Inter", size: 32, weight: 600, lineHeight: 1.2 },
        },
      });
    case "rect":
      return createNode({
        type,
        id,
        name,
        x,
        y,
        width,
        height,
        style: {
          fills: [{ type: "solid", color: "#e6ebff" }],
          radius: 8,
        },
      });
    case "ellipse":
      return createNode({
        type,
        id,
        name,
        x,
        y,
        width,
        height,
        style: {
          fills: [{ type: "solid", color: "#f0dfc8" }],
        },
      });
  }
}
import { useDesignSource } from "./live";
import { useTheme } from "./theme";

function useFitScale(width: number, height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      const availableWidth = Math.max(1, rect.width - 96);
      const availableHeight = Math.max(1, rect.height - 96);
      const next = Math.min(availableWidth / width, availableHeight / height, 1);
      setScale(Math.max(0.05, next));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);

  return { ref, scale };
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type TransformMode = "move" | ResizeHandle;

interface TransformPreview {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
}

const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function SelectionOverlay({
  page,
  selectedId,
  selectedName,
  scale,
  editable,
  onResizeStart,
}: {
  page: PageDocument;
  selectedId: string;
  selectedName: string;
  scale: number;
  editable: boolean;
  onResizeStart(
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLSpanElement>,
  ): void;
}) {
  const [box, setBox] = useState<SelectionBox | null>(null);

  useLayoutEffect(() => {
    const nodeElement = document.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(selectedId)}"]`,
    );
    const pageElement = document.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(page.id)}"]`,
    );
    if (!nodeElement || !pageElement) {
      setBox(null);
      return;
    }
    const nodeRect = nodeElement.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    setBox({
      left: (nodeRect.left - pageRect.left) / scale,
      top: (nodeRect.top - pageRect.top) / scale,
      width: nodeRect.width / scale,
      height: nodeRect.height / scale,
    });
  }, [page, selectedId, scale]);

  if (!box) return null;
  const handleSize = Math.max(6, 8 / scale);
  return (
    <div
      className="selection-box"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    >
      <span className="selection-label">{selectedName}</span>
      {editable &&
        RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`resize-handle is-${handle}`}
            data-resize-handle={handle}
            style={{ width: handleSize, height: handleSize }}
            onPointerDown={(event) => onResizeStart(handle, event)}
          />
        ))}
    </div>
  );
}

export function App() {
  const source = useDesignSource();
  const { theme, toggle: toggleTheme } = useTheme();
  const [activePageId, setActivePageId] = useState<string | null>(
    source.pages[0]?.id ?? null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [serverOpen, setServerOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [pendingPageId, setPendingPageId] = useState<string | null>(null);
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const [pageNameDraft, setPageNameDraft] = useState("");
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dragOverPageId, setDragOverPageId] = useState<string | null>(null);
  const [transformPreview, setTransformPreview] = useState<TransformPreview | null>(null);
  const renameDoneRef = useRef(false);
  const stageScaleRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (activePageId && source.pages.some((page) => page.id === activePageId)) return;
    setActivePageId(source.pages[0]?.id ?? null);
  }, [activePageId, source.pages]);

  const page =
    source.pages.find((candidate) => candidate.id === activePageId) ??
    source.pages[0];
  const selectedNode =
    page && selectedNodeId ? page.nodes[selectedNodeId] : undefined;

  useEffect(() => {
    if (selectedNodeId && (!page || !page.nodes[selectedNodeId])) {
      setSelectedNodeId(null);
    }
  }, [page, selectedNodeId]);

  useEffect(() => {
    if (pendingSelectId && page?.nodes[pendingSelectId]) {
      setSelectedNodeId(pendingSelectId);
      setPendingSelectId(null);
    }
  }, [page, pendingSelectId]);

  useEffect(() => {
    if (pendingPageId && source.pages.some((candidate) => candidate.id === pendingPageId)) {
      setActivePageId(pendingPageId);
      setPendingPageId(null);
    }
  }, [pendingPageId, source.pages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) source.redo();
        else source.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        source.redo();
        return;
      }
      if (!mod && source.editable) {
        const shortcut = event.key.toLowerCase();
        const nextTool: Tool | undefined =
          shortcut === "v"
            ? "select"
            : shortcut === "f"
              ? "frame"
              : shortcut === "t"
                ? "text"
                : shortcut === "r"
                  ? "rect"
                  : shortcut === "o"
                    ? "ellipse"
                    : undefined;
        if (nextTool) {
          setTool(nextTool);
          return;
        }
      }
      if (event.key === "Escape") {
        if (tool !== "select") {
          setTool("select");
          return;
        }
        setSelectedNodeId(null);
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        page &&
        selectedNode &&
        source.editable
      ) {
        event.preventDefault();
        source.sendCommand(
          page.id,
          { type: "node.remove", nodeId: selectedNode.id },
          "Remove layer",
        );
        setSelectedNodeId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, selectedNode, source, tool]);

  const pageBounds = page ? getPageBounds(page) : { width: 0, height: 0 };
  const bounds = {
    width: Math.max(800, pageBounds.width),
    height: Math.max(600, pageBounds.height),
  };
  const { ref, scale } = useFitScale(bounds.width, bounds.height);
  const tabs = source.manifest.pages.filter((ref) =>
    source.pages.some((candidate) => candidate.id === ref.id),
  );
  const nodeCount = page ? Object.keys(page.nodes).length : 0;
  const activeProject = source.workspace?.projects.find((project) =>
    project.designs.some((design) => design.path === source.workspace?.activeDesignPath),
  );
  const activeServer = activeProject
    ? source.workspace?.servers.find((server) => server.projectPath === activeProject.path)
    : undefined;

  const statusLabel =
    source.mode === "static"
      ? "read only"
      : source.status === "live"
        ? "live"
        : source.status === "connecting"
          ? "connecting"
          : "offline";
  const statusClass =
    source.mode === "static"
      ? "is-static"
      : source.status === "live"
        ? "is-live"
        : source.status === "connecting"
          ? "is-connecting"
          : "is-offline";

  const hint =
    source.mode === "static"
      ? "Static preview · run weft dev for live editing"
      : source.status === "live"
        ? `Live · select a layer, or press V/F/T/R/O to create · revision ${source.revision ?? "—"}`
        : source.status === "connecting"
          ? "Connecting to the local bridge…"
          : "Bridge offline · retrying…";

  const toPagePoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const stage = stageScaleRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.max(0, (clientX - rect.left) / scale),
      y: Math.max(0, (clientY - rect.top) / scale),
    };
  };

  const createAt = (
    type: CreateTool,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): void => {
    if (!page || !source.editable) return;
    const fallback = CREATE_DEFAULT_SIZE[type];
    const rawWidth = Math.abs(end.x - start.x);
    const rawHeight = Math.abs(end.y - start.y);
    const isClick = rawWidth < 4 && rawHeight < 4;
    const width = Math.max(1, Math.round(isClick ? fallback.width : rawWidth));
    const height = Math.max(1, Math.round(isClick ? fallback.height : rawHeight));
    const pageX = Math.max(0, isClick ? start.x : Math.min(start.x, end.x));
    const pageY = Math.max(0, isClick ? start.y : Math.min(start.y, end.y));
    const parent = selectedNode && isContainerNode(selectedNode) ? selectedNode : null;
    const origin = parent ? absoluteOrigin(page, parent.id) : { x: 0, y: 0 };
    const id = newId("nd");
    const typeCount = Object.values(page.nodes).filter((node) => node.type === type).length;
    const node = makeEditorNode(
      type,
      id,
      `${TOOL_META[type].label} ${typeCount + 1}`,
      Math.round(pageX - origin.x),
      Math.round(pageY - origin.y),
      width,
      height,
    );
    source.sendCommand(
      page.id,
      { type: "node.insert", node, parentId: parent?.id ?? null },
      `Create ${TOOL_META[type].label}`,
    );
    setPendingSelectId(id);
  };

  const startTransform = (
    mode: TransformMode,
    node: Node,
    startClientX: number,
    startClientY: number,
  ): void => {
    if (!page || !source.editable || node.locked) return;
    const stage = stageScaleRef.current;
    const start = toPagePoint(startClientX, startClientY);
    if (!stage || !start) return;
    const element = stage.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(node.id)}"]`,
    );
    const origin = absoluteOrigin(page, node.id);
    const original = element
      ? {
          translate: element.style.translate,
          width: element.style.width,
          height: element.style.height,
        }
      : null;
    let current = { x: node.x, y: node.y, width: node.width, height: node.height };
    let moved = false;

    const showPreview = (): void => {
      setTransformPreview({
        left: origin.x + current.x,
        top: origin.y + current.y,
        width: current.width,
        height: current.height,
        label:
          mode === "move"
            ? `${Math.round(current.width)}×${Math.round(current.height)}`
            : `${Math.round(current.width)} × ${Math.round(current.height)}`,
      });
    };
    showPreview();

    const move = (event: PointerEvent): void => {
      const point = toPagePoint(event.clientX, event.clientY);
      if (!point) return;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (!moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      moved = true;

      let x = node.x;
      let y = node.y;
      let width = node.width;
      let height = node.height;
      if (mode === "move") {
        x = node.x + dx;
        y = node.y + dy;
      } else {
        if (mode.includes("e")) width = Math.max(1, node.width + dx);
        if (mode.includes("w")) {
          width = Math.max(1, node.width - dx);
          x = node.x + (node.width - width);
        }
        if (mode.includes("s")) height = Math.max(1, node.height + dy);
        if (mode.includes("n")) {
          height = Math.max(1, node.height - dy);
          y = node.y + (node.height - height);
        }
      }
      current = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };

      if (element) {
        element.style.translate = `${current.x - node.x}px ${current.y - node.y}px`;
        if (mode !== "move") {
          element.style.width = `${current.width}px`;
          element.style.height = `${current.height}px`;
        }
      }
      showPreview();
    };

    const restore = (): void => {
      if (!element || !original) return;
      element.style.translate = original.translate;
      element.style.width = original.width;
      element.style.height = original.height;
    };

    const cleanup = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setTransformPreview(null);
    };

    const finish = (): void => {
      cleanup();
      restore();
      if (!moved) return;
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      source.sendCommand(
        page.id,
        {
          type: "node.update",
          nodeId: node.id,
          patch:
            mode === "move"
              ? { x: current.x, y: current.y }
              : {
                  x: current.x,
                  y: current.y,
                  width: current.width,
                  height: current.height,
                },
        },
        mode === "move" ? "Move layer" : "Resize layer",
      );
    };

    const cancel = (): void => {
      cleanup();
      restore();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const handleResizeStart = (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLSpanElement>,
  ): void => {
    if (!selectedNode || !page || !source.editable) return;
    event.preventDefault();
    event.stopPropagation();
    startTransform(handle, selectedNode, event.clientX, event.clientY);
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!page || !source.editable) return;
    if (tool === "select") {
      const target = event.target as HTMLElement;
      if (target.closest("[data-resize-handle]")) return;
      const nodeElement = target.closest<HTMLElement>("[data-node-id]");
      const nodeId = nodeElement?.dataset.nodeId;
      const node = nodeId ? page.nodes[nodeId] : undefined;
      if (!node || node.locked) return;
      setSelectedNodeId(node.id);
      event.preventDefault();
      startTransform("move", node, event.clientX, event.clientY);
      return;
    }
    const start = toPagePoint(event.clientX, event.clientY);
    if (!start) return;
    const activeTool = tool;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = true;
    let current = start;
    setDrag({ start, current: start });

    const move = (nativeEvent: PointerEvent): void => {
      const point = toPagePoint(nativeEvent.clientX, nativeEvent.clientY);
      if (!point) return;
      current = point;
      setDrag({ start, current: point });
    };
    const cleanup = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    const finish = (nativeEvent: PointerEvent): void => {
      const point = toPagePoint(nativeEvent.clientX, nativeEvent.clientY);
      if (point) current = point;
      cleanup();
      createAt(activeTool, start, current);
      setTool("select");
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    const cancel = (): void => {
      cleanup();
      setTool("select");
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const handleStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (tool !== "select") return;
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>("[data-node-id]");
    setSelectedNodeId(nodeElement?.dataset.nodeId ?? null);
  };

  const dragBox = drag
    ? {
        left: Math.min(drag.start.x, drag.current.x),
        top: Math.min(drag.start.y, drag.current.y),
        width: Math.abs(drag.current.x - drag.start.x),
        height: Math.abs(drag.current.y - drag.start.y),
      }
    : null;

  const beginPageRename = (target: { id: string; name: string }): void => {
    if (!source.editable) return;
    setActivePageId(target.id);
    setRenamingPageId(target.id);
    setPageNameDraft(target.name);
    renameDoneRef.current = false;
  };

  const finishPageRename = (commit: boolean): void => {
    if (renameDoneRef.current) return;
    renameDoneRef.current = true;
    const id = renamingPageId;
    const name = pageNameDraft.trim();
    const target = source.pages.find((candidate) => candidate.id === id);
    setRenamingPageId(null);
    if (commit && id && target && name && name !== target.name) {
      source.renamePage(id, name);
    }
  };

  const handlePageDrop = (targetId: string): void => {
    if (!draggingPageId || draggingPageId === targetId || !source.editable) {
      setDraggingPageId(null);
      setDragOverPageId(null);
      return;
    }
    const from = tabs.findIndex((ref) => ref.id === draggingPageId);
    const to = tabs.findIndex((ref) => ref.id === targetId);
    if (from !== -1 && to !== -1) source.movePage(draggingPageId, to);
    setDraggingPageId(null);
    setDragOverPageId(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">w</span>
          <span className="brand-name">Weft</span>
        </div>

        <div className="design">
          {source.workspace ? (
            <select
              className="design-select"
              aria-label="Design"
              value={source.workspace.activeDesignPath}
              disabled={!source.editable || source.switching}
              onChange={(event) => source.openDesign(event.target.value)}
            >
              {source.workspace.projects
                .filter((project) => project.designs.length > 0)
                .map((project) => (
                  <optgroup key={project.path} label={project.name}>
                    {project.designs.map((design) => (
                      <option key={design.path} value={design.path}>
                        {design.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          ) : (
            <span className="design-name">{source.manifest.name}</span>
          )}
          <span className="design-meta">
            {source.switching
              ? "switching design…"
              : source.workspace
                ? "workspace preview"
                : source.mode === "live"
                  ? "live preview"
                  : "read-only preview"}
          </span>
        </div>

        <nav className="page-tabs" aria-label="Pages">
          {tabs.map((ref) =>
            renamingPageId === ref.id ? (
              <input
                key={ref.id}
                className="page-tab-input"
                value={pageNameDraft}
                autoFocus
                aria-label="Page name"
                onChange={(event) => setPageNameDraft(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={() => finishPageRename(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    renameDoneRef.current = true;
                    setRenamingPageId(null);
                  }
                }}
              />
            ) : (
              <button
                key={ref.id}
                type="button"
                draggable={source.editable && tabs.length > 1}
                className={`page-tab${ref.id === page?.id ? " is-active" : ""}${
                  draggingPageId === ref.id ? " is-dragging" : ""
                }${dragOverPageId === ref.id ? " is-drop-target" : ""}`}
                title="Double-click to rename; drag to reorder"
                onClick={() => {
                  setActivePageId(ref.id);
                  setSelectedNodeId(null);
                  setPendingSelectId(null);
                  setDrag(null);
                  setTool("select");
                }}
                onDoubleClick={() => beginPageRename(ref)}
                onDragStart={(event) => {
                  if (!source.editable || tabs.length <= 1) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", ref.id);
                  setDraggingPageId(ref.id);
                }}
                onDragOver={(event) => {
                  if (!draggingPageId || draggingPageId === ref.id || !source.editable) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverPageId(ref.id);
                }}
                onDragLeave={() => {
                  if (dragOverPageId === ref.id) setDragOverPageId(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handlePageDrop(ref.id);
                }}
                onDragEnd={() => {
                  setDraggingPageId(null);
                  setDragOverPageId(null);
                }}
              >
                {ref.name}
              </button>
            ),
          )}
        </nav>

        <div className="topbar-right">
          {source.workspace && activeProject && (
            <button
              type="button"
              className={`server-toggle${activeServer?.status === "running" ? " is-running" : ""}`}
              onClick={() => setServerOpen((open) => !open)}
              aria-expanded={serverOpen}
              aria-label="Project server"
              title="Project server"
            >
              <ServerIcon />
              <span className="server-toggle-label">Server</span>
              <span
                className={`server-status-dot is-${activeServer?.status ?? "stopped"}`}
                aria-hidden="true"
              />
            </button>
          )}
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <div className="history-buttons">
            <button
              type="button"
              className="button"
              disabled={!source.canUndo}
              onClick={source.undo}
              title="Undo (Ctrl/Cmd+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="button"
              disabled={!source.canRedo}
              onClick={source.redo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              Redo
            </button>
          </div>
          <span className={`badge ${statusClass}`} title={hint}>
            <span className="status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
          {source.conflicts > 0 && (
            <span className="badge is-conflicts">
              {source.conflicts} conflict{source.conflicts === 1 ? "" : "s"}
            </span>
          )}
          {source.revision !== null && <span className="meta">rev {source.revision}</span>}
          <span className="meta">{nodeCount} nodes</span>
          <span className="meta">{Math.round(scale * 100)}%</span>
        </div>
      </header>

      {serverOpen && source.workspace && activeProject && (
        <ServerPanel
          project={activeProject}
          server={activeServer}
          busy={source.serverBusy === activeProject.path}
          error={source.devError}
          onStart={() => source.startServer(activeProject.path)}
          onStop={() => source.stopServer(activeProject.path)}
          onClose={() => setServerOpen(false)}
        />
      )}

      <div className="workspace" data-tool={tool}>
        <aside className="left-panel">
          <div className="tools-section">
            <span className="panel-eyebrow">Tools</span>
            <div className="tool-grid" role="toolbar" aria-label="Creation tools">
              {TOOL_ORDER.map((toolId) => (
                <button
                  key={toolId}
                  type="button"
                  className={`tool-button${tool === toolId ? " is-active" : ""}`}
                  disabled={!source.editable && toolId !== "select"}
                  aria-pressed={tool === toolId}
                  aria-label={`${TOOL_META[toolId].label} (${TOOL_META[toolId].shortcut})`}
                  title={`${TOOL_META[toolId].label} (${TOOL_META[toolId].shortcut})`}
                  onClick={() => setTool(toolId)}
                >
                  <ToolGlyph tool={toolId} />
                </button>
              ))}
            </div>
            <span className="tool-caption">
              {source.editable
                ? `${TOOL_META[tool].label} tool · ${TOOL_META[tool].shortcut}`
                : "Read-only preview"}
            </span>
          </div>
          {page && (
            <LayerTree
              page={page}
              selectedId={selectedNode?.id ?? null}
              onSelect={(id) => {
                setSelectedNodeId(id);
                setTool("select");
              }}
            />
          )}
          <div className="page-actions">
            <button
              type="button"
              className="button"
              disabled={!source.editable || source.pending > 0}
              onClick={() => {
                const id = source.createPage();
                if (id) setPendingPageId(id);
              }}
            >
              + Page
            </button>
            <button
              type="button"
              className="button"
              disabled={!source.editable || source.pending > 0 || !page}
              onClick={() => {
                if (page) beginPageRename(page);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="button is-danger"
              disabled={!source.editable || source.pending > 0 || source.pages.length <= 1}
              onClick={() => {
                if (!page) return;
                if (window.confirm(`Delete page “${page.name}”?`)) {
                  source.deletePage(page.id);
                }
              }}
            >
              Delete
            </button>
          </div>
        </aside>
        <main className="canvas" ref={ref}>
          {page ? (
            <div className="stage-holder">
              <div
                className="stage"
                style={{ width: bounds.width * scale, height: bounds.height * scale }}
              >
                <div
                  className="stage-scale"
                  ref={stageScaleRef}
                  style={{
                    width: bounds.width,
                    height: bounds.height,
                    transform: `scale(${scale})`,
                  }}
                  onPointerDown={handleStagePointerDown}
                  onClick={handleStageClick}
                >
                  <PageView
                    page={page}
                    manifest={source.manifest}
                    width={bounds.width}
                    height={bounds.height}
                    snapshotPayloads={source.snapshots}
                  />
                  {selectedNode && !transformPreview && (
                    <SelectionOverlay
                      page={page}
                      selectedId={selectedNode.id}
                      selectedName={selectedNode.name}
                      scale={scale}
                      editable={source.editable && selectedNode.locked !== true}
                      onResizeStart={handleResizeStart}
                    />
                  )}
                  {dragBox && tool !== "select" && (dragBox.width > 0 || dragBox.height > 0) && (
                    <div
                      className="creation-preview"
                      style={{
                        left: dragBox.left,
                        top: dragBox.top,
                        width: Math.max(1, dragBox.width),
                        height: Math.max(1, dragBox.height),
                      }}
                    >
                      <span>{TOOL_META[tool].label}</span>
                    </div>
                  )}
                  {transformPreview && (
                    <div
                      className="transform-preview"
                      style={{
                        left: transformPreview.left,
                        top: transformPreview.top,
                        width: Math.max(1, transformPreview.width),
                        height: Math.max(1, transformPreview.height),
                      }}
                    >
                      <span>{transformPreview.label}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="canvas-empty">No page loaded.</div>
          )}
          {source.error && (
            <div className="canvas-error" role="status">
              {source.error}
            </div>
          )}
          <div className="canvas-hint">{hint}</div>
        </main>
        <Inspector
          page={page}
          source={source}
          selectedId={selectedNode?.id ?? null}
          onSelect={setSelectedNodeId}
        />
      </div>
    </div>
  );
}
