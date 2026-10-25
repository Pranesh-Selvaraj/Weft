import type { DevServerSnapshot } from "./live";

interface ServerPanelProps {
  project: { path: string; name: string };
  server: DevServerSnapshot | undefined;
  busy: boolean;
  error: string | null;
  onStart(): void;
  onStop(): void;
  onClose(): void;
}

const STATUS_LABEL: Record<DevServerSnapshot["status"], string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  error: "Error",
};

export function ServerPanel({
  project,
  server,
  busy,
  error,
  onStart,
  onStop,
  onClose,
}: ServerPanelProps) {
  const running = server?.status === "running";
  const starting = server?.status === "starting";
  const stopping = server?.status === "stopping";
  const logs = server?.logs.slice(-18) ?? [];

  return (
    <aside className="server-panel" aria-label="Project server">
      <div className="server-head">
        <div>
          <span className="eyebrow">Project server</span>
          <h2>{project.name}</h2>
          <code className="server-path">{project.path}</code>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close project server panel"
        >
          ×
        </button>
      </div>

      {!server ? (
        <p className="server-note">The project server state has not loaded yet.</p>
      ) : server.configError ? (
        <div className="server-problem">
          <strong>Config problem</strong>
          <p>{server.configError.message}</p>
          <code>{server.configError.code}</code>
        </div>
      ) : !server.configured ? (
        <div className="server-note">
          <p>No dev server is declared for this project.</p>
          <p>
            Add <code>weft.project.json</code> at the project root with a{" "}
            <code>devServer.url</code> and, optionally, a{" "}
            <code>devServer.command</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="server-status">
            <span className={`server-status-dot is-${server.status}`} aria-hidden="true" />
            <strong>{STATUS_LABEL[server.status]}</strong>
            <span className="server-mode">{server.mode === "attach" ? "attach" : "managed"}</span>
          </div>

          {server.url && (
            <a className="server-url" href={server.url} target="_blank" rel="noreferrer">
              {server.url}
            </a>
          )}

          {server.pid !== null && (
            <div className="server-meta">
              pid {server.pid}
              {server.startedAt ? ` · started ${new Date(server.startedAt).toLocaleTimeString()}` : ""}
            </div>
          )}

          <div className="server-actions">
            {running || starting || stopping ? (
              <button
                type="button"
                className="button"
                disabled={busy || stopping}
                onClick={onStop}
              >
                {stopping ? "Stopping…" : "Stop server"}
              </button>
            ) : (
              <button
                type="button"
                className="button is-primary"
                disabled={busy}
                onClick={onStart}
              >
                {busy
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
          {error && <div className="server-problem">{error}</div>}

          <div className="server-logs-head">
            <span>Logs</span>
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
            <p className="server-note">No output yet.</p>
          )}
        </>
      )}
    </aside>
  );
}
