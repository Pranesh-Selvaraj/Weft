# Changelog

All notable changes to Weft are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it publishes releases.

Release notes are written in prose and describe the user-visible effect of each change, not just its label. A published release body must match the entry here.

## [Unreleased]

### Added

- Founding repository: the product definition, the working architecture, and two decision records — the name **Weft**, and the choice of plain-text, git-friendly design files as the canonical artifact that any coding agent can read and write.
- `@weft/core`, the shared document model: a design is a manifest plus one page per file, with nodes in a flat id-addressed map, stable prefixed ULIDs, real text content, token references, captured-page snapshots stored beside the page, and a deterministic JSON writer so identical designs produce identical bytes and reviewable git diffs. The package also ships pure insert, move, reorder, duplicate, remove and update operations, and a dependency-free validator that reports typed, pathed issues for broken references, cycles, unreachable nodes, unresolved tokens and assets, unsafe paths and malformed snapshot metadata.
- A small starter design in `examples/starter.weft/`, readable end to end, exercised by 94 unit tests together with the schema, serialization, validation and operation suites.
- `@weft/design-io`, the Node filesystem layer for design directories. It reads a manifest and the pages it lists, reports schema and file problems together with file-prefixed paths, resolves design-relative paths without allowing escapes, writes manifest and pages atomically with deterministic serialization, formats files into canonical form, initializes new designs without overwriting a non-empty directory unless forced, and checks that referenced asset and snapshot files exist. It also produces the compact summary used by agents.
- The `weft` CLI, the first executable client of the document contract: `weft init`, `weft validate`, `weft fmt` and `weft inspect`, each with human-readable and `--json` output and stable exit codes (`0` success, `1` validation or I/O failure, `2` usage error). `fmt --check` supports CI and pre-commit use, and `validate` distinguishes schema issues from missing files.
- Asset paths are no longer restricted to a fixed list of image/video extensions, so fonts and other design assets can live beside the design without being rejected by the schema.
- The command protocol: serializable page mutations for inserting, updating, moving, removing, duplicating and replacing nodes, plus atomic subtree insertion. Every applied command returns an inverse computed from the document before the change, so a command followed by its inverse restores a byte-identical page. Commands carry a `cm_` id, page id, ISO timestamp and optional human/agent/system actor in an envelope, and untrusted command JSON is parsed with stable error codes before anything is applied.
- Three new CLI commands built on the protocol. `weft apply` reads `{pageId, command, actor?}` from a file or stdin, validates the result, writes atomically, and returns the command id, created node ids, inverse and written files; `--dry-run` returns the same without writing. `weft get` prints a page document or a node with its page context as JSON. `weft id` generates prefixed ULIDs for designs, pages, nodes, assets and commands, so an agent can allocate ids before inserting a node.
- The CLI test suite grew to 19 tests and the core suite to 109; the repository now has 145 tests across the document model, design I/O and CLI.
