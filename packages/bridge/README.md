# @weft/bridge

The local live bridge for Weft. It serves the built browser app, watches a design directory, keeps one Yjs `PageSession` per page, and streams file changes to connected browsers over WebSocket.

It is **read-only** in this slice: it observes files and streams state. It does not accept browser edits or write canonical files yet.

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
```

Client messages accepted today:

```json
{ "type": "ping" }
{ "type": "refresh" }
```

## Reload behavior

- File changes are debounced and wait for write stability.
- Page content changes are ingested into the page session; Yjs updates are broadcast.
- Manifest changes (name, pages, tokens, assets) rebuild every session and broadcast a fresh `init`.
- Invalid writes broadcast an `error` and keep the last good state.
- The bridge never writes files.

## App integration

The web app fetches `/api/design`; if the response is JSON, it:

1. builds `PageSession`s from the page updates;
2. connects to `/api/live`;
3. applies `update` messages and re-materializes pages;
4. shows `live`, `connecting` or `offline` in the top bar.

Without a bridge, it falls back to the embedded Vite design and shows `read only`.

## Not here yet

- Browser commands, selection or editing.
- Writing canonical files.
- Presence/cursors, auth, remote bind.
- Asset and snapshot payload serving.
- Persisted Yjs state or an operation log.

## Test

```bash
pnpm --filter @weft/bridge test
```

The suite covers HTTP design/health, WebSocket init, a live Yjs update from a file write, invalid-write recovery, and the missing-web-build error.
