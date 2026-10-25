# @weft/contract

The language-neutral structural contract for Weft v1: a JSON Schema and a conformance fixture suite. It exists so an agent, a CI job, or a future implementation in another language can validate Weft documents without importing `@weft/core`.

## Contents

```text
packages/contract/
├── schema/
│   └── weft.schema.json
├── fixtures/
│   ├── conformance.json
│   ├── valid/
│   ├── invalid/
│   └── semantic/
└── test/
    └── conformance.test.ts
```

## The schema

`schema/weft.schema.json` uses JSON Schema draft 2020-12 and covers:

| Definition | Document |
| --- | --- |
| `manifest` | `weft.json` |
| `page` | `pages/*.json` |
| `commandRequest` | `{ pageId, command, actor?, id?, timestamp? }` as accepted by `weft apply` |
| `commandEnvelope` | `{ id, pageId, timestamp, actor?, command }` |
| `command` | the `PageCommand` union |
| shared `$defs` | nodes, paints, styles, layouts, tokens, assets, snapshots, patches |

The default `$id` is `https://weft.dev/schema/1/weft.schema.json`. The domain is not yet reserved; the path is versioned so a future publication can move without changing the contract shape.

The top-level schema is an `anyOf` over manifest, page, command request and command envelope. If you know which document you have, reference its definition directly:

```js
ajv.addSchema(schema);
const validatePage = ajv.compile({
  $ref: "https://weft.dev/schema/1/weft.schema.json#/$defs/page"
});
```

## Structural versus semantic validation

The schema checks shape: required fields, types, enums, ranges, id prefixes, token keys and paint/layout variants. It deliberately does **not** check:

- that a node map key equals the node's `id`;
- that parent/child references resolve, form one tree, or avoid cycles;
- that node ids are unique across pages;
- that token references resolve, or that an asset id exists;
- that referenced asset and snapshot files exist;
- that page file paths stay inside the design directory.

Those are semantic checks. `@weft/core` and `weft validate` are authoritative for a design directory. A document that passes this schema can still be semantically invalid, and the conformance suite proves that distinction explicitly.

The schema allows unknown object fields because Weft preserves them across read/write. It is a structural floor, not a closed world.

## Validate with Ajv

```js
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js");
const addFormats = require("ajv-formats");

const schema = JSON.parse(readFileSync("schema/weft.schema.json", "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const ok = validate(document);
if (!ok) console.error(validate.errors);
```

`ajv-formats` is required for `date-time` and `uri` formats. The tests use the same setup.

## Conformance fixtures

`fixtures/conformance.json` is the index:

- `valid` — must pass both the schema and the core validator;
- `schemaInvalid` — must fail the schema and the core, with the listed core code;
- `semanticInvalid` — must pass the schema but fail the core, with the listed core code.

The fixture suite currently covers manifests, pages, command requests, command envelopes, every node type, and every command type. The repository test also validates `examples/starter.weft`.

Add a fixture by writing the JSON, adding it to the index, and running:

```bash
pnpm --filter @weft/contract test
```

## Versioning

- The schema lives under `/schema/1/` alongside format version `1`.
- The repository test suite is the drift guard: if the TypeScript types and the schema disagree, a valid or invalid fixture fails.
- Breaking schema changes bump the version; additive fields do not.
- The schema is hand-maintained rather than generated. If drift or size becomes a problem, generation can be introduced without changing the published shape.

## Status

Pre-alpha. The schema is published in the repository, not yet at the example `$id` URL. The core validator remains the reference implementation and the authority for accepting a design directory.
