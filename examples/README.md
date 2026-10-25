# Examples

Small, real artifacts that show the contract in use.

Current and planned examples:

- `examples/starter.weft/` — a small design file readable end to end: one landing page, a frame hierarchy, real text, tokens and flex layout. It is validated by the test suite and can be checked with `pnpm weft validate examples/starter.weft`.
- `examples/extracted-page/` — a snapshot frame captured from a running page, with annotations and an agent transcript. Planned.
- `examples/host-app/` — a tiny product page used to demonstrate extraction into Weft and implementation back out. Planned.

Examples are test fixtures as well as documentation: CI should open them, validate them against the schema, and fail if they drift.
