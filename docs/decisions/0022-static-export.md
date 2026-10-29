# 0022 · Static HTML export and handoff

- **Status:** Accepted
- **Date:** 2026-10-25
- **Area:** Export / handoff
- **Extended by:** [0023](0023-static-asset-export.md) (static asset export)

## Context

The design file is portable and agent-readable, but handing a design to a person or an implementation workflow also needs a view that opens without Weft. A handoff should not require a running bridge, execute design scripts, or depend on a proprietary runtime. The existing renderer already turns pages into real DOM; it should be reused rather than duplicated.

## Decision

### 1. Export is a static handoff directory

`weft export <design> --out <dir>` renders selected pages to standalone HTML:

```text
<out>/
├── index.html
├── pages/
│   ├── landing.html
│   └── pricing.html
├── tokens.json
└── weft.export.json
```

- `index.html` links the exported pages and shows dimensions.
- Each page is a complete HTML document with the design rendered by `@weft/render` and server-side `react-dom/server`.
- `tokens.json` is the manifest token tree when present.
- `weft.export.json` records the design id/name, export timestamp, page ids/names/files and dimensions.
- The output is deterministic within the same renderer and timestamps; no source design files are rewritten.

### 2. Reuse the renderer, add no scripts

The exporter renders `PageView` with the page's actual bounds and the snapshot payloads loaded from the design directory. Snapshot nodes remain in their sandboxed iframes; the export adds no JavaScript runtime and no external scripts. The static shell only supplies page/title styling, a page wrapper, spacing and a light background.

This is a visual handoff, not a React component generator. It preserves the rendering decisions already made by the DOM renderer.

### 3. Output safety

- The output directory is created if missing.
- A non-empty output directory is refused unless `--force` is passed; force overwrites generated files but never deletes unrelated files.
- Page filenames are derived from page names and made unique; generated paths stay under `pages/`.
- Source design files are read with file-existence checks; malformed designs fail validation before export.
- No network access or script execution is added.

### 4. CLI and JSON

`weft export` supports `--page <id|name>`, `--force`, `--json` and `--help`. The JSON result lists the design, output directory, exported pages and written files. Errors use the same code/exit conventions as other CLI commands.

### 5. Deliberate limits

- No image-node asset copying yet; image nodes remain placeholders.
- No font embedding, external CSS/assets or image rewriting.
- No responsive variants, multi-viewport frames, ZIP archive, PDF, React/HTML component code generation or design-token style generation.
- Snapshots remain sandboxed iframes with their inline data; they do not become editable native nodes.
- The output is static; there is no navigation/hover/interaction beyond standard links and any snapshot content that is already safe under the sandbox.
- A page's `data-node-id` attributes are retained for inspection but there is no editor.

## Consequences

**Easier**

- Designers and agents can open, review and share a design without Weft running.
- The exporter reuses the canonical renderer and snapshot payloads instead of a second layout implementation.
- The handoff manifest and tokens give agents a machine-readable companion.

**Harder, and knowingly accepted**

- Image assets need a later asset-serving/rewrite pipeline.
- Server rendering depends on React and the renderer package in the CLI build.
- Large pages produce large inline HTML (especially snapshot payloads).
- Formats such as component code, PDF or multi-viewport export are future work.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Screenshot/PDF only** | Not inspectable or editable; poor agent handoff. |
| **A client-side export in the editor** | Needs a browser and duplicates the CLI capability; server rendering is simpler for a file artifact. |
| **A new HTML renderer** | Would drift from the canvas renderer and snapshot sandbox. |
| **Generate React components** | Useful later, but a separate contract and validation problem. |
| **Copy raw design JSON only** | Not a visual handoff; the design files are already in the repository. |

## Follow-ups

- Asset and font copying/rewriting for image nodes.
- Responsive/multi-viewport exports and a ZIP option.
- Component/design-token handoff generation.
- Export from the bridge/UI and MCP.
