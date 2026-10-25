import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getPageBounds, PageView } from "@weft/render";
import { useDesignSource } from "./live";

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

export function App() {
  const source = useDesignSource();
  const [activePageId, setActivePageId] = useState<string | null>(
    source.pages[0]?.id ?? null,
  );

  useEffect(() => {
    if (activePageId && source.pages.some((page) => page.id === activePageId)) return;
    setActivePageId(source.pages[0]?.id ?? null);
  }, [activePageId, source.pages]);

  const page =
    source.pages.find((candidate) => candidate.id === activePageId) ??
    source.pages[0];
  const bounds = page ? getPageBounds(page) : { width: 800, height: 600 };
  const { ref, scale } = useFitScale(bounds.width, bounds.height);
  const tabs = source.manifest.pages.filter((ref) =>
    source.pages.some((candidate) => candidate.id === ref.id),
  );
  const nodeCount = page ? Object.keys(page.nodes).length : 0;

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
      ? "Static preview · run weft dev for live updates"
      : source.status === "live"
        ? `Live from the local bridge · revision ${source.revision ?? "—"}`
        : source.status === "connecting"
          ? "Connecting to the local bridge…"
          : "Bridge offline · retrying…";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">w</span>
          <span className="brand-name">Weft</span>
        </div>

        <div className="design">
          <span className="design-name">{source.manifest.name}</span>
          <span className="design-meta">
            {source.mode === "live" ? "live preview" : "read-only preview"}
          </span>
        </div>

        <nav className="page-tabs" aria-label="Pages">
          {tabs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              className={`page-tab${ref.id === page?.id ? " is-active" : ""}`}
              onClick={() => setActivePageId(ref.id)}
            >
              {ref.name}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
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
              >
                <PageView page={page} manifest={source.manifest} />
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
    </div>
  );
}
