# 0012 · Declared project dev servers

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Local workspace / process control

## Context

Weft's next product loop needs the running product, not only the design file. Extraction will capture a page from a local app, and a designer should be able to start that app from the same place they opened the design. The workspace registry already answers *which project roots may Weft touch?*; it does not answer *what command starts this project?*

Running arbitrary commands from a browser endpoint would be a remote-code-execution surface even on loopback. Guessing from `package.json` scripts would couple Weft to one ecosystem and would still execute code the user did not explicitly declare. Requiring a separate terminal works, but it makes the first-run experience fragile and leaves Weft unable to say whether a project is actually ready.

## Decision

A registered project may declare one development server in `weft.project.json` at its root:

```json
{
  "version": 1,
  "devServer": {
    "url": "http://127.0.0.1:3000/",
    "command": ["pnpm", "dev"],
    "cwd": ".",
    "env": { "PORT": "3000" },
    "readyTimeoutMs": 30000,
    "stopTimeoutMs": 5000
  }
}
```

- `url` is required, must be an explicit loopback HTTP(S) URL (`127.0.0.1`, `localhost` or `::1`), and must not contain credentials or a fragment.
- `command` is an optional **argv array**. When it is present, Weft starts a managed server in its own process group. When it is absent, the server is attach-only: the user starts it, and Weft probes the URL.
- `cwd` is relative to the project root by default, is checked lexically against the root during config validation, and is resolved through `realpath` again at start time so a symlink cannot escape.
- `env` is an explicit string map merged over the bridge's environment. There is no implicit `.env` loading.
- `readyTimeoutMs` and `stopTimeoutMs` bound startup and graceful shutdown.
- Spawning uses `shell: false`. The bridge never accepts a command from HTTP or WebSocket input; only the declared argv is executed.
- Readiness means the URL answered with an HTTP status below 500. A 401, 403 or 404 still proves that something is listening; a 5xx is treated as not ready.
- Each registered project can have one server. The manager keeps a per-project state machine (`stopped`, `starting`, `running`, `stopping`, `error`), a bounded log ring, and emits snapshots to the bridge for the browser panel.
- On POSIX, the child is started detached and stopped by signalling its process group with `SIGTERM`, waiting up to `stopTimeoutMs`, then sending `SIGKILL` to the group. On Windows, `taskkill /T /F` closes the tree. Closing the bridge stops every managed server.
- `weft.project.json` is read as a regular file with a 64 KiB cap and is rejected if it is a symlink. An invalid config is reported in the workspace payload instead of preventing the bridge from starting.
- Start and stop are authenticated bridge operations. `GET /api/dev` also requires the session cookie because logs can contain application data. `/api/dev/start` and `/api/dev/stop` require the same cookie, Host/Origin checks and JSON body limit as `/api/open`.
- The browser exposes a Project server panel for the active workspace project. The panel links to the declared URL, shows status and recent logs, and offers Start/Attach and Stop. This is the only user interface added by this decision.

## Why this shape

The declaration is the approval boundary. Adding a project and writing a config is a deliberate act by the same user who can run the command in a terminal; the browser can only ask Weft to execute what is already written there. Attach-only mode keeps projects that manage their own server (Docker Compose, a separate terminal, a remote tunnel) usable without inventing a command.

Loopback-only URLs are not a claim that the target is safe; they are the narrowest useful contract for a local first bridge. The URL is used only for readiness and a link, not as a general fetch proxy.

The process group matters because a dev server is usually a package-manager process with a compiler and a browser-sync child. Killing only the direct child leaves ports occupied and watch processes alive. The manager therefore keeps the group id after the leader exits and force-kills the group as a final step.

## Consequences

- The project config is trusted code. A command can do anything the user can do; there is no sandbox, CPU/memory limit, network policy or filesystem jail at this stage. This is documented in the security model rather than implied.
- Weft does not install dependencies, choose a package manager or infer a dev script. A project that needs `pnpm install` first must say so in its own documentation or command.
- Attach-only mode cannot prove ownership. Stopping an attached server only detaches Weft; the external process keeps running.
- Readiness does not verify the application's meaning. A login redirect, a 404 route and a 500 page are interpreted by the simple status rule; extraction will need its own page-level checks.
- POSIX process-group semantics are stronger than Windows tree termination. A process that deliberately creates a new session can escape both, as with any local supervisor.
- Logs are a bounded in-memory ring, not a persisted log file. Secrets printed by a dev server remain in that ring until the bridge closes.
- The bridge now owns long-running children. Closing it must remain orderly; a crash can leave a detached server running, which the user can see and stop.

## Alternatives considered

- **Run an arbitrary command posted by the browser.** Rejected: that is remote code execution with a friendly UI, even when bound to loopback.
- **Infer a command from `package.json`, Cargo, Make or Procfile.** Rejected for v1: heuristics silently run scripts the user did not choose and create a large cross-ecosystem surface. A declaration is simpler and auditable.
- **Require a terminal for every start.** Kept as attach-only mode, but not as the only path; it leaves the product unable to coordinate readiness or eventually extraction.
- **Start through a shell string.** Rejected: quoting, injection and cross-platform behaviour become ambiguous. Argv arrays are explicit and shell-free.
- **Treat any HTTP response as ready.** Rejected: a 5xx response often means the framework started but the app failed. Treating it as not ready gives the user a useful error instead of a broken capture.
- **A separate daemon for process supervision.** Rejected for this slice: the bridge already owns the workspace lifetime and is the natural place to stop children on close. Extraction can reuse the manager without a second daemon.

## Follow-ups

- Extraction should use the active project's running server only after a page-level readiness check and an explicit capture allowlist.
- Add resource limits or a supervised worker if Weft starts running untrusted project configs or remote agents.
- Persist bounded logs if users need to inspect a crashed server after the bridge restarts.
- Add dependency installation as an explicit, declared lifecycle command rather than a hidden side effect.
