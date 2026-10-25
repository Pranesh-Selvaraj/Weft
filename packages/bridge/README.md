# @weft/bridge

The local live bridge for Weft. It serves the built browser app, watches a design directory, keeps one Yjs `PageSession` per page, streams file changes to connected browsers, and accepts browser commands. A valid command is applied to the session, written atomically to the changed page file, and broadcast to every client.

It is a **local editor bridge**: commands write page files, but manifest/token edits, auth, presence and the agent contract are still ahead.

## Run

```bash
pnpm build
pnpm weft dev examples/starter.weft
# http://127.0.0.1:5250
```

`pnpm dev` is the static Vite preview (no bridge). `weft dev <design.weft>` is the live bridge over the built app.

Options:

```text
--host  Bind host (default 127.0.0.1)
--port  Port (default 5250)
```

The built web app must exist at `apps/web/dist`; `pnpm build` produces it. Set `webDist` in `startBridge` for a different location, or `null` for API/WebSocket-only use.

## Protocol

### HTTP

- `GET /api/design` → `{ revision, manifest, pages: [{ pageId, update }] }`
  - `update` is a base64-encoded Yjs state update for that page.
- `GET /api/health` → `{ ok, revision, pages }`

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

Then it may send:

```json
{ "type": "update", "revision": 2, "pageId": "pg_…", "update": "base64…" }
{ "type": "conflict", "revision": 2, "pageId": "pg_…", "conflicts": [] }
{ "type": "error", "revision": 2, "message": "…" }
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
4. shows `live`, `connecting` or `offline` in the top bar.

Without a bridge, it falls back to the embedded Vite design and shows `read only`.

## Not here yet

- Page-level commands (page name, background, tokens).
- Presence/cursors, auth, remote bind.
- Asset and snapshot payload serving.
- Persisted Yjs state or a durable operation log.
- Optimistic concurrency or serialization of simultaneous writers.
- An agent tool contract; agents still use files and the CLI.

## Test

```bash
pnpm --filter @weft/bridge test
```

The suite covers HTTP design/health, WebSocket init, live Yjs updates from file writes, browser commands and undo writes, invalid-write recovery, and the missing-web-build error.
