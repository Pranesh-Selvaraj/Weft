# Project history

This is the narrative record of **what Weft was built with, why, what changed, and why**. `CHANGELOG.md` is the user-facing record of what shipped; `docs/decisions/` holds the reasoning in detail; this file is the map between them.

**How to update:** add a row to the timeline whenever the stack, architecture, contract, or product strategy changes, or when a release marks an era boundary. Link the ADR that explains it. Never rewrite history — correct it with a dated note instead.

## Eras

| Era | Period | Editor | Document | Realtime | Agent surface | Why it was chosen | What turned out to be wrong / why we moved on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **0. Foundation** | Oct 2026 – current | Not built yet | Plain-text `.weft/` directory (ADR 0002) | Yjs planned | Files + MCP + bridge planned | Establish the product definition and the decisions everything else depends on: an agent-native, browser-native canvas with the design file as the durable artifact. | *Not yet tested in code; the architecture is a draft and every stack choice still needs its own ADR.* |

## Timeline

| Date | Release / event | What changed | Why | Record |
| --- | --- | --- | --- | --- |
| 2026-10-25 | Project named **Weft** | Chose a one-word name from the weaving metaphor: designer and agent are the warp and weft of one design. Rejected Kern, Gesso, Tessera, Maquette, Vellum, and taken names such as Loom and Lattice. | The repository, CLI, package scope, and file format all need a stable name before code exists. | ADR 0001 |
| 2026-10-25 | Design files are plain-text documents | Chose a `.weft/` directory of deterministic JSON and assets as the canonical artifact, with Yjs as the live editing layer and the bridge as the only file writer. | Agents must be able to read, diff, and write designs without a proprietary API; git must remain the history; the file must outlive the editor. | ADR 0002 |
| 2026-10-25 | Product definition and draft architecture recorded | Wrote the personas, jobs, principles, non-goals, MVP exit criteria, system shape, risks, and the list of decisions still to make. | Give the first implementation a criterion-driven target instead of a calendar or a vibe. | ADR 0001, ADR 0002 |
| 2026-10-25 | Repository scaffolded | Created the monorepo skeleton, MIT license, decision-record system, and documentation. | Make the project contributable before the first line of product code. | — |
