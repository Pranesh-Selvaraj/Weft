# 0018 · Page organization

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Contract / UI
- **Extends:** ADR 0015

## Context

ADR 0015 added page creation and removal. Pages still could not be renamed or reordered, so a design's navigation was fixed at creation time. These are document-level changes: a rename updates both the page document and its manifest reference, while a move changes manifest/page order without moving files.

## Decision

### 1. Two additional document commands

`DocumentCommand` gains:

```ts
| { type: "page.rename"; pageId: string; name: string }
| { type: "page.move"; pageId: string; index: number }
```

- `page.rename` trims the name, updates the page's `name` and the matching manifest `PageRef.name`, and returns the old name as its inverse. Page file paths remain stable so links, diffs and IDE state are not disturbed by a rename.
- `page.move` removes the page from its current position and inserts it at the requested final index in both `pages` and `manifest.pages`. Its inverse is a move back to the old index.
- Both commands validate page existence and refuse an out-of-range move. Names need not be globally unique; the page id remains the identity.
- `readDocumentCommand` structurally parses the new shapes; the same command is available to the bridge, CLI and MCP.

### 2. File transaction

`writeDocumentCommand` now takes the pre-command design:

- **rename:** write the renamed page file, then the manifest. If the manifest write fails, best-effort restore the old page file.
- **move:** write only the manifest; no page file changes.
- **create/remove:** keep their existing ordering and cleanup behavior.

The bridge sends a design-command init after the write, so tabs and sessions reflect the new name/order. The browser preserves the initiator's mixed undo history; a rename or move is undoable like page creation.

### 3. Browser interaction

- Double-click a page tab to edit its name inline. Enter or blur commits; Escape cancels.
- **Rename** in the page actions starts the same inline editor, making the feature discoverable.
- Page tabs are draggable. Dropping a tab on another sends `page.move` with the target's final index; the drop target is highlighted.
- The page actions read `+ Page`, `Rename`, `Delete`; deletion still confirms and refuses the last page.

### 4. CLI and MCP

`weft page rename <design> --page <id|name> --name <name>` and `weft page move <design> --page <id|name> --index <n>` expose the same commands. `weft page apply` can replay either inverse. The MCP `weft_page_command` tool accepts them through the shared `DocumentCommand` parser.

### 5. Deliberate limits

- No page duplicate, background editor, or drag between designs.
- Drop semantics use the target tab's index; there are no gaps or multi-page drags.
- Page names may duplicate; tabs are distinguished by position and page content.
- The inline editor uses a plain text input, not a rich rename dialog.
- A failed rename manifest write attempts to restore the old page file but is not a filesystem journal.

## Consequences

**Easier**

- Pages can be named and arranged to match the product navigation.
- Rename/move reuse the document command, inverse, attribution and file transaction model.
- Browser, CLI and MCP expose the same operations.
- Page files stay at stable paths across renames.

**Harder, and knowingly accepted**

- Drag reorder uses HTML5 DnD and a final-index convention; complex drop indicators are not built.
- Duplicate page names can be confusing even though ids are unique.
- The rename rollback is best effort, not transactional.
- Page-level history remains per browser tab and in memory.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Rename by changing only the page document** | The manifest tab name would drift from the page. |
| **Rename the page file to match** | Breaks stable paths, external links, imports and diffs; unnecessary for identity. |
| **Reorder by rewriting page files** | Order is manifest metadata; no file contents need to change. |
| **Use `node.move`-style commands with fractional order** | Pages are an ordered manifest list, not positioned nodes. A final index plus inverse is simpler. |
| **Prompt-based rename-only UI** | Inline tab editing is more direct and also supports drag reorder. |
| **Separate bridge APIs for rename/reorder** | A document command keeps validation, inverses and file semantics in one contract. |

## Follow-ups

- Page duplicate and drag between designs.
- Page background/token editors.
- Multi-page drag and richer drop indicators.
- Custom rename dialog with validation hints.
