# Changelog

All notable changes to Weft are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it publishes releases.

Release notes are written in prose and describe the user-visible effect of each change, not just its label. A published release body must match the entry here.

## [Unreleased]

### Added

- Founding repository: the product definition, the working architecture, and two decision records — the name **Weft**, and the choice of plain-text, git-friendly design files as the canonical artifact that any coding agent can read and write.
- `@weft/core`, the shared document model: a design is a manifest plus one page per file, with nodes in a flat id-addressed map, stable prefixed ULIDs, real text content, token references, captured-page snapshots stored beside the page, and a deterministic JSON writer so identical designs produce identical bytes and reviewable git diffs. The package also ships pure insert, move, reorder, duplicate, remove and update operations, and a dependency-free validator that reports typed, pathed issues for broken references, cycles, unreachable nodes, unresolved tokens and assets, unsafe paths and malformed snapshot metadata.
- A small starter design in `examples/starter.weft/`, readable end to end, exercised by 94 unit tests together with the schema, serialization, validation and operation suites.
