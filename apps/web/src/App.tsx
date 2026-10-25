import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { getPageBounds, PageView } from "@weft/render";
import type { PageDocument } from "@weft/core";
import { Inspector } from "./Inspector";
import { ServerPanel } from "./ServerPanel";
import { MoonIcon, ServerIcon, SunIcon } from "./icons";
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
      if (event.key === "Escape") {
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
  }, [page, selectedNode, source]);

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
        ? `Live · select a layer to inspect it · revision ${source.revision ?? "—"}`
        : source.status === "connecting"
          ? "Connecting to the local bridge…"
          : "Bridge offline · retrying…";

  const handleStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>("[data-node-id]");
    setSelectedNodeId(nodeElement?.dataset.nodeId ?? null);
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
          {tabs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              className={`page-tab${ref.id === page?.id ? " is-active" : ""}`}
              onClick={() => {
                setActivePageId(ref.id);
                setSelectedNodeId(null);
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

      <div className="workspace">
        <main className="canvas" ref={ref}>
          {page ? (
            <div className="stage-holder">
              <div
                className="stage"
                style={{ width: bounds.width * scale, height: bounds.height * scale }}
              >
                <div
                  className="stage-scale"
                  style={{
                    width: bounds.width,
                    height: bounds.height,
                    transform: `scale(${scale})`,
                  }}
                  onClick={handleStageClick}
                >
                  <PageView page={page} manifest={source.manifest} />
                  {selectedNode && (
                    <SelectionOverlay
                      page={page}
                      selectedId={selectedNode.id}
                      selectedName={selectedNode.name}
                      scale={scale}
                    />
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
