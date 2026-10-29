# 0027 · Live endpoints panel and frontend capture

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** UI / local bridge
- **Extends:** ADRs 0011, 0012, 0013, 0019

## Context

The live bridge had addresses that existed only in the terminal: the editor port, design path, WebSocket path, and a declared project server. The browser could start that declared server, but there was no single place that said what was actually running. There was also no way to point Weft at another already-running local frontend and use it in the design workflow, even though extraction already knew how to capture a loopback page into a sanitized snapshot.

The user asked for a clear settings/live panel with the current endpoint, an input for a running local frontend URL, and a way to use that frontend for design work.

## Decision

### 1. The bridge describes its own runtime

Every live `init` and `/api/design` payload now includes a `bridge` object with:

- the actual bridge URL, host and bound port;
- the absolute design directory and design name;
- the active workspace file and project root/name when the bridge is in workspace mode.

The top bar always exposes a **Live** button showing the host actually in use (or **Preview** for a static build). It opens a panel listing the editor URL, API base, health check, live socket, design path, workspace and project root, each copyable. This is descriptive runtime state, not secret material: the bridge is loopback-only and the panel is served by the same origin.

### 2. Attach an arbitrary loopback frontend

The panel accepts a full `http`/`https` URL with a loopback host (`127.0.0.1`, `localhost` or `::1`). URLs with credentials, fragments, non-HTTP schemes or non-loopback hosts are rejected. The bridge probes with a no-redirect GET, cancels the response body and treats any status below 500 as reachable. It does not proxy the app, inject auth or start a process.

The attached target is session state in the bridge. The URL is saved in browser `localStorage` and reattached after a reload; it is never written into `weft.project.json` or the design. Detaching clears both.

The app can preview the target in a sandboxed cross-origin iframe. The iframe allows the frontend's own scripts/forms but is not same-origin with Weft and has no postMessage bridge. If the target sends framing restrictions, the panel tells the user to use **Open** instead.

### 3. Capture the attached frontend

`POST /api/frontend/capture` captures the attached URL into the current page as a snapshot node. It accepts only a page id, optional CSS selector, optional name and a bounded viewport. The URL never comes from the capture request; it comes from the attached target.

The exact attached origin is passed to the existing extraction pipeline as an explicit allowlist. This is the same approval idea as `extract.origins`, but scoped to the user's explicit attach action: the CLI still requires project config, while the bridge does not force the user to edit `weft.project.json` before trying a URL. `extractSnapshot` still validates the URL, captures through the sanitizer, writes payload files first and the page last.

Capture re-probes the frontend, rejects unreachable targets, serializes concurrent captures, and reloads the bridge from disk before returning so clients receive the new node. The live panel selects the resulting snapshot and displays capture warnings. Capture output is static; re-run it after the frontend changes.

### 4. Keep declared servers separate

Entering a frontend URL never supplies a command. Managed project servers remain governed by ADR 0012: only a registered project's `weft.project.json` can declare an argv command, and the browser can only start/stop that declaration. The panel shows the active project server's status, pid, URL, logs and supports using its URL as the frontend target.

## Consequences

**Easier**

- One discoverable place answers "what is running, on which endpoint, with which design and project?"
- A designer can attach the app they are already running, preview it, and capture the real page without leaving Weft.
- The capture path reuses the existing sanitizer and snapshot renderer instead of adding a second renderer or a screenshot shortcut.
- URLs persist per browser without mutating project files.

**Harder, and knowingly accepted**

- Frontend attachment is session-scoped on the bridge and browser-scoped for persistence; another browser starts with no target.
- The preview is a cross-origin iframe, so framing/auth/third-party-cookie policies may make it blank; **Open** remains the fallback.
- Capture changes the design outside the command history. It is reloaded from disk and is not undoable with Cmd/Ctrl+Z, exactly like the CLI extractor; a future version should expose capture as a command.
- The bridge accepts a new SSRF-shaped surface for loopback literals only. It can probe local ports the user explicitly names, but never follows redirects or reads response bodies.
- Snapshot capture is static and expensive (it launches Chromium); there is no live DOM sync.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Only show the terminal's `weft dev` URL** | The browser already knows its origin; it does not know the design path or project server state. |
| **Require `weft.project.json` before any frontend attach** | Too much friction for a local URL the user is already running; explicit attach is a narrower approval than writing project config. |
| **Embed the frontend as the canvas** | Cross-origin DOM cannot be measured or edited; capture into the canonical document is honest. |
| **Take a screenshot instead of DOM/CSS** | Loses readable structure, sanitizer guarantees and agent-readable content. |
| **Persist the target in the project config** | Browser-triggered project mutation would widen the approval boundary and create unexpected diffs. |
| **Auto-start a frontend from a URL** | URL-only attach must never become process launch; declared commands stay behind project config. |

## Follow-ups

- A live-capture command in the undo model.
- Native editing of captured content and an explicit "replace snapshot" flow.
- Persist a per-project frontend target in a local private settings store.
- Periodic health monitoring and a proper device-width preview.
- Audit log for attach/capture actions.
