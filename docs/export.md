# Static export and handoff

`weft export` turns a design into a directory of standalone HTML pages that open without Weft or the bridge. The renderer is the same one used by the editor; no scripts are added to the output.

## Run

```bash
weft export designs/app.weft --out dist/handoff

# One page by id or exact name
weft export designs/app.weft --out dist/handoff --page Landing

# Overwrite generated files in a non-empty output directory
weft export designs/app.weft --out dist/handoff --force
```

The command validates the design and referenced files before writing. It refuses a non-empty output directory unless `--force` is passed; force overwrites generated files but does not delete unrelated files.

## Output

```text
dist/handoff/
├── index.html
├── pages/
│   ├── landing.html
│   └── pricing.html
├── tokens.json          # when the manifest has tokens
└── weft.export.json
```

`weft.export.json` contains:

```json
{
  "format": "weft.export",
  "version": 1,
  "design": { "id": "ds_…", "name": "App" },
  "exportedAt": "2026-10-25T…",
  "pages": [
    { "id": "pg_…", "name": "Landing", "file": "pages/landing.html", "width": 1440, "height": 900 }
  ]
}
```

## What is rendered

- Frames, flex layout, text, rectangles, ellipses, tokens, paints, strokes, radius, shadows and page bounds through `@weft/render`.
- Snapshot payloads in their sandboxed iframes, using the sanitized HTML/CSS beside the design.
- A page wrapper, index page and optional token tree.

Image nodes render as placeholders until the asset pipeline exists. Fonts are not embedded; the exported page uses the declared CSS families with system fallbacks. There is no JavaScript runtime, navigation framework or client-side interaction.

## Security

- Export is a local read-and-write operation; it adds no network requests.
- The static shell contains no scripts.
- Snapshots remain `sandbox=""` iframes with their own CSP; exported text is still untrusted data.
- Output filenames are generated from page names and kept under `pages/`; a non-empty directory requires explicit `--force`.
- The source design files are not modified.

## Limits

- No image/font asset copying, responsive variants, multi-viewport frames, ZIP/PDF, React component generation or design-token CSS output yet.
- Large snapshot payloads make large HTML files.
- The output is not an editor; select/edit in Weft.

## Test

```bash
pnpm --filter @weft/export test
```

The suite covers all-page and single-page export, index/tokens/manifest output, snapshot sandbox markup, no-script output and the non-empty-directory guard.
