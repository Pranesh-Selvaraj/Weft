# @weft/export

Static HTML handoff for Weft designs. It server-renders the canonical `PageView` to standalone pages, copies snapshot payloads into sandboxed iframes without adding scripts, and writes an index, tokens and an export manifest.

## Usage

```ts
import { exportDesign } from "@weft/export";

const result = await exportDesign({
  designDir: "/abs/project/designs/app.weft",
  outDir: "/abs/project/dist/handoff",
  page: "Landing", // optional
  force: false,
});
```

The CLI exposes the same operation:

```bash
weft export designs/app.weft --out dist/handoff
```

## Output

`index.html`, `pages/<slug>.html`, optional `tokens.json`, and `weft.export.json` with design/page metadata and dimensions.

## Security

- No scripts are added to the export.
- Snapshot payloads remain in sandboxed iframes with their CSP.
- Design files are validated and referenced files checked before writing.
- A non-empty output directory is refused unless `force` is true; unrelated files are never deleted.
- Generated paths stay under `pages/`.

## Limits

Image nodes are placeholders; fonts/assets are not embedded; no responsive, PDF, ZIP or component generation yet. See [`docs/export.md`](../../docs/export.md) and ADR 0022.

## Test

```bash
pnpm --filter @weft/export test
```
