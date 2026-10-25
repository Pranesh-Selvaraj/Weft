# 0001. Project name: Weft

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The project needs a name before anything else can be named after it: the repository, the npm scope, the CLI, the file extension, and the vocabulary in the documentation. The constraints:

- One word, short, concrete, and in the same register as the other projects (Enclave, Nexus, Ratio, Tempo).
- At home in both design and engineering conversations; not another "-ly", "Flow", "Studio", or "Pad".
- A metaphor that explains the product rather than decorating it.
- Usable as a CLI command, a package scope (`@weft/*`), a domain, and a file extension without awkward casing or plurals.
- No established design-tool or agent-tool product already using it.

## Decision

The project is **Weft**.

The name comes from weaving: the warp is the structure held under tension, and the weft is the thread carried across it. In this product the designer and the agent are the two thread systems, and the design file is the cloth they make together. The metaphor also supplies internal vocabulary — *warp* for the structural contract (schema, operations, build pipeline), *weft* for the design surface — without naming either one in the UI.

Supporting identity:

- CLI and package names: `weft`, `@weft/core`, `@weft/bridge`, `@weft/mcp`.
- Design file: a `*.weft/` directory with `weft.json` inside.
- Tagline: **Agent-native design canvas for the browser.**
- Domain preference: `weft.dev` (checked as unregistered at the time of this record; not reserved).

## Consequences

**What the name buys**

- It is memorable and pronounceable, and it is not a compound of generic product words.
- It carries the collaboration thesis: neither warp nor weft is cloth alone.
- It gives the documentation a consistent metaphor for the two halves of the system without imposing that metaphor on users.

**What it costs**

- "Weft" is a less common English word; some users will need the one-line explanation the README provides.
- The metaphor must not leak into the UI as jargon. Users edit designs, not "threads".
- A trademark and domain check is still required before any public release or package publication. If the name must change, only this ADR, the package names, the repository name, and the docs are affected at this stage; no user files exist yet.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Kern** | A beautiful typographic metaphor (the space between letterforms) and a sharp one-syllable sound, but "kerning" only connotes spacing, not collaboration or files, and several design-adjacent projects already use it. |
| **Gesso** | The primer layer shared by every mark, a strong metaphor for a common surface, and it matches the -o cadence of Ratio and Tempo, but it is opaque to anyone outside painting and is already used in creative tooling. |
| **Tessera** | A mosaic tile implies composable frames and components, but three syllables and a literal reading (tiles) narrows the product toward moodboards. |
| **Maquette** | The exact concept — a preliminary model of the finished work — but the name is taken by an existing JavaScript UI library, which would poison search results. |
| **Vellum** | A design surface and a document material, but it collides with an established AI developer tool in the same broad audience. |
| **Loom / Lattice / Trellis / Fabric / Canvas** | All established products or heavily used terms; unusable for search and trademark. |
| **Shuttle** | The tool that carries the weft across the warp, and a lovely agent metaphor, but it is a major Rust web framework. |
| **Jacquard** | The programmable loom that first encoded a design as data — the historical ancestor of this product — but long, hard to spell, and already used commercially. |

## Prior art / what this replaces

The working title during the initial conversation was "the Figma alternative for agents". That described the category but not the product, and it defined Weft by what it is not. The name replaces the description and leaves the category to the README.
