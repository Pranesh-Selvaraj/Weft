# @weft/workspace

The local workspace registry. It answers "which project roots has the user explicitly allowed Weft to see?" without scanning the home directory.

## What it does

- Reads and writes `~/.weft/workspace.json` (or `$WEFT_WORKSPACE`, or an explicit path).
- Registers project roots with canonical absolute paths, unique names and timestamps.
- Discovers design directories inside a registered root: any directory containing `weft.json`, up to six levels deep.
- Skips `node_modules`, `.git`, `.weft-cache`, build outputs and symlinked directories.
- Lists missing registered projects as errors instead of silently dropping them.
- Writes the registry atomically with owner-only permissions.

## CLI

```bash
weft workspace init
weft workspace add ~/projects/Nexus --name Nexus
weft workspace list
weft workspace remove Nexus
```

Options: `--file <path>`, `--name <name>` for `add`, `--json` for machine output.

Default file: `$WEFT_WORKSPACE` or `~/.weft/workspace.json`.

## API

```ts
import {
  addProject,
  readWorkspace,
  listProjects,
  removeProject,
  discoverDesigns,
} from "@weft/workspace";

const config = await readWorkspace();
const { project } = await addProject("~/projects/Nexus");
const listings = await listProjects(config);
const designs = await discoverDesigns(project);
```

## Security

The registry is an allowlist, not a discovery service. A root must be added explicitly; every stored path is absolute and canonicalized with `realpath`. A future bridge/project picker must resolve every request through this registry before reading a design or starting a project dev server.

## Not here yet

- The bridge/UI project picker that consumes the registry.
- `weft.project.json` design/dev/source metadata.
- Per-project permissions and process control.
- Watching all registered projects from one hub.

See [`docs/local-workspace.md`](../../docs/local-workspace.md) for the full model and [`docs/security.md`](../../docs/security.md) for the boundary.
