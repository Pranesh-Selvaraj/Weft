import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PageDocument } from "@weft/core";
import type {
  CaptureFrontendOutcome,
  CaptureFrontendRequest,
  DesignSource,
  DevServerSnapshot,
  WorkspaceProjectInfo,
} from "./live";

const STATUS_LABEL: Record<DevServerSnapshot["status"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  error: "Error",
};

const FRONTEND_STORAGE_KEY = "weft.frontend.url";

function savedFrontendUrl(): string {
  try {
    return window.localStorage.getItem(FRONTEND_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatTime(value: string | null): string {
  if (!value) return "not checked";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "not checked" : date.toLocaleTimeString();
}

function endpointSocket(url: string): string {
  return `${url.replace(/^http/, "ws")}/api/live`;
}

interface EndpointRowProps {
  label: string;
  value: string;
  copied: string | null;
  onCopy(value: string): void;
}

function EndpointRow({ label, value, copied, onCopy }: EndpointRowProps) {
  return (
    <div className="endpoint-row">
      <span className="endpoint-label">{label}</span>
      <code className="endpoint-value" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="endpoint-copy"
        onClick={() => onCopy(value)}
        aria-label={`Copy ${label}`}
      >
        {copied === value ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

interface SessionPanelProps {
  source: DesignSource;
  page: PageDocument | undefined;
  pageViewport: { width: number; height: number };
  project: WorkspaceProjectInfo | null;
  server: DevServerSnapshot | undefined;
  serverBusy: boolean;
  devError: string | null;
  onStartServer(projectPath: string): void;
  onStopServer(projectPath: string): void;
  onCapture(request: CaptureFrontendRequest): Promise<CaptureFrontendOutcome>;
  onClose(): void;
}

export function SessionPanel({
  source,
  page,
  pageViewport,
  project,
  server,
  serverBusy,
  devError,
  onStartServer,
  onStopServer,
  onCapture,
  onClose,
}: SessionPanelProps) {
  const bridge = source.bridge;
  const frontend = source.frontend;
  const [draftUrl, setDraftUrl] = useState(
    () => frontend.url ?? savedFrontendUrl(),
  );
  const [copied, setCopied] = useState<string | null>(null);
  const [selector, setSelector] = useState("");
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [captureWarnings, setCaptureWarnings] = useState<string[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (frontend.url) setDraftUrl(frontend.url);
  }, [frontend.url]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const editorUrl = window.location.origin;
  const apiUrl = bridge ? `${bridge.url}/api` : "Static preview — no live API";
  const socketUrl = bridge ? endpointSocket(bridge.url) : "Static preview — no live socket";
  const designPath = bridge?.designPath ?? "Embedded in this build";
  const workspacePath = source.workspace?.file ?? "—";
  const projectPath = bridge?.projectPath ?? project?.path ?? "—";

  const copy = (value: string): void => {
    if (!value || value.startsWith("Static preview")) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopied(value))
      .catch(() => setCopied(null));
  };

  const frontendStatus = useMemo(() => {
    if (frontend.status === "checking") return "Checking…";
    if (frontend.status === "reachable") {
      return frontend.httpStatus !== null
        ? `Reachable · HTTP ${frontend.httpStatus} · ${formatTime(frontend.checkedAt)}`
        : `Reachable · ${formatTime(frontend.checkedAt)}`;
    }
    if (frontend.status === "error") return frontend.error?.message ?? "Unreachable";
    return "No frontend attached";
  }, [frontend]);

  const captureViewport = {
    width: Math.min(20_000, Math.max(320, Math.round(pageViewport.width || 1440))),
    height: Math.min(20_000, Math.max(240, Math.round(pageViewport.height || 900))),
  };
  const captureDisabled =
    !source.editable ||
    source.pending > 0 ||
    source.captureBusy ||
    !page ||
    !frontend.url ||
    frontend.status !== "reachable";

  const setCaptureErrors = (): void => {
    setCaptureError(null);
    setCaptureWarnings([]);
  };

  const submitFrontend = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const raw = draftUrl.trim();
    if (!raw) return;
    const value = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)
      ? raw
      : `http://${raw}`;
    setCaptureMessage(null);
    setCaptureErrors();
    source.attachFrontend(value);
  };

  const runCapture = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (captureDisabled || !page) return;
    setCaptureMessage(null);
    setCaptureError(null);
    setCaptureWarnings([]);
    void onCapture({
      pageId: page.id,
      selector: selector.trim() || undefined,
      viewport: captureViewport,
    }).then((outcome) => {
      if (!outcome.ok) {
        setCaptureError(outcome.error);
        return;
      }
      setCaptureWarnings(outcome.capture.warnings);
      setCaptureMessage(
        `Captured into ${page.name}. The snapshot is selected on the canvas.`,
      );
    });
  };

  const running = server?.status === "running";
  const starting = server?.status === "starting";
  const stopping = server?.status === "stopping";
  const logs = server?.logs.slice(-10) ?? [];

  return (
    <aside className="server-panel live-panel" aria-label="Live session and frontend">
      <div className="server-head">
        <div>
          <span className="eyebrow">Live session</span>
          <h2>{bridge?.designName ?? source.manifest.name}</h2>
          <code className="server-path">
            {bridge ? `${bridge.mode} bridge · ${bridge.host}:${bridge.port}` : "Static preview"}
          </code>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close live session panel"
        >
          ×
        </button>
      </div>

      {!source.editable && (
        <div className="live-note">
          <strong>Static preview</strong>
          <p>
            Start the live editor with <code>pnpm weft dev &lt;design.weft&gt;</code>{" "}
            (or a workspace bridge) to attach a frontend, capture it, and manage a
            project server.
          </p>
        </div>
      )}

      <section className="live-section" aria-labelledby="endpoints-title">
        <div className="live-section-head">
          <span id="endpoints-title">Endpoints</span>
          <span className={`live-state is-${source.status}`}>{source.status}</span>
        </div>
        <EndpointRow
          label="This editor"
          value={editorUrl}
          copied={copied}
          onCopy={copy}
        />
        <EndpointRow label="API base" value={apiUrl} copied={copied} onCopy={copy} />
        <EndpointRow
          label="Health check"
          value={bridge ? `${bridge.url}/api/health` : "Static preview — no live API"}
          copied={copied}
          onCopy={copy}
        />
        <EndpointRow label="Live socket" value={socketUrl} copied={copied} onCopy={copy} />
        <EndpointRow label="Design file" value={designPath} copied={copied} onCopy={copy} />
        <EndpointRow label="Workspace" value={workspacePath} copied={copied} onCopy={copy} />
        <EndpointRow label="Project root" value={projectPath} copied={copied} onCopy={copy} />
        <p className="live-help">
          These are the addresses this browser is actually using. The editor and
          bridge run on loopback only.
        </p>
      </section>

      <section className="live-section" aria-labelledby="frontend-title">
        <div className="live-section-head">
          <span id="frontend-title">Frontend target</span>
          <span className={`live-state is-${frontend.status}`}>
            {frontend.status === "idle" ? "not set" : frontend.status}
          </span>
        </div>
        <p className="live-help">
          Point Weft at a local dev server (for example{" "}
          <code>http://127.0.0.1:3000/</code>) to preview it and capture the page
          into the current design as a snapshot.
        </p>

        <form className="frontend-form" onSubmit={submitFrontend}>
          <input
            type="text"
            inputMode="url"
            className="frontend-input"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://127.0.0.1:3000/"
            aria-label="Local frontend URL"
            spellCheck={false}
            disabled={!source.editable || source.frontendBusy}
          />
          <button
            type="submit"
            className="button is-primary"
            disabled={!source.editable || source.frontendBusy || !draftUrl.trim()}
          >
            {source.frontendBusy ? "Checking…" : frontend.url ? "Update" : "Use frontend"}
          </button>
        </form>

        {source.frontendError && (
          <div className="server-problem">{source.frontendError}</div>
        )}

        {frontend.url && (
          <>
            <div className="frontend-current">
              <code>{frontend.url}</code>
              <div className="frontend-status-line">
                <span
                  className={`server-status-dot is-${
                    frontend.status === "reachable"
                      ? "running"
                      : frontend.status === "error"
                        ? "error"
                        : frontend.status === "checking"
                          ? "starting"
                          : "stopped"
                  }`}
                  aria-hidden="true"
                />
                <span>{frontendStatus}</span>
              </div>
            </div>
            {frontend.error && (
              <div className="server-problem">
                <strong>{frontend.error.code}</strong>
                <p>{frontend.error.message}</p>
              </div>
            )}
            <p className="live-help">
              The frontend URL is saved in this browser and reattached after a
              reload.
            </p>
            <div className="server-actions">
              <button
                type="button"
                className="button"
                onClick={() => source.refreshFrontend()}
                disabled={source.frontendBusy}
              >
                Check again
              </button>
              <button
                type="button"
                className="button"
                onClick={() =>
                  window.open(
                    "/api/frontend/preview",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                disabled={!frontend.url}
              >
                Open
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setPreviewOpen((open) => !open)}
                aria-expanded={previewOpen}
              >
                {previewOpen ? "Hide preview" : "Preview"}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => source.detachFrontend()}
                disabled={source.frontendBusy}
              >
                Detach
              </button>
            </div>
            {previewOpen && (
              <div className="frontend-preview">
                <iframe
                  key={frontend.url ?? "none"}
                  title="Local frontend preview"
                  src="/api/frontend/preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                  referrerPolicy="no-referrer"
                />
                <p className="live-help">
                  If the app sends X-Frame-Options or a frame-ancestors policy,
                  the preview stays blank; use Open instead.
                </p>
              </div>
            )}

            <form className="capture-form" onSubmit={runCapture}>
              <div className="live-section-head">
                <span>Capture as snapshot</span>
                <span className="live-meta">
                  {captureViewport.width}×{captureViewport.height} · page{" "}
                  {page?.name ?? "—"}
                </span>
              </div>
              <input
                type="text"
                className="capture-selector"
                value={selector}
                onChange={(event) => setSelector(event.target.value)}
                placeholder="CSS selector (optional), e.g. main"
                aria-label="Capture selector"
                spellCheck={false}
                disabled={!source.editable || source.captureBusy}
              />
              <button
                type="submit"
                className="button is-primary"
                disabled={captureDisabled}
              >
                {source.captureBusy ? "Capturing…" : "Capture page"}
              </button>
              {!source.editable && <p className="live-help">Live editing is required.</p>}
              {source.editable && source.pending > 0 && (
                <p className="live-help">Wait for pending edits to finish.</p>
              )}
              {page && source.editable && frontend.status !== "reachable" && (
                <p className="live-help">Attach a reachable frontend first.</p>
              )}
              {captureMessage && <p className="capture-success">{captureMessage}</p>}
              {captureError && <div className="server-problem">{captureError}</div>}
              {captureWarnings.length > 0 && (
                <div className="capture-warnings">
                  <span>Capture warnings</span>
                  <ul>
                    {captureWarnings.map((warning, index) => (
                      <li key={`${warning}-${index}`}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </form>
          </>
        )}
      </section>

      {source.workspace && (
        <section className="live-section" aria-labelledby="server-title">
          <div className="live-section-head">
            <span id="server-title">Project server</span>
            {server && (
              <span className={`live-state is-${server.status}`}>{server.status}</span>
            )}
          </div>
          {!project ? (
            <p className="live-help">No active workspace project.</p>
          ) : !server ? (
            <p className="live-help">The project server state has not loaded yet.</p>
          ) : server.configError ? (
            <div className="server-problem">
              <strong>Config problem</strong>
              <p>{server.configError.message}</p>
              <code>{server.configError.code}</code>
            </div>
          ) : !server.configured ? (
            <p className="live-help">
              No dev server is declared for <code>{project.name}</code>.{" "}
              <code>weft.project.json</code> needs <code>devServer.url</code> (and
              optionally <code>devServer.command</code>), or you can attach any
              loopback URL above.
            </p>
          ) : (
            <>
              <div className="server-status">
                <span className={`server-status-dot is-${server.status}`} aria-hidden="true" />
                <strong>{STATUS_LABEL[server.status]}</strong>
                <span className="server-mode">
                  {server.mode === "attach" ? "attach" : "managed"}
                </span>
              </div>
              {server.url && (
                <>
                  <code className="server-url">{server.url}</code>
                  {server.status === "running" && server.url !== frontend.url && (
                    <button
                      type="button"
                      className="button live-use-server"
                      onClick={() => {
                        setDraftUrl(server.url ?? "");
                        if (server.url) source.attachFrontend(server.url);
                      }}
                      disabled={source.frontendBusy}
                    >
                      Use running project server
                    </button>
                  )}
                </>
              )}
              {server.pid !== null && (
                <div className="server-meta">
                  pid {server.pid}
                  {server.startedAt
                    ? ` · started ${new Date(server.startedAt).toLocaleTimeString()}`
                    : ""}
                </div>
              )}
              <div className="server-actions">
                {running || starting || stopping ? (
                  <button
                    type="button"
                    className="button"
                    disabled={serverBusy || stopping}
                    onClick={() => onStopServer(project.path)}
                  >
                    {stopping ? "Stopping…" : "Stop server"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button is-primary"
                    disabled={serverBusy}
                    onClick={() => onStartServer(project.path)}
                  >
                    {serverBusy
                      ? "Working…"
                      : server.mode === "attach"
                        ? "Attach to server"
                        : "Start server"}
                  </button>
                )}
              </div>
              {server.error && (
                <div className="server-problem">
                  <strong>{server.error.code}</strong>
                  <p>{server.error.message}</p>
                </div>
              )}
              {devError && <div className="server-problem">{devError}</div>}
              <div className="server-logs-head">
                <span>Recent output</span>
                <span>{logs.length === 0 ? "empty" : `last ${logs.length}`}</span>
              </div>
              {logs.length > 0 ? (
                <pre className="server-logs">
                  {logs.map((entry, index) => (
                    <span
                      key={`${entry.at}-${index}`}
                      className={entry.stream === "stderr" ? "is-stderr" : undefined}
                    >
                      {entry.text}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              ) : (
                <p className="live-help">No output yet.</p>
              )}
            </>
          )}
        </section>
      )}

      <div className="live-footnote">
        <span>Capture runs through the same sanitizer as the CLI.</span>
        <span>Only loopback URLs are accepted.</span>
      </div>
    </aside>
  );
}
