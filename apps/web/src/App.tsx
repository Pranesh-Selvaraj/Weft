import { useLayoutEffect, useRef, useState } from "react";
import { getPageBounds, PageView } from "@weft/render";
import design from "virtual:weft-design";

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
  const [pageIndex, setPageIndex] = useState(0);
  const page = design.pages[pageIndex] ?? design.pages[0];
  const bounds = getPageBounds(page);
  const { ref, scale } = useFitScale(bounds.width, bounds.height);
  const nodeCount = Object.keys(page.nodes).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">w</span>
          <span className="brand-name">Weft</span>
        </div>

        <div className="design">
          <span className="design-name">{design.manifest.name}</span>
          <span className="design-meta">read-only preview</span>
        </div>

        <nav className="page-tabs" aria-label="Pages">
          {design.pages.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              className={`page-tab${index === pageIndex ? " is-active" : ""}`}
              onClick={() => setPageIndex(index)}
            >
              {candidate.name}
            </button>
          ))}
        </nav>

        <div className="topbar-right">
          <span className="badge">read only</span>
          <span className="meta">{nodeCount} nodes</span>
          <span className="meta">{Math.round(scale * 100)}%</span>
        </div>
      </header>

      <main className="canvas" ref={ref}>
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
              <PageView page={page} manifest={design.manifest} />
            </div>
          </div>
        </div>
        <div className="canvas-hint">
          Read-only preview · {design.manifest.pages.length} page
          {design.manifest.pages.length === 1 ? "" : "s"} · live editing comes next
        </div>
      </main>
    </div>
  );
}
