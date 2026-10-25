# 0015 · Page-level document commands

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Contract / document model
- **Extends:** ADR 0005, ADR 0014

## Context

ADR 0014 added node creation and a layer tree, but a designer still could not make a new page from the browser. Page creation and deletion change the manifest and the set of page files, not just one page's node map. They need their own command, inverse and file-write transaction; pretending they are page commands would make the bridge and CLI pretend a page exists before its file does.

The product rule remains: both the browser and agents use one documented mutation model, every mutation carries attribution, and undo is driven by a computed inverse rather than a hidden snapshot of the whole design.

## Decision

### 1. A separate `DocumentCommand`

`@weft/core` gains a document-level command union:

```ts
type DocumentCommand =
  | { type: "page.create"; page: PageDocument; file: string; index?: number }
  | { type: "page.remove"; pageId: string };
```

`page.create` carries the complete empty page and its design-relative file path, plus an optional insertion index. `page.remove` names the page. These are deliberate data-bearing commands, not a new `PageCommand`: the existing page command application path remains page-scoped and unchanged.

`applyDocumentCommand(design, command)` returns:

- the resulting design;
- a computed inverse (`page.create` ↔ `page.remove`);
- the created/removed page ids.

`readDocumentCommand` performs structural parsing of untrusted JSON. The caller validates the resulting design, including node references and tokens, before writing.

### 2. Invariants

- Page ids are unique and must be `pg_` ULIDs.
- Page file paths are safe design-relative paths, cannot collide with an existing page file, and cannot replace `weft.json`.
- A design must retain at least one page.
- `page.remove` captures the full page and its manifest reference in the inverse, so the page content can be restored.
- `page.create` serializes through the normal page writer; `page.remove` updates the manifest and removes the page file. The inverse re-creates the file.

### 3. Bridge protocol

The live bridge gains:

```json
{
  "type": "designCommand",
  "requestId": "…",
  "command": { "type": "page.create", "page": {}, "file": "pages/about.json" },
  "actor": { "id": "browser", "kind": "human", "name": "You" }
}
```

and responds with `designCommandResult` containing `ok`, `inverse`, `createdPageIds`, `removedPageIds`, `revision`, `commandId` and the actor. Successful commands broadcast a `designCommand` attribution message.

The bridge reads the current design from disk, applies and validates the command, then performs a best-effort transaction:

- **create:** write the new page file, then the manifest; if the manifest write fails, remove the newly written page file.
- **remove:** write the manifest, then unlink the page file. A failed unlink leaves an orphan file rather than a manifest that points at missing content; the command still reports success and the inverse can restore the page.

After writing, the bridge rebuilds page sessions, reloads snapshot payloads, increments the revision and broadcasts an `init` with `reason: "designCommand"` before sending the result.

### 4. Browser UX and mixed undo

The left panel gains **New page** and **Delete page** actions. New pages use `Page N` naming, append to the tab strip and become active when their init arrives. Delete confirms, refuses the last page, and falls back to the first remaining page.

The browser history now accepts both page and document commands. An init caused by a document command preserves the initiating client's history (other clients clear theirs, because their pending maps are empty). The result then pushes the command's inverse onto the same undo/redo stacks. This means page create/delete and node edits undo in the order they happened.

### 5. Deliberate omissions

- No page rename, reorder, duplicate or background editor. Those need more page-level commands and manifest/file semantics.
- No CLI `page` command yet; the core and bridge protocol are the current surfaces. The next CLI/document tool should reuse `applyDocumentCommand`.
- No transactional filesystem journal. The best-effort ordering above is documented; a crash between manifest and unlink can leave an orphan page file.
- No page file garbage collection for snapshot/asset files orphaned by a deleted page.
- The published JSON Schema includes `page.create`/`page.remove` and a document-command request, but the fixture index does not yet have dedicated document-command JSON fixtures; the direct contract test covers the current shapes.

## Consequences

**Easier**

- A designer can create a blank page, draw on it, delete another page and undo either operation from the browser.
- Page mutations have the same attribution, validation and inverse model as node mutations.
- Agents and future clients can use the documented `DocumentCommand` shape without inventing file operations.

**Harder, and knowingly accepted**

- Page removal deletes a file. The inverse message carries the page content; losing that message or its client history loses the convenience of undo, though git still has the file history.
- A page with a very large node tree produces a large inverse payload for deletion.
- History is still per browser tab and in memory; a reconnect clears it.
- The bridge has a second write path (manifest/page file) to validate and test; it is not a general filesystem transaction.
- The UI uses a native confirmation dialog for page deletion in this slice.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Treat page creation as a `PageCommand` with a placeholder pageId** | The page does not exist yet, and page commands are applied to an existing session. It would blur validation and file creation. |
| **Write manifest and page file from the browser** | Bypasses bridge validation, atomic writes and inverse/undo. |
| **A single `writeDesign` whole-directory operation** | Rewrites unrelated pages and files, creates noisy watcher events and makes rollback less precise. |
| **Keep page deletion as a file-only operation** | The manifest would reference a missing page or leave an unreferenced file; it needs a command and inverse. |
| **Persist undo server-side** | Inconsistent with the existing per-client command history and the file-is-canonical model. |
| **Delete the page file before writing the manifest** | A failed manifest write would leave the design pointing at missing content. Manifest-first orphan risk is safer. |
| **Skip mixed history and make page creation non-undoable** | Undo is a product guarantee; a page created in the browser should be reversible like a node. |

## Follow-ups

- CLI `page create/remove/apply` using the same core command and file transaction.
- Add dedicated document-command conformance fixtures.
- Page rename/reorder/duplicate/background.
- Orphan file cleanup and a safer file transaction/journal.
- Custom confirmation UI instead of `window.confirm`.
- Page-level permissions for agents.
