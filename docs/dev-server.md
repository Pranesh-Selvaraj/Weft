# Declared project dev servers

Weft can start and stop the development server for a registered workspace project, show whether it is ready, and stream recent output into the browser. The command is always declared by the project; the browser cannot supply one.

## Declare a server

Create `weft.project.json` at the project root:

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

`url` is required. `command`, `cwd`, `env`, `readyTimeoutMs` and `stopTimeoutMs` are optional. The command is an argv array, not a shell string:

```json
{ "command": ["pnpm", "run", "dev", "--", "--host", "127.0.0.1"] }
```

### Attach without a command

Omit `command` when the app is already running or is managed by another tool:

```json
{
  "version": 1,
  "devServer": { "url": "http://127.0.0.1:3000/" }
}
```

Start the app yourself, then choose **Attach to server** in the Live panel's project-server section. Weft probes the URL and marks it running. **Stop** only detaches; it never kills a process it did not start.

## Start it

1. Register the project root with `weft workspace add <project>` if it is not registered.
2. Start the workspace bridge: `weft workspace dev`.
3. Select a design from the project, open **Live** in the top bar, then **Start server**.
4. The panel shows the declared URL, status, pid and recent stdout/stderr. The design canvas remains usable while the server runs. **Use running project server** attaches that URL as the frontend target.
5. **Stop server** terminates the managed process group. Closing the bridge stops every managed server.

The bridge exposes the same operations over HTTP for automation:

```text
GET  /api/dev              current snapshots for all registered projects
POST /api/dev/start        { "projectPath": "/abs/project" }
POST /api/dev/stop         { "projectPath": "/abs/project" }
```

All three require the bridge session cookie. The start and stop routes also apply the bridge's Host and Origin checks. `projectPath` must be a registered project root; request bodies are capped at 64 KiB.

## What "ready" means

Weft polls `devServer.url` until it receives an HTTP response with a status below 500. A 404 or 401 still proves that a server is listening; a 5xx is treated as not ready because the application may have failed after binding the port. Readiness stops at `readyTimeoutMs`.

If the managed command exits before readiness, Weft reports the exit code and the captured output. If it exits later, the panel moves to `error` (or `stopped` for exit code 0) and keeps the log ring available until the next start.

## Process lifecycle

- The child runs with `shell: false`, the declared cwd and `{ ...process.env, ...devServer.env }`.
- On POSIX the child is a process-group leader. Stop sends `SIGTERM` to the group, waits `stopTimeoutMs`, then sends `SIGKILL` to the group even if the leader already exited, so package-manager and compiler children do not survive.
- On Windows, `taskkill /pid <pid> /T /F` terminates the tree.
- Logs are an in-memory ring of at most 200 entries, clipped per line and trimmed to the most recent 100 in snapshots. They are not written to disk.
- Only one server per project is managed at a time. Different projects may run servers concurrently if their ports allow it.

## Security boundary

- A registered project root and its `weft.project.json` are the allowlist. The bridge never accepts an executable or argument list from the browser.
- `url` must be loopback HTTP(S), with no credentials or fragment. This is for readiness and a user-facing link, not a general proxy.
- The command uses argv spawning, not a shell, so config values cannot become shell syntax.
- `cwd` must stay inside the project root lexically; at start it is resolved through `realpath` so a symlinked directory cannot escape. The config file itself is read as a regular file, rejects symlinks and is capped at 64 KiB.
- An invalid config is reported in the workspace payload; it does not stop the design bridge from loading.
- `/api/dev` and the start/stop routes require the session cookie; start/stop also require the Origin check.
- This is a local supervisor, not a sandbox. A declared command can do anything the user can do: read any file, make network requests, install packages or start other processes. There are no CPU, memory, network or filesystem limits, and logs may contain secrets printed by the app. Only declare commands you trust.

## Current limits

- No dependency installation, package-manager detection or automatic retry.
- No persisted logs, resource limits, port allocation, multiple servers per project or health-path configuration yet. The live panel can attach an already-running URL for preview/capture without declaring it as a managed server.
- Attach mode does not monitor the external process after the initial probe.
- A bridge crash can leave a detached POSIX process group running. Stop it in a terminal if that happens.
- Extraction is a later branch. The dev server is exposed first so the capture work can rely on a running, declared local app.
