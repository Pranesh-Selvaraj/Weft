# 0006. Published JSON Schema and a conformance fixture suite

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

ADR 0003 defines the document and ADR 0005 defines commands, but both live in TypeScript. An agent, an editor in another language, or a third-party validator should not have to read our implementation to know what a valid manifest, page or command looks like.

There is also a drift risk: the TypeScript types, the hand-written validator and the CLI's command parser can disagree. Without a fixture suite that exercises all three, the disagreement is discovered by a user.

The contract has two layers. Some constraints are structural (field types, enums, ranges, id prefixes). Others are semantic and require a whole document or a directory (node map keys, parent/child links, cycles, global id uniqueness, token resolution, asset and snapshot files, path safety). A single technology cannot express both cleanly. Pretending otherwise would either weaken the validator or produce a schema full of unenforceable comments.

## Decision

### 1. Publish one versioned JSON Schema

`packages/contract/schema/weft.schema.json` is a JSON Schema draft 2020-12 document with a versioned `$id` (`https://weft.dev/schema/1/weft.schema.json`). It contains shared `$defs` for manifests, pages, nodes, paints, styles, layouts, tokens, assets, snapshots, patches, commands, command requests, command envelopes and actors.

The top level is an `anyOf` over manifest, page, command request and command envelope, so a client can validate "some Weft document" in one call. Clients that know the document kind reference the corresponding `$defs` entry directly.

The schema allows unknown object fields because ADR 0003 preserves them. It is a structural floor, not a closed-world schema.

### 2. Keep semantic validation in the core

The schema does not check node-map key equality, parent/child links, cycles, reachability, cross-page id uniqueness, token or asset resolution, file existence, or path safety. `@weft/core` and `weft validate` remain authoritative for a design directory. The schema's job is to reject malformed shapes before semantic validation begins and to give other languages a shared starting point.

This boundary is explicit in the schema description, the contract README, and the conformance fixtures.

### 3. Make agreement executable

`packages/contract/fixtures/` contains:

- `valid` — documents that pass both the schema and the core;
- `schemaInvalid` — documents that fail the schema and the core, with expected core codes;
- `semanticInvalid` — documents that pass the schema but fail the core, proving the boundary.

`fixtures/conformance.json` indexes every case. `packages/contract/test/conformance.test.ts` runs Ajv and the core validator against the same fixtures, plus the starter design and a page containing every v1 node type. If the types, schema and validators drift, a fixture fails.

The `@weft/contract` package carries the schema and fixtures. It is private for now and will be published with the other packages when the format is stable. It has no runtime code and no runtime dependencies; Ajv and `ajv-formats` are test-only dependencies.

### 4. Hand-maintain, do not generate yet

The schema is written by hand alongside the TypeScript types. Generation from TypeScript is possible, but it tends to produce large, implementation-shaped schemas and still cannot express the semantic checks. Hand-maintenance is acceptable while the schema is small and the conformance suite catches drift. If the schema grows beyond what one person can review, generation can be reconsidered without changing the published shape.

### 5. Version the schema with the format

The schema lives under `/schema/1/` and tracks format version `1`. Additive fields do not bump the version; breaking changes do. The repository URL is the source of truth until the example `$id` domain is reserved and the schema is served.

## Consequences

**Easier**

- Agents and non-TypeScript implementations can validate the structural shape of a design or command without importing our code.
- CI can compare a new fixture against both layers and catch drift in either direction.
- The valid/invalid split documents exactly what the schema can and cannot promise.
- The schema is a readable specification of the document and command unions, useful in reviews.
- The core stays dependency-free: Ajv lives only in the contract test package.

**Harder, and knowingly accepted**

- The schema is a second artifact to maintain. The conformance suite catches drift, but adding a node type or command requires editing both the types and the schema.
- JSON Schema cannot express the semantic rules, so a schema-only validator will accept some invalid designs. The documentation and fixtures make this explicit rather than pretending the schema is complete.
- The top-level `anyOf` makes command requests and envelopes overlap; that is intentional because a request may carry `id` and `timestamp`. Clients that need a specific shape should reference a `$defs` entry.
- The schema's URL is aspirational until the domain is reserved and serving is set up. The repository path is canonical for now.
- Unknown fields are allowed, so the schema cannot catch typos in extension areas. The core preserves them by design.
- The schema uses `date-time` and `uri` formats, so consumers need format support (Ajv requires `ajv-formats`).

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Generate the schema from TypeScript** | Tempting for consistency, but generated schemas are implementation-shaped, can be enormous for unions and recursive JSON, and still cannot express semantic checks. Hand-maintaining a smaller schema with a drift guard is clearer at this stage. |
| **Use Zod or TypeBox as the only contract** | Excellent for TypeScript, but not language-neutral. It would force every future non-TypeScript client to read TypeScript or add its own runtime. |
| **JSON Schema only, drop the semantic validator** | The schema cannot enforce node-map keys, links, cycles, token resolution or file existence. Accepting those as valid would make the file format unreliable. |
| **No published schema; document in prose only** | Agents would guess field names and enums, and every implementation would drift. Prose is not executable. |
| **OpenAPI** | Designed for HTTP APIs, not filesystem documents or commands. It would add layers without improving document validation. |
| **Protobuf or CBOR schema** | Binary schemas conflict with the plain-text, git-friendly, agent-readable artifact from ADR 0002. |
| **One schema per document kind, with duplicated definitions** | Avoids `anyOf` ambiguity but duplicates node/style/paint definitions and creates four drift surfaces. Shared `$defs` with a top-level union is smaller and easier to validate. |

## Prior art / what this replaces

There was no published structural contract before this record. The TypeScript types and the hand-written validator were the only definition. This decision makes the shape available to other runtimes and turns "the schema and the validator agree" into a test rather than an assumption. It does not replace the semantic validator, and it does not freeze the document format before the editor and bridge have exercised it.
