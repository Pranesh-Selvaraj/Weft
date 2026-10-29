# 0023 · Static asset export

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Export
- **Extends:** ADR 0022
- **Extended by:** [0024](0024-local-asset-serving.md) (local asset serving)

## Context

ADR 0022 exported pages as static HTML but left image nodes as placeholders because it did not copy manifest assets. A visual handoff that cannot show product imagery is incomplete. The design manifest already contains safe design-relative asset paths and MIME metadata; exporting them should stay local and avoid making the exporter a general file server.

## Decision

### 1. Copy manifest assets

The exporter copies every manifest asset into the output directory as:

```text
assets/<asset-id><lowercase-extension>
```

- The asset id makes the filename unique and independent of the source directory layout.
- Extensions are accepted only when they match a short `\.[a-z0-9]{1,10}` pattern; otherwise the extension is omitted.
- Paths are resolved through the design-relative safe-path resolver; assets are read from the design directory only and written under `out/assets/`.
- Assets are copied as bytes, with atomic temp-file replacement.
- `weft.export.json` lists exported assets (`id`, optional name, MIME, file).

### 2. Rewrite image URLs

The renderer receives an `assetUrl` resolver from the exporter. Page HTML lives under `pages/`, so image sources and paint background URLs are emitted as `../assets/<id><ext>`. Image nodes render real `<img>` elements; image paints render real CSS URLs.

Only manifest assets are copied. No external/remote asset is fetched or linked, and snapshot payloads continue to carry their own inlined data.

### 3. Non-goals in this slice

- Font assets are copied but no `@font-face` rules are generated, because the design schema does not yet map an asset to a font family/weight/style.
- No content-addressed deduplication, resizing/format conversion, thumbnails, or responsive image variants.
- No asset serving in the editor/bridge; this changes the static export only.
- No arbitrary filesystem copying: output filenames derive from asset ids under `assets/`.

## Consequences

**Easier**

- Exported pages show image nodes and image paints from the design repository.
- Assets remain local, deterministic and inspectable.
- The handoff manifest tells an agent which source asset produced each output file.

**Harder, and knowingly accepted**

- The output can duplicate large images and includes unused manifest assets.
- Fonts are present but not connected to CSS.
- Preserving original asset paths is not an option, so external links to output assets must use the exported names.
- Binary asset copying is not content-addressed; future deduplication is possible.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Preserve source paths** | Collides with generated files (`index.html`, `pages/`) and makes collisions harder to reason about. |
| **Inline assets as data URLs** | Bloats every page and duplicates data across pages. |
| **Keep remote URLs** | Export would depend on a running/bookmarked server and leak network access. |
| **Serve assets from the editor** | Useful later, but export should work without Weft running. |

## Follow-ups

- Font mapping and `@font-face` export.
- Asset hashing/deduplication, image variants and thumbnails.
- Asset serving in the editor/bridge.
- Export manifest checksums and size metadata.
