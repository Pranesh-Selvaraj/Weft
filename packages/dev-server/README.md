# @weft/dev-server

Declared project dev servers for the local workspace: config loading, attach mode, readiness probes, bounded logs and process-group supervision. The bridge and browser panel consume this package; it does not serve HTTP itself.

## Config

`weft.project.json` at the registered project root:

```json
{
  "version": 1,
  "devServer": {
    "url": "http://127.0.0.1:3000/",
    "command": ["pnpm", "dev"],
    "cwd": ".",
    "env": { "PORT": "3000" },
    "readyTimeoutMs": 30000,
    "stopTimeoutMs": 5000
  }
}
```

- `url` is required and must be loopback HTTP(S) with no credentials or fragment.
- `command` is an argv array. Without it, the server is attach-only.
- `cwd` must stay inside the project root, including after `realpath`.
- The config file may be at most 64 KiB and must not be a symlink.
- Unknown fields are ignored for forward compatibility.

See [`docs/dev-server.md`](../../docs/dev-server.md) for the full lifecycle and security boundary, and ADR 0012 for the reasoning.

## API

```ts
import {
  DevServerManager,
  loadProjectConfig,
  validateProjectConfig,
} from "@weft/dev-server";

const manager = new DevServerManager({
  projects: [{ path: "/abs/project", name: "Project" }],
  onChange: (snapshot) => console.log(snapshot.status),
});
await manager.init();
await manager.start("/abs/project");
await manager.stop("/abs/project");
await manager.close();
```

`start` throws a `DevServerError` on invalid config, missing command, unreachable attach target, readiness timeout or early exit. The manager still records the error and logs in `snapshotOf(projectPath)`. `stop` kills the managed process group; attach mode only detaches. `close` stops every managed server.

Snapshots include `status`, `mode`, `url`, `pid`, `startedAt`, `exitCode`, `error`, `configError` and the last 100 log entries. Logs are in memory only.

## Behaviours

- Readiness is an HTTP status below 500, polled every 250 ms until `readyTimeoutMs`.
- Managed children use `shell: false`, an explicit environment and a process group on POSIX.
- Stop sends `SIGTERM` to the group, waits, then `SIGKILL`; Windows uses `taskkill /T /F`.
- Start failures and unexpected exits become visible states, never silent promise rejections.
- A symlinked config or a cwd escaping the root is refused.

## Not here yet

- Dependency installation, port allocation, multiple servers per project.
- Persistent logs, resource limits, restart policy, health paths.
- Monitoring an attached external process after the initial probe.

## Test

```bash
pnpm --filter @weft/dev-server test
```

The suite covers config normalization and rejection, symlink escape checks, managed start/readiness/log/stop with process-group cleanup, attach mode without ownership, early exits with output, readiness timeouts and the missing-config case.
