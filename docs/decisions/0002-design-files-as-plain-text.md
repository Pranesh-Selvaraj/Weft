# 0002. Design files are plain-text, agent-readable documents

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The product exists because design files are currently closed to coding agents. A Figma document is an opaque cloud binary reached through a proprietary API and a rate-limited integration; an agent cannot open it, diff it, or write to it without a vendor-specific path. That makes the agent a second-class citizen in the design process and forces exactly the handoff the product is meant to remove.

At the same time the system must support:

- real-time collaboration between people and agents;
- offline and local-first use;
- reviewable history and branching;
- high-fidelity capture of a running product page;
- a document small enough to open in a browser tab without a native runtime.

The core question is what the canonical artifact is. Everything else — renderer, sync, agent tools, export — is downstream of that answer.

## Decision

A design is a **plain-text, deterministic, versioned document tree on disk**, not a database blob and not a CRDT snapshot.

Specifically:

- A design file is a directory ending in `.weft/` containing a `weft.json` manifest, one JSON document per page under `pages/`, and binary assets under `assets/` referenced by id.
- Every entity (page, node, token, asset, annotation, comment) has a stable opaque id (ULID) and a human-readable name. Ids are never positional, never derived from array order, and never reused.
- The schema is explicit, versioned, and validated on every read and write. Unknown fields are preserved.
- Serialization is deterministic: the same logical document produces byte-identical JSON regardless of which client wrote it, so an unchanged file produces no diff.
- The canonical document is never a CRDT binary. Yjs (or another realtime layer) is a live editing protocol and cache; the bridge materializes it to JSON and ingests external file changes back into it.
- Assets are content-addressed or id-addressed files, never base64 inside page JSON.
- Anything the editor can do, the file format can express: if a feature cannot round-trip through the file, it is not shipped.

## Consequences

**Easier**

- Any agent that can read and write files can work on a design with no integration. This is the product's floor, and it never breaks.
- Git history, code review, branching, merge, and blame work on designs with normal tooling.
- The editor can be a static web app plus a thin bridge; there is no database to operate for the default setup.
- Export, diffing, migration, and testing all operate on the same data the agents see.
- A design file survives the editor. Losing Weft still leaves readable, recoverable JSON.

**Harder**

- File ↔ CRDT reconciliation becomes a first-class subsystem: a whole-file write from an agent and a live human edit can conflict. This needs node-level diff/merge and tests before the editor becomes feature-rich.
- Deterministic serialization must be enforced across every client (semantic key ordering, number formatting, asset ordering); a sloppy serializer produces noisy diffs and false conflicts.
- Schema evolution and migrations are product-critical because files outlive releases.
- Page JSON grows with node count; very large designs need per-page splitting, culling, and possibly a derived index.
- Fidelity constraints: a captured page's DOM is not fully representable as native nodes. The document therefore supports both native nodes and snapshot references, and the boundary between them must stay explicit.
- Security review is needed for untrusted captured HTML and for agent file writes.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **A single proprietary cloud document (the Figma model)** | It is precisely the problem. Agents would still need a vendor API, offline and git workflows stay impossible, and the product would inherit the same closed feedback loop. |
| **One large JSON file for the whole design** | Simple to start, but every edit touches one file, merge conflicts are global, and an agent must load the entire document to change one card. Directory-per-design with page files keeps diffs and reads local. |
| **SQLite as the canonical store** | Excellent for queries and large data, but opaque to agents without a driver, binary in git, and awkward to review or merge. A derived SQLite index may be added later; it will not be the source of truth. |
| **Yjs/CRDT binary as the canonical artifact** | Correct for live editing, wrong for review, agents, and long-term portability: a binary update log is not human-reviewable, has no stable field-level diff, and is tied to one CRDT implementation. Keep the CRDT as the live layer and JSON as the durable artifact. |
| **HTML/CSS as the document format** | Great for fidelity and immediate implementation, but it cannot represent design semantics (components, tokens, layout intent, annotations) without becoming a de facto proprietary schema, and diffing generated markup is worse than diffing structured nodes. Snapshots are the exception: captured pages store HTML deliberately, sandboxed and marked as such. |
| **Markdown plus embedded images** | Easy for agents but not editable as a design: no layout, tokens, or constraints. |

## Prior art / what this replaces

There is no earlier Weft implementation. The decision is a deliberate inversion of the incumbent design-tool model: the durable artifact is a repository file, and the collaborative editor is a client of it. This is the same inversion that made coding agents useful in the first place, applied to design.
