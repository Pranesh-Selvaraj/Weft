# The `weft` CLI

The CLI is the first executable client of the Weft document contract. It reads and writes a `.weft` directory on disk, validates it, canonicalizes it, and reports a summary that agents can consume as JSON.

It is intentionally small: no server, no database, no network, no watch mode. Editing commands arrive with the command protocol; until then, use `validate` and `fmt` to keep direct file edits honest.

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
| `weft validate <dir>` | Validate the manifest, pages, ids, tokens, assets and snapshot file references. Option: `--no-files` to skip disk checks. |
| `weft fmt <dir>` | Rewrite the manifest and pages in canonical form. Option: `--check` to report without writing. |
| `weft inspect <dir>` | Print pages, node counts, node types, tokens, assets and status. Option: `--no-files`. |
| `weft help [command]` | Show help. |

All commands accept `--json`. Exit codes are stable:

- `0` — success;
- `1` — validation or I/O failure;
- `2` — usage error.

## Examples

```bash
# Create a design directory.
pnpm weft init designs/marketing --name "Marketing site" --page Landing

# Validate it.
pnpm weft validate designs/marketing

# Machine-readable validation for an agent or CI.
pnpm weft validate designs/marketing --json

# Format, and fail if formatting is needed.
pnpm weft fmt designs/marketing --check

# Summarize the design.
pnpm weft inspect designs/marketing
```

The starter design in this repository is a valid fixture:

```bash
pnpm weft validate examples/starter.weft
pnpm weft inspect examples/starter.weft --json
```

## JSON output

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

When `ok` is `false`, `issues` contains objects with `path`, `code`, and `message`. A path is prefixed with the file that owns it, for example `pages/landing.json:nodes.nd_….width` or `weft.json:pages[0].file`. File-level issues use the file path itself, for example `snapshots/nd_….html`.

### `inspect`

```json
{
  "ok": true,
  "directory": "/abs/path/designs/marketing",
  "summary": { "…": "same shape as above" },
  "issues": []
}
```

`inspect` still returns a summary when there are issues, so an agent can see the design structure and the problems together.

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

### Errors

Unexpected I/O and usage errors that are not validation issues look like this:

```json
{
  "ok": false,
  "error": { "code": "init.not-empty", "message": "Directory … is not empty." }
}
```

## How agents should use it

- Read `weft.json` and the page files directly for content. The CLI does not replace the files; it protects them.
- Run `weft validate --json` after a direct edit. If `ok` is false, fix the reported paths before continuing.
- Run `weft fmt` after applying a whole-file edit so the diff stays minimal and deterministic.
- Use `weft inspect --json` to get page and node counts without loading a large file into context.
- When the command protocol lands, prefer `weft apply` over whole-file writes while another client is editing; the CLI will then emit the same operations as the editor.

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

## Safety properties

- All paths are resolved relative to the design directory and rejected if they escape it.
- Writes are atomic: a temporary file is written and renamed into place.
- `fmt` refuses to write when the design is invalid.
- `validate` checks referenced asset and snapshot files exist unless `--no-files` is given.
- `init` refuses a non-empty directory unless `--force` is explicit.
- The CLI never runs captured scripts and never executes design content.
