# Live session panel and local frontend capture

The top bar always has a **Live** button on a live bridge (or **Preview** for the static build). It shows the host currently in use and opens the live-session panel. The panel answers three questions: what is running, what design/project it points at, and which local frontend you are working against.

## Endpoints

| Row | Meaning |
| --- | --- |
| **This editor** | The browser origin serving the editor. |
| **API base** | The bridge API root (`<bridge>/api`). |
| **Health check** | `GET <bridge>/api/health` — unauthenticated liveness and page count. |
| **Live socket** | The WebSocket endpoint used for commands and Yjs updates. |
| **Design file** | Absolute path of the active design directory. |
| **Workspace** | Registry file when the bridge was started in workspace mode. |
| **Project root** | The registered project that owns the active design, when known. |

The panel reads these from the bridge's `bridge` runtime object, not from guesses. Each value has a **Copy** button. The static preview shows only its browser origin and explains how to start a live bridge.

The panel also shows the active project server separately: declared URL, managed/attach mode, pid, recent stdout/stderr, start/stop, and a **Use running project server** shortcut.

## Attach a frontend URL

Enter a complete URL such as `http://127.0.0.1:3000/` and choose **Use frontend**.

The bridge, not the browser, probes it:

- schemes must be `http` or `https`;
- the host must literally be `127.0.0.1`, `localhost` or `::1`;
- credentials and fragments are rejected;
- the reachability probe targets only the validated origin root (not the path or query), does not follow redirects and cancels response bodies;
- any HTTP status below 500 counts as reachable, so 401/403/404 behind a router or login still attach;
- a timeout or connection failure is shown as an error with a code.

The URL is kept in the bridge session and in this browser's `localStorage`. After a reload it is reattached automatically. It is never written into `weft.project.json`, the design, or git. **Detach** clears both the bridge target and the saved value.

The panel can open the target in a new tab or show it in a sandboxed iframe. Preview is a cross-origin iframe with no postMessage bridge; if the target blocks framing with `X-Frame-Options` or `frame-ancestors`, the preview is blank and **Open** is the fallback.

## Capture the frontend as a snapshot

With a reachable frontend attached, choose the active page, optionally enter a CSS selector (for example `main`), and press **Capture page**.

- The capture viewport defaults to the selected top-level frame, or the first root frame, and is bounded to 1–20,000 px.
- The bridge re-probes the frontend before launching Chromium.
- The exact attached origin is the capture allowlist for this action. The CLI still requires `extract.origins` in `weft.project.json`; the live panel's explicit attach is a separate, session-scoped approval.
- The normal extraction pipeline runs: fresh headless context, loopback request/WebSocket gate, computed-style capture, asset inlining, browser sanitizer, fail-closed Node verifier, and sandboxed rendering.
- Snapshot payload files are written first; the page is written last; the bridge reloads from disk and the new snapshot is selected on the canvas.
- Warnings (external fonts, blocked assets, oversized payloads) are shown in the panel.

Capture is static. Re-run it when the frontend changes; it does not make the snapshot live and it is not part of the command undo history. The CLI extractor behaves the same way.

## Project-server versus frontend target

They are separate:

- A **project server** is declared in `weft.project.json` and can be started/stopped by the registered project. Only the declaration supplies the argv command.
- A **frontend target** is a URL that is already running. Attaching it never launches a process. You can use the running project server's URL as the frontend target with one click.

## HTTP API

All routes require the bridge session cookie. `POST`/`DELETE` also pass the bridge Host and Origin checks.

```text
GET    /api/frontend             current frontend snapshot
POST   /api/frontend             { "url": "http://127.0.0.1:3000/" }
DELETE /api/frontend             detach and return to idle
GET    /api/frontend/preview     cookie-authenticated 302 to the attached URL
POST   /api/frontend/capture     { pageId, selector?, viewport?, name? }
```

Capture returns `{ ok, capture: { nodeId, pageId, pageFile, warnings } }`. Errors carry a stable code such as `frontend.loopback`, `frontend.unreachable`, `frontend.capture-busy` or `extract.origin`.

## Security boundary

- The bridge is still loopback-only and rejects non-loopback bind hosts.
- Frontend URLs are loopback literals; no arbitrary internet URLs, redirects, credentials or proxy requests.
- No command, executable or environment variable ever comes from the URL field.
- The iframe is sandboxed; preview has no script access to Weft and no shared auth token.
- Capture reuses the extraction sanitizer and verifier; captured content remains untrusted data for agents.
- This is a local tool, not a sandbox. Attaching a local URL can probe a service you name, and capturing executes that app's own scripts in a fresh browser context.

See [ADR 0027](decisions/0027-live-endpoints-frontend-capture.md), [extraction](extraction.md), [declared dev servers](dev-server.md) and the [security model](security.md).
