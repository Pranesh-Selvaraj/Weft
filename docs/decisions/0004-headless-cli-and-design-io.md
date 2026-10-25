# 0004. Headless CLI and design I/O before the editor

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

ADR 0003 defines the document, but until now nothing could open a design directory except the test suite. The mission says any coding agent can read and write designs; an agent works in a terminal, not in a canvas. Building the editor first would delay the cheapest and most important proof: that a design directory is valid, canonical, and usable without a browser.

The filesystem layer also cannot live in `@weft/core`. The core must run in the browser, stay dependency-free, and avoid Node APIs. Reading a directory, resolving paths, writing atomically, checking that assets exist, and formatting files are Node concerns. Putting them in the core would either pull Node into the browser bundle or force awkward environment checks.

There is a second, smaller decision: how much CLI surface to build before real editing commands exist. A large framework or a watch server would hide the contract behind another abstraction. Four small commands that exercise the contract are enough to prove the shape and to give agents something useful today.

## Decision

### 1. Filesystem access is its own package: `@weft/design-io`

It owns everything that touches the disk:

- read and validate a design directory: `weft.json`, every page listed in the manifest, assets, snapshot payloads;
- report schema issues and file-level issues together, each prefixed with the file it belongs to;
- resolve design-relative paths with an escape check, rejecting absolute paths, `..`, and backslashes;
- write the manifest and page files atomically (temporary file plus rename), always with deterministic serialization;
- format files into canonical form, reporting which files changed;
- initialize a design directory, refusing a non-empty directory unless explicitly forced;
- summarize a design for agents (pages, node counts, node types, tokens, assets, snapshots).

`@weft/core` remains pure: schema, operations, validation, serialization. No `node:fs`, no browser APIs, no environment assumptions.

### 2. The CLI is a thin client: `@weft/cli`

The `weft` binary ships four commands for now:

- `weft init <dir>` creates a design;
- `weft validate <dir>` checks schema and referenced files;
- `weft fmt <dir>` rewrites canonical JSON, with `--check` for CI and pre-commit use;
- `weft inspect <dir>` prints a summary.

Every command supports `--json` for agents and harnesses. Human output goes to stdout on success and stderr for diagnostics. Exit codes are stable: `0` success, `1` validation or I/O failure, `2` usage error. The CLI uses only Node built-ins (`node:util` `parseArgs`, `node:fs/promises`, `node:path`) and the workspace packages; no CLI framework, no server, no database, no network.

This CLI is the reference headless agent surface until the MCP server and in-canvas chat exist. The file format remains the primary interface; the CLI is a convenience over it.

### 3. Build headless before visual

The order is deliberate: contract and filesystem first, editor second. The first proof is that two independent clients can understand the same directory and that an agent can validate and format it without a browser. The editor will consume the same `design-io` layer and the same validation, so a bug fixed here does not need to be fixed twice.

## Consequences

**Easier**

- Agents can validate and format designs today, before MCP or the editor exists.
- CI and pre-commit hooks can run `weft validate` and `weft fmt --check` on real fixtures.
- Path safety, atomic writes, file existence checks, and canonical formatting live in one reusable place; the bridge, importer, and exporter will use the same layer.
- The CLI's JSON output gives harnesses a stable, small surface that does not require understanding the whole format.
- The package boundary keeps Node out of the browser core.

**Harder, and knowingly accepted**

- Design-level checks now exist in two places: `validateDesign` in the core and the directory inspection in `design-io`. They must be kept aligned with tests; the shared pure validator does the field-level work, so the duplication is limited to page/file mapping and cross-page ids.
- The CLI cannot edit nodes yet. Agents can still edit JSON directly, and the next slice adds a command protocol and `weft apply`. Until then, `fmt` and `validate` are the safety net.
- The JSON output is v0 and may gain fields or change shape before 1.0. It is documented and tested, not frozen.
- There is no watch mode, no server, no MCP, and no git integration in this slice. Those are separate decisions.
- The CLI reads whole files and rewrites whole pages. That is fine at current sizes and is not a substitute for the bridge's incremental reconciliation.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Build the editor first** | The visual surface is expensive and would not prove the file/agent contract. It also front-loads rendering choices before the document is battle-tested in real use. |
| **Put file I/O in `@weft/core`** | Pulls Node APIs into the browser package or forces runtime environment checks. It breaks the clean "core is portable" boundary from ADR 0003. |
| **A shell script or a few ad-hoc commands** | Not portable across shells and platforms, hard to test, and would duplicate path and atomic-write logic in the bridge later. |
| **Use a CLI framework (Commander, oclif, yargs)** | The four commands fit comfortably in Node's `parseArgs`; a framework adds a dependency and its own conventions before we know the real command surface. Revisit when the CLI grows substantially. |
| **A database-backed CLI** | Contradicts local-first and ADR 0002; the repository is the store. |
| **Only human-readable output** | Agents and CI need structured results and stable exit codes. `--json` is part of the first version, not an afterthought. |
| **Only JSON output** | Humans need readable diagnostics, and forcing every user through `jq` is not a developer experience. Both modes are supported. |
| **A watch/dev server now** | That is the bridge, and the bridge needs the CRDT and reconciliation decisions first. The CLI is deliberately one-shot. |

## Prior art / what this replaces

There is no earlier Weft CLI. This is the first executable client of the ADR 0003 contract, and it exists to make the contract testable in a terminal before it is testable on a canvas. The next decisions — command protocol, JSON Schema publication, editor stack, bridge reconciliation — depend on this layer staying small and honest.
