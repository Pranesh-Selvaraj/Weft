# Assets

Weft assets are files listed in the design manifest:

```json
{
  "assets": [
    { "id": "as_…", "file": "assets/hero.svg", "mime": "image/svg+xml", "name": "Hero" }
  ]
}
```

Only manifest assets are addressable. Weft never serves arbitrary design-directory paths.

## Where assets render

- **Live editor:** the app builds `/api/asset/<id>?v=<revision>`; the bridge requires the session cookie, checks the manifest, reads the file through the safe-path resolver, and returns it with a restrictive CSP. The revision query busts caches after a design reload.
- **Static preview:** the Vite virtual design embeds `data:` URLs for manifest assets.
- **Static export:** `weft export` copies assets to `assets/<id><ext>` and rewrites page URLs relative to `pages/`.
- **Unknown ids:** render as the renderer's placeholder.

## Security

- Asset paths must stay inside the design directory; symlinks, non-files and files over 10 MiB are rejected.
- The live route serves only `image/*`, `font/*`, `video/*` and `audio/*` MIME types.
- Responses are `no-store`, `Cross-Origin-Resource-Policy: same-origin`, and carry a CSP banning scripts and external resources.
- The asset route requires the bridge session cookie. Static and export output contain no bridge credentials.
- SVG assets are served as files and protected by CSP; there is no SVG rewriting.

## Static preview payload

`readAssetDataUrls` converts manifest assets to data URLs at Vite dev/build time. This avoids a bridge but increases bundle size for large assets.

## Current limits

- No upload/import UI, thumbnails, deduplication, image optimization or responsive variants.
- Fonts can be served/copied but the schema does not bind them to `@font-face`/font families yet.
- Asset changes require a design reload/revision; no live binary diffing.
- The 10 MiB cap and media MIME allowlist are intentionally narrow.

See [ADR 0024](decisions/0024-local-asset-serving.md), [Static export](export.md) and [Bridge](../packages/bridge/README.md).
