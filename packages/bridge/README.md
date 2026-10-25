# @weft/bridge

The local live bridge for Weft. It serves the built browser app, watches a design directory, keeps one Yjs `PageSession` per page, streams file changes to connected browsers, and accepts browser commands. A valid command is applied to the session, written atomically to the changed page file, and broadcast to every client.

It is a **local editor bridge**: commands write page files and declared project dev servers can be started and stopped through the same authenticated API. It is loopback-only, uses a per-run session cookie, and rejects cross-origin browser requests. Presence and the agent contract are still ahead.

## Run

```bash
pnpm build
pnpm weft dev examples/starter.weft
# http://127.0.0.1:5250
```

`pnpm dev` is the static Vite preview (no bridge). `weft dev <design.weft>` opens one design. `weft workspace dev` opens the workspace picker over registered projects.

Options:

```text
--host  Loopback bind host: 127.0.0.1, localhost or ::1 (default 127.0.0.1)
--port  Port (default 5250)
```

Non-loopback hosts are rejected with `host.unsafe`.

The built web app must exist at `apps/web/dist`; `pnpm build` produces it. Set `webDist` in `startBridge` for a different location, or `null` for API/WebSocket-only use.

## Security

- The app page sets a random per-run `weft_session` cookie: `HttpOnly; SameSite=Strict; Path=/`.
- `/api/design`, `/api/live` and `/api/dev` require the cookie. `/api/health` is public but Host-checked.
- The `Host` header must be a loopback host and port; a present `Origin` must match the loopback origin. This blocks DNS rebinding and cross-site browser access.
- WebSocket payloads are capped at 1 MiB.
- Responses carry `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, a restrictive `Content-Security-Policy` and `Permissions-Policy`.
- Restarting the bridge rotates the token; reload open tabs. Non-browser clients must send the cookie.

## Protocol

### HTTP

- `GET /api/design` → `{ revision, manifest, pages: [{ pageId, update }] }`
  - Requires the session cookie. `update` is a base64-encoded Yjs state update for that page.
- `GET /api/health` → `{ ok, revision, pages }`
- `POST /api/open` → `{ designPath }` opens another registered design. Requires the session cookie; paths outside the workspace are rejected. All connected clients receive a fresh `init` with the newly active design.
- `GET /api/dev` → `{ ok, servers }` returns snapshots for every registered project. Requires the session cookie.
- `POST /api/dev/start` → `{ projectPath }` starts a declared managed server, or attaches to an already-running URL when the project has no command. Requires the session cookie and Origin check.
- `POST /api/dev/stop` → `{ projectPath }` stops a managed server process group or detaches from an attached one. Requires the session cookie and Origin check.

### WebSocket: `/api/live`

On connect the server sends:

```json
{
  "type": "init",
  "revision": 1,
  "manifest": { "…": "…" },
  "pages": [{ "pageId": "pg_…", "update": "base64…" }]
}
```

In workspace mode `init` also carries `workspace.file`, `workspace.activeDesignPath`, the registered projects/designs, and `workspace.servers` snapshots. Then the bridge may send:

```json
{ "type": "update", "revision": 2, "pageId": "pg_…", "update": "base64…" }
{ "type": "conflict", "revision": 2, "pageId": "pg_…", "conflicts": [] }
{ "type": "error", "revision": 2, "message": "…" }
{ "type": "dev", "server": { "projectPath": "/abs/project", "status": "running", "…": "…" } }
{ "type": "command", "revision": 2, "pageId": "pg_…", "commandId": "cm_…", "command": {}, "createdNodeIds": [], "actor": {} }
```

Client messages:

```json
{ "type": "ping" }
{ "type": "refresh" }
{
  "type": "command",
  "requestId": "…",
  "pageId": "pg_…",
  "command": { "type": "node.update", "nodeId": "nd_…", "patch": { "x": 10 } },
  "actor": { "id": "browser", "kind": "human", "name": "You" }
}
```

A command produces a `commandResult` for the initiating client containing `ok`, `inverse`, `createdNodeIds`, `commandId`, `revision` and `actor`. A failed command contains `ok: false` and an error code/message. A successful command also broadcasts a `command` message for attribution.

## Reload behavior

- File changes are debounced and wait for write stability.
- Page content changes are ingested into the page session; Yjs updates are broadcast.
- Manifest changes (name, pages, tokens, assets) rebuild every session and broadcast a fresh `init`.
- Invalid writes broadcast an `error` and keep the last good state.
- A browser command writes only the changed page file, atomically. A write failure applies the command inverse to the live session and returns an error. The manifest is never rewritten by the bridge.

## App integration

The web app fetches `/api/design`; if the response is JSON, it:

1. builds `PageSession`s from the page updates;
2. connects to `/api/live`;
3. applies `update` messages and re-materializes pages;
4. shows the project/design picker when the bridge has a workspace;
5. shows a Project server panel that can start, attach to and stop declared dev servers;
6. shows `live`, `connecting` or `offline` in the top bar.

Without a bridge, it falls back to the embedded Vite design and shows `read only`.

## Not here yet

- Page-level commands (page name, background, tokens).
- Extraction and capture allowlists.
- Presence/cursors, team authentication, remote bind.
- Asset and snapshot payload serving.
- Persisted Yjs state or a durable operation log.
- Optimistic concurrency or serialization of simultaneous writers.
- An agent tool contract; agents still use files and the CLI.

## Test

```bash
pnpm --filter @weft/bridge test
```

The suite covers HTTP design/health, session-cookie authorization, cross-origin rejection, loopback-only hosts, workspace listing and switching, rejecting unregistered paths, starting and stopping a declared project server, WebSocket init, live Yjs updates from file writes, browser commands and undo writes, invalid-write recovery, and the missing-web-build error.
