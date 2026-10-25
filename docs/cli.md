# The `weft` CLI

The CLI is the first executable client of the Weft document contract. It reads and writes a `.weft` directory on disk, validates it, canonicalizes it, reads pages and nodes, and applies serializable commands with an inverse for undo.

It is intentionally small: no server, no database, no network, no watch mode. The file format remains the primary interface; the CLI is a safety net and an agent surface over it.

## Build and run

```bash
pnpm install
pnpm build
pnpm weft --help
```

`pnpm weft` runs `packages/cli/dist/main.js`. You can also call the binary directly after a build:

```bash
packages/cli/dist/main.js --version
```

## Commands

| Command | Purpose |
| --- | --- |
| `weft init <dir>` | Create `weft.json` and a first page. Options: `--name`, `--page`, `--force`. |
| `weft validate <dir>` | Validate the manifest, pages, ids, tokens, assets and snapshot file references. Option: `--no-files`. |
| `weft fmt <dir>` | Rewrite the manifest and pages in canonical form. Option: `--check`. |
| `weft inspect <dir>` | Print pages, node counts, node types, tokens, assets and status. Option: `--no-files`. |
| `weft get <dir>` | Print a page or node as JSON: `--page <id\|name>` or `--node <id>`. |
| `weft apply <dir>` | Apply one JSON command. Options: `--command <path>`, `--dry-run`. |
| `weft id` | Generate Weft ids. Options: `--prefix`, `--count`, `--json`. |
| `weft help [command]` | Show help. |

Exit codes are stable:

- `0` — success;
- `1` — validation, command or I/O failure;
- `2` — usage error.

`validate`, `fmt`, `inspect`, `init` and `id` support `--json`. `get` and `apply` always print JSON because their output is meant to be consumed by another process.

## Create, validate, format, inspect

```bash
pnpm weft init designs/marketing --name "Marketing site" --page Landing
pnpm weft validate designs/marketing
pnpm weft fmt designs/marketing --check
pnpm weft inspect designs/marketing --json
```

The starter design is a valid fixture:

```bash
pnpm weft validate examples/starter.weft
pnpm weft inspect examples/starter.weft
pnpm weft get examples/starter.weft --page Landing
```

## Read a page or a node

```bash
# Print the full page document.
pnpm weft get designs/marketing --page Landing

# Print one node with the page it belongs to.
pnpm weft get designs/marketing --node nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE
```

`--page` accepts a page id or exact name and prints the page document. `--node` searches every page and prints:

```json
{
  "pageId": "pg_…",
  "pageFile": "pages/landing.json",
  "node": { "id": "nd_…", "type": "text", "name": "Heading", "…": "…" }
}
```

Errors are JSON too:

```json
{ "ok": false, "error": { "code": "node.missing", "message": "No node matches …" } }
```

## Generate ids

```bash
# One node id.
NODE_ID=$(pnpm --silent weft id)

# Five asset ids as JSON.
pnpm weft id --prefix as --count 5 --json
```

Prefixes are `ds` (design), `pg` (page), `nd` (node), `as` (asset) and `cm` (command). Ids are prefixed ULIDs; node ids are unique across the design.

## Apply a command

`weft apply` reads this shape from `--command <path>` or stdin:

```json
{
  "pageId": "pg_01JAV3Q8ZK4M2TP9W6XH5NR7BD",
  "command": {
    "type": "node.update",
    "nodeId": "nd_01JAV3Q8ZK4M2TP9W6XH5NR7BE",
    "patch": { "content": "Hello, agents." }
  },
  "actor": { "id": "pi", "kind": "agent", "name": "pi" },
  "id": "cm_…",
  "timestamp": "2026-10-25T12:00:00.000Z"
}
```

Only `pageId` and `command` are required. The CLI generates a `cm_` command id and an ISO timestamp when they are absent. `actor` is optional metadata for attribution.

```bash
pnpm weft apply designs/marketing --command /tmp/update.json

# Or pipe the command.
cat /tmp/update.json | pnpm weft apply designs/marketing
```

The result is always JSON:

```json
{
  "ok": true,
  "commandId": "cm_…",
  "pageId": "pg_…",
  "applied": { "type": "node.update", "nodeId": "nd_…", "patch": { "content": "Hello, agents." } },
  "inverse": { "type": "node.replace", "node": { "…": "the node before the change" } },
  "createdNodeIds": [],
  "dryRun": false,
  "written": ["weft.json", "pages/landing.json"]
}
```

The design is validated before writing and written atomically. `--dry-run` applies in memory, validates, returns the inverse, and writes nothing (`written` is empty).

### Undo with the inverse

Take the `inverse` object from the result, wrap it with the same `pageId`, and apply it:

```json
{
  "pageId": "pg_…",
  "command": { "type": "node.replace", "node": { "…": "the previous node" } }
}
```

Applying a command and then its inverse restores the page byte-for-byte. The test suite verifies this for every command.

### Command types

| Type | Purpose |
| --- | --- |
| `node.insert` | Insert one leaf or empty container at a parent and index. |
| `node.insertSubtree` | Atomically insert a complete subtree with a root id. |
| `node.update` | Patch fields on a node; cannot change `children`. |
| `node.move` | Move a node to a new parent and index. |
| `node.remove` | Remove a node and its subtree. |
| `node.duplicate` | Deep-copy a subtree with fresh ids. |
| `node.replace` | Restore a whole node for undo; cannot change its type or reorder children. |

A subtree insertion must contain every referenced child. Use `move` to adopt an existing node, and include all new descendants with `insertSubtree`. Structural changes always go through these commands; `node.update` deliberately cannot rewrite `children`.

## Agent workflow

1. `weft inspect <dir> --json` to see pages and counts.
2. `weft get <dir> --page <page>` to read the node tree, or `--node <id>` for one node.
3. `weft id` to allocate ids for new nodes.
4. `weft apply <dir> --command <file> --dry-run` to check the result and read the inverse.
5. `weft apply <dir> --command <file>` to write.
6. `weft validate <dir> --json` after any direct file edit; `weft fmt <dir>` to restore canonical formatting.

Direct file edits are still supported and are the baseline for agents that do not use the CLI. Prefer commands when another client may be editing the same file: a whole-file write is a coarse read-modify-write, while a command carries its intent and an inverse.

## JSON output reference

### `validate`

```json
{
  "ok": true,
  "directory": "/abs/path/designs/marketing",
  "summary": {
    "id": "ds_…",
    "name": "Marketing site",
    "pages": [{ "id": "pg_…", "name": "Landing", "file": "pages/landing.json", "nodeCount": 13 }],
    "pageCount": 1,
    "nodeCount": 13,
    "nodeTypes": { "frame": 5, "text": 8 },
    "tokenCount": 21,
    "assetCount": 0,
    "snapshotCount": 0
  },
  "issues": []
}
```

When `ok` is `false`, `issues` contains objects with `path`, `code` and `message`. Paths are prefixed with the owning file, for example `pages/landing.json:nodes.nd_….width` or `weft.json:pages[0].file`.

### `inspect`

Same shape as `validate`, without requiring success to return a summary.

### `fmt`

```json
{
  "ok": true,
  "directory": "/abs/path/designs/marketing",
  "check": false,
  "changed": ["pages/landing.json"],
  "files": ["weft.json", "pages/landing.json"],
  "issues": []
}
```

With `--check` and a non-canonical file, `ok` is `false` and the exit code is `1` even though nothing was written.

### `init`

```json
{
  "ok": true,
  "directory": "/abs/path/designs/marketing",
  "summary": { "…": "summary of the new design" }
}
```

### `id`

```json
{ "ok": true, "ids": ["nd_…", "nd_…"] }
```

### Errors

Validation failures return `{"ok":false,"issues":[...]}`. Command and I/O failures return:

```json
{ "ok": false, "error": { "code": "node.missing", "message": "…" } }
```

## Directory layout

```text
design.weft/
├── weft.json
├── pages/
│   └── landing.json
├── snapshots/
│   ├── nd_….html
│   └── nd_….css
└── assets/
```

`weft init` creates `weft.json` and the first page. It never deletes unrelated files. `weft fmt` only rewrites the manifest and page JSON; snapshot HTML/CSS and binary assets are left untouched.

## Limitations

- There are no page-level commands yet (page name, background, tokens). Those remain file edits.
- There is no optimistic concurrency or revision check. `weft apply` is a read-modify-write; the bridge and CRDT reconciliation will address concurrent writers.
- The command log and undo stack are not persisted in the design file. The CLI returns inverses; the editor and bridge will own their histories.
- `apply` accepts commands for one page at a time.

## Safety properties

- All paths are resolved relative to the design directory and rejected if they escape it.
- Writes are atomic: a temporary file is written and renamed into place.
- `fmt` and `apply` validate before writing.
- `validate` checks referenced asset and snapshot files exist unless `--no-files` is given.
- `init` refuses a non-empty directory unless `--force` is explicit.
- The CLI never runs captured scripts and never executes design content.
