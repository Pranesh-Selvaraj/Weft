# 0009. Local bridge: watched files, HTTP, and Yjs over WebSocket

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The read-only preview embeds a design through a Vite virtual module. That proves rendering, but it does not prove the product loop: a person or agent changes a design file and the browser reflects it without a rebuild.

`@weft/session` already owns the reconciliation semantics. What is missing is a local process that:

- serves the built browser app without a native shell;
- watches a chosen design directory;
- turns whole-page file writes into live session updates;
- streams those updates to every connected browser;
- stays local-first and does not require a database or cloud service.

The bridge is also the future file writer and agent transport, so this slice must establish the HTTP and WebSocket shape without yet accepting edits.

## Decision

### 1. `@weft/bridge` is a local Node process

The bridge:

- serves the built web app from `apps/web/dist` (configurable; `webDist: null` for API-only tests);
- watches the design directory with chokidar;
- owns one `PageSession` per page;
- ingests whole-page file writes through `PageSession.ingestPage`;
- broadcasts the resulting Yjs updates;
- reports conflicts and invalid writes without discarding the last good state;
- binds to `127.0.0.1` by default and requires no auth for this local-only slice.

It does **not** write canonical files or accept commands yet. It is a live viewer over `@weft/session`.

### 2. HTTP for bootstrap, WebSocket for live state

- `GET /api/design` returns the manifest, the current revision, and a base64 Yjs update per page.
- `GET /api/health` returns readiness, revision and page count.
- `GET /api/live` upgrades to a WebSocket. On connect the server sends an `init` message with the same payload. Later it sends `update`, `conflict` and `error` messages, each carrying the current revision.
- The client may send `ping` or `refresh`.

Yjs updates are binary, but the transport uses JSON with base64 payloads. That is easier to inspect and debug than a binary framing protocol and more than fast enough for design-sized pages in a local process. The transport can switch to binary frames later without changing the session or document semantics.

The WebSocket is bidirectional from day one because editing will use it. This slice only uses the server-to-client direction.

### 3. Reload semantics

- A file event is debounced and merged through an `awaitWriteFinish` window.
- If only page content changed, every page is ingested into its session. The live page wins conflicts and the bridge broadcasts an `update`; conflicts are broadcast separately.
- If the manifest changed (name, pages, tokens, assets), the bridge rebuilds all sessions and sends a fresh `init`. This is deliberately coarse: manifest changes are rare, and rebuilding avoids partial token/page-set states.
- If a read or validation fails, the bridge broadcasts an `error` and keeps the last good live state.
- The bridge does not write the file, so the CLI and agents remain the writers for now.

A revision number increments on each accepted reload. It is informational for this slice; it is not an optimistic-concurrency token yet.

### 4. `weft dev` starts the live bridge

`weft dev <design.weft>` starts the bridge, prints the URL, and blocks until `Ctrl+C`. Defaults are `127.0.0.1:5250`. The built web app is required, so the documented path is `pnpm build` once, then `weft dev`.

The app detects a bridge by fetching `/api/design` and checking for a JSON response:

- with a bridge, it builds `PageSession`s from the page updates, connects to `/api/live`, applies updates, and shows a live/connecting/offline badge;
- without a bridge (Vite dev or a static build), it keeps the embedded virtual module and shows `read only`.

This keeps the static preview useful and makes the live mode additive.

### 5. Assets and snapshots remain placeholders

The bridge serves the built app and Yjs page data, not asset bytes or snapshot payloads. The renderer already accepts an asset URL resolver and snapshot payload map; wiring those endpoints is part of the extraction/asset pipeline, not this live transport slice.

## Consequences

**Easier**

- Editing a design file with the CLI or any agent now updates the open browser through the shared Yjs session, without a rebuild.
- The live loop uses the same reconciliation engine the editor will use; there is no second concurrency model.
- The app works in both modes: static preview with no process, live preview with `weft dev`.
- The bridge is small, local and dependency-light (`chokidar`, `ws`, workspace packages).
- Invalid writes are visible and do not destroy the last good state.

**Harder, and knowingly accepted**

- The bridge is a viewer, not a writer. Browser edits and agent commands over WebSocket are the next slice.
- Base64 JSON framing adds overhead; fine for local design pages, not a remote-scale transport.
- Manifest changes rebuild every session and send a full init. Content changes are incremental, but page-set/tokens changes are coarse.
- There is no authentication, authorization or remote bind. The bridge is localhost-only by design.
- There is no persistence of Yjs state; the files remain canonical and the sessions are rebuilt on start.
- The app bundle grows by Yjs and the session layer (about 350 KB raw, 108 KB gzipped at this slice).
- `weft dev` requires a built web app. Vite remains the development server for the app itself; the bridge serves the production build.
- Asset and snapshot payload serving is not implemented; images and captures remain placeholders.
- Revisions are informational. A future command protocol needs expected revisions or a CRDT-safe write path; the session already provides the latter for file ingestion.
- The watcher can observe transient partial state; `awaitWriteFinish` plus atomic CLI writes mitigate it, and validation errors keep the last state.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Keep the Vite virtual module only** | Requires a rebuild for every design change and cannot stream agent edits. It was a preview shortcut, not the product loop. |
| **Poll `/api/design` over HTTP** | Simpler, but adds latency, repeated full payloads, and no natural channel for future bidirectional editing. |
| **Broadcast full design JSON on every change** | Easy, but loses Yjs merge semantics and sends every page for a one-node edit. Updates are smaller and already computed by the session. |
| **Binary WebSocket framing now** | Faster and cleaner at scale, but harder to inspect during the first live loop. JSON is adequate locally; the framing is replaceable. |
| **Server-sent events** | One-way only; editing needs a bidirectional channel. WebSocket covers both. |
| **Build the bridge into the Vite dev server** | Ties the user-facing runtime to the app's development tooling and leaves no standalone `weft dev`. |
| **Start with browser editing before live file transport** | Mixes two failure domains and leaves agent/file changes untested. The file-to-browser loop is the smaller, higher-risk-first slice. |
| **Add auth and remote bind now** | Premature for a localhost-only bridge; it adds setup friction before the editing contract exists. |
| **Write canonical files from the bridge now** | The bridge is read-only until commands and attribution are designed. Letting it write without that contract would create a second, under-specified writer. |

## Prior art / what this replaces

There was no local bridge before this record. The virtual module was a static preview; this record turns `@weft/session` into the live loop that the editor, agents and eventual file writer will share. The next decision is the editing interaction model; the bridge is the transport it will use.
