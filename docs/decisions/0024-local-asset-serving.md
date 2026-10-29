# 0024 · Local asset serving

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Rendering / security
- **Extends:** ADR 0022, ADR 0023

## Context

The renderer already accepted an `assetUrl` resolver, and static export copied manifest assets, but the live editor and static Vite preview still showed image placeholders. Images need a local URL source without exposing arbitrary design-directory files or turning the bridge into a generic file server.

## Decision

### 1. Manifest assets only

`@weft/design-io` gains `readAssetFile` and `readAssetDataUrls`:

- `readAssetFile` resolves an `Asset` through the design-relative safe-path resolver;
- it rejects missing files, symlinks, non-files and assets above a 10 MiB cap;
- it returns bytes and a MIME value sanitized to a media-style token;
- `readAssetDataUrls` uses the same reader to build data URLs for the static preview.

Only assets listed in the manifest are addressable. There is no directory listing and no arbitrary path parameter.

### 2. Live bridge route

The bridge serves `GET/HEAD /api/asset/<asset-id>`:

- the session cookie is required;
- the asset id must match a manifest asset;
- only `image/*`, `font/*`, `video/*` and `audio/*` MIME types are served; other types receive 415;
- bytes are read from the design directory through `readAssetFile`;
- responses use `no-store`, `Cross-Origin-Resource-Policy: same-origin` and a restrictive CSP with `script-src 'none'` and `sandbox`;
- missing or unsafe assets return a JSON error.

The app builds image/background URLs as `/api/asset/<id>?v=<revision>`. The revision query changes when the bridge reloads the design, busting stale image caches while the route still ignores the query.

### 3. Static Vite preview

The Vite virtual design includes `assetUrls` as data URLs read at build/dev time. Static previews therefore render images without a bridge. Data URLs are local, browser-decoded and do not execute scripts in image contexts.

### 4. Editor behavior

`PageView` receives an `assetUrl` resolver from `useDesignSource`:

- live mode returns the authenticated `/api/asset` URL when the manifest lists the asset;
- static mode returns the embedded data URL;
- unknown asset ids return `undefined`, preserving the placeholder.

Image nodes and image paints now render visible assets in both modes. Snapshot payloads remain separate and sandboxed.

### 5. Deliberate limits

- No asset upload/import UI, thumbnails, image optimization, content hashing or deduplication.
- No font-family mapping or `@font-face` generation; font assets can be served but the design schema does not bind them to text styles.
- No asset route for arbitrary design files; only manifest assets.
- Large static assets increase the Vite bundle through embedded data URLs.
- Asset files are local and untrusted content; SVG responses are protected by CSP but not rewritten.

## Consequences

**Easier**

- Live and static image rendering work without a separate asset server.
- The asset route has a narrow allowlist, MIME policy and CSP.
- The same asset files feed editor, handoff export and static preview.

**Harder, and knowingly accepted**

- Every asset change triggers a design reload/revision and a new query string.
- Static builds can become large when assets are embedded.
- Binary assets still have no upload workflow or content-addressing.
- Fonts remain copied/served but not wired to typography.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Serve the whole design directory statically** | Exposes page JSON, snapshots and unrelated files; path traversal surface. |
| **Serve by arbitrary relative path** | Bypasses the manifest allowlist; a query parameter becomes a file reader. |
| **Embed assets only in the live app** | Static preview and export would diverge; a bridge route is small. |
| **Use `file://` URLs** | Browser security blocks or treats them differently; not portable. |
| **Add an asset server package** | The bridge is already the local authenticated file owner; reuse it. |

## Follow-ups

- Asset import/upload and thumbnails.
- Font metadata and `@font-face` export.
- Content hashing/deduplication and image variants.
- Asset permissions per project.
