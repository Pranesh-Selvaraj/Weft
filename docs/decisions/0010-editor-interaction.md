# 0010. Editor interaction: selection, inspector, and commands over the bridge

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The live bridge (ADR 0009) streams file changes into the browser, and the command protocol (ADR 0005) already gives every mutation an inverse. What is missing is the part that makes this an editor rather than a viewer: choosing a layer on the canvas, changing its properties, writing those changes through the bridge, and undoing them.

The first editing surface should prove the full loop without becoming a Figma clone:

- select a node by clicking the rendered DOM;
- show its core properties;
- emit the same `PageCommand` as the CLI;
- write the canonical page file atomically;
- stream the Yjs update to every client;
- undo and redo through command inverses;
- keep attribution visible.

## Decision

### 1. Selection is DOM-based

The renderer already emits `data-node-id` and `data-page-id`. A click on the stage walks up to the nearest `[data-node-id]`; a click on the page background clears the selection.

The selection box is measured from the selected node's DOM rect relative to the page rect, divided by the current scale. It lives inside the scaled page coordinate system, so it follows flex layout, rotation bounds, and live updates without a second layout engine. `Escape` clears the selection; `Delete`/`Backspace` removes the selected node when the editor is live and the focus is not in a field.

### 2. The inspector is intentionally small

The right-hand inspector supports:

- name, x, y, width, height, opacity and a solid fill color;
- text content for text nodes;
- delete, undo and redo;
- the last editor, shown as `You · human` or the remote actor.

Values commit on blur or Enter (Cmd/Ctrl+Enter for the text area). Every commit is a `node.update` command, or `node.remove` for delete. The inspector is disabled when the app is static, connecting or offline. It does not yet include a layer tree, drag/resize handles, constraints, typography controls beyond what the schema exposes, or multi-select.

### 3. Commands travel over the existing live channel

Client → bridge:

```json
{
  "type": "command",
  "requestId": "…",
  "pageId": "pg_…",
  "command": { "type": "node.update", "nodeId": "nd_…", "patch": { "x": 10 } },
  "actor": { "id": "browser", "kind": "human", "name": "You" }
}
```

Bridge → the initiating client:

```json
{
  "type": "commandResult",
  "requestId": "…",
  "ok": true,
  "pageId": "pg_…",
  "commandId": "cm_…",
  "inverse": { "type": "node.replace", "node": { "…": "before" } },
  "createdNodeIds": [],
  "revision": 2,
  "actor": { "id": "browser", "kind": "human", "name": "You" }
}
```

Bridge → all clients on success:

```json
{
  "type": "command",
  "revision": 2,
  "pageId": "pg_…",
  "commandId": "cm_…",
  "command": { "…": "applied command" },
  "createdNodeIds": [],
  "actor": { "id": "browser", "kind": "human", "name": "You" }
}
```

The command result carries the inverse back to the initiating client; the broadcast carries attribution. Yjs updates continue to carry the actual document change, so other clients never need to replay the command to converge.

### 4. The bridge is now a writer

For a valid command, the bridge:

1. parses the untrusted command with `readPageCommand`;
2. applies it to the live `PageSession`;
3. writes the changed page file atomically through `writePageFile` (manifest untouched);
4. marks the session baseline as materialized;
5. sends the command result and broadcasts attribution.

If the file write fails, the bridge applies the inverse to the live session and returns an error, so the session does not claim a change that never reached disk. Invalid commands and validation failures return a `commandResult` with `ok: false` and a stable code; they do not tear down the connection.

The watcher still ingests external file changes. A bridge write can trigger a harmless watcher reload with no document changes; revisions may advance without a visible edit.

### 5. Undo and redo are client-side command stacks

The initiating client keeps two stacks of `{ pageId, command, label }`:

- a successful normal command pushes its inverse onto undo and clears redo;
- undo pops the inverse, sends it, and pushes the result's inverse onto redo;
- redo pops that command, sends it, and pushes the result's inverse back onto undo;
- history is cleared on init/reconnect, because the sessions are rebuilt and old inverses may no longer apply.

This keeps the design file free of history, matches the command protocol, and works for agent/file edits indirectly: they update the canvas but are not in the browser's undo stack. The CLI still returns inverses for agents; the bridge does not persist a global command log yet.

### 6. Attribution is local and explicit

The browser sends `actor: { id: "browser", kind: "human", name: "You" }`. The bridge echoes it in the result and broadcast; the app shows the last actor. Agent commands over the same channel can send their own actor. There is no authentication, identity system or durable audit log yet; this is localhost attribution, not a security boundary.

## Consequences

**Easier**

- A browser user can select a layer, edit core properties, write the page to disk, and undo or redo without leaving the app.
- Browser edits use the exact commands the CLI and agents use; there is no second mutation model.
- The bridge now proves the end-to-end write path: command → session → atomic page file → Yjs update → browser.
- Failure of a disk write rolls the live session back via the inverse.
- Live file edits from the CLI or an agent still appear while the inspector is open.

**Harder, and knowingly accepted**

- The inspector is a small property sheet. No drag/resize, layer tree, multi-select, components, constraints, typography suite, or page-level commands.
- History is per browser tab, in memory, and cleared on reconnect. It does not include external file writes, CLI commands, or other clients' edits.
- Multiple simultaneous writers are merged by Yjs for the live state, but each command writes the page file from its materialized result. The last write to disk wins; there is no optimistic concurrency check or server-side serialization of writes. This is acceptable for a local single-user bridge, not for a team.
- A watcher reload caused by the bridge's own write can advance revisions without a visible change.
- The fill editor replaces the fill stack with one solid color; gradients and image paints are not editable in the inspector.
- Selection is DOM-based and scales with the page; the label can clip at the page edge. Text inside captured snapshots is intentionally not clickable until snapshot interaction is designed.
- No page-level commands. Renaming a page, changing the background or tokens still requires a file edit/CLI.
- No auth, permissions, presence or remote bind. Any local client that can connect can send commands.
- The app bundle grows slightly (still ~111 KB gzipped at this slice) and the bridge now has a write path to secure and test.
- The inspector's drafts are local; a field being edited may not reflect a concurrent remote change until focus leaves the inspector.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Keep the bridge read-only and edit locally in Yjs only** | It would look live but never persist; the product's premise is that the file is canonical. |
| **Write the whole design on every command** | Rewrites unrelated pages and the manifest, creates noisy file events, and risks clobbering concurrent external edits. Writing one page atomically is smaller and safer. |
| **Server-side undo stack in the bridge** | Centralizes history but loses the per-client semantics, requires a durable operation log, and does not match the command/inverse protocol the CLI already uses. Client stacks are enough for the first editor. |
| **Store history in the design file** | Bloats the durable artifact with transient state and makes review noisy. History belongs in the client for now. |
| **Selection with a custom hit-testing canvas** | Would duplicate the DOM layout tree and diverge from what the user sees. `data-node-id` plus DOM rects is simpler and accurate. |
| **Full inspector with drag/resize and layer tree first** | Much larger surface and not necessary to prove the write/undo loop. Core properties are enough to validate the interaction model. |
| **Wait for the full agent contract before allowing browser commands** | Agents and browsers use the same commands; waiting would delay the core product loop. The agent contract adds discovery, tools and permissions around this channel. |
| **Authenticate the local WebSocket now** | Localhost-only and no remote bind; auth adds setup friction before identity and multi-user semantics exist. It is a prerequisite for any non-local bridge. |

## Prior art / what this replaces

There was no browser editing before this record. ADR 0009 made the bridge a live viewer; this record makes it a writer and gives the app selection, an inspector, command transport, attribution and inverse-based undo. The next decision is the agent-facing contract: discovery, tools and permissions around the same command channel.
