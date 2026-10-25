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

function SelectionOverlay({
  page,
  selectedId,
  selectedName,
  scale,
}: {
  page: PageDocument;
  selectedId: string;
  selectedName: string;
  scale: number;
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

  const bounds = page ? getPageBounds(page) : { width: 800, height: 600 };
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

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (tool === "select" || !page || !source.editable) return;
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
          {tabs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              className={`page-tab${ref.id === page?.id ? " is-active" : ""}`}
              onClick={() => {
                setActivePageId(ref.id);
                setSelectedNodeId(null);
                setPendingSelectId(null);
                setDrag(null);
                setTool("select");
              }}
            >
              {ref.name}
            </button>
          ))}
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
                    snapshotPayloads={source.snapshots}
                  />
                  {selectedNode && (
                    <SelectionOverlay
                      page={page}
                      selectedId={selectedNode.id}
                      selectedName={selectedNode.name}
                      scale={scale}
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
