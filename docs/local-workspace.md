# Local workspace model

The question this document answers: **Weft runs locally — how does it see and interact with other projects under development?**

The short answer: it does not discover them by scanning the machine. A local workspace is an **explicit allowlist** of project roots, project configuration and local origins. The bridge is a hub; each project is a registered guest with a narrow, declared surface.

## What already works

The `@weft/workspace` registry and `weft workspace init/add/list/remove` now provide the explicit project allowlist and design discovery described below. It does not yet drive a project picker or the bridge.

`weft dev <design.weft>` can point at a design directory anywhere on disk, including inside another repository:

```bash
cd ~/projects/Weft
pnpm build
node packages/cli/dist/main.js dev ~/projects/Nexus/designs/app.weft
```

The bridge watches that directory and writes pages there. The design can live in the product repository while the Weft checkout stays separate. This is enough for one project at a time.

What does not exist yet:

- a bridge/UI project picker that consumes the registry;
- starting/stopping project dev servers;
- capturing pages from those servers;
- serving project assets;
- per-project permissions and an audit trail.

## The model: a local workspace hub

```text
~/.weft/workspace.json          # explicit roots, no scanning
        │
        ▼
   Weft hub (localhost) ─────── project A  ── designs/*.weft
        │       │                  ├── dev server :3000
        │       │                  └── source roots
        │       └──────────────── project B  ── designs/*.weft
        │                              ├── dev server :5173
        │                              └── source roots
        ▼
   Browser editor (project picker, design tabs, live sessions)
        │
        └──────── agents in each project cwd (files + CLI/MCP)
```

The hub is the current bridge grown up: one local process, one browser surface, many project sessions. It does not become a general file browser.

### Workspace registry

`~/.weft/workspace.json` (or a repository-level `weft.workspace.json`) lists only roots the user added:

```json
{
  "version": 1,
  "projects": [
    { "path": "/home/me/projects/Nexus", "name": "Nexus" },
    { "path": "/home/me/projects/Tempo", "name": "Tempo" }
  ]
}
```

```bash
weft workspace add ~/projects/Nexus
weft workspace remove ~/projects/Nexus
weft workspace list
```

Rules:

- no recursive home-directory scanning, no auto-discovery of arbitrary repos;
- every path is canonicalized and must stay inside a registered root;
- symlinks are resolved and checked against the allowlist;
- removing a root drops its sessions and file watches;
- the browser never receives a raw filesystem path it can use to escape the allowlist.

### Per-project configuration

Each project can check in a small `weft.project.json`:

```json
{
  "version": 1,
  "designs": ["designs/app.weft", "designs/settings.weft"],
  "dev": {
    "command": ["pnpm", "dev"],
    "cwd": ".",
    "url": "http://127.0.0.1:3000",
    "readyPath": "/"
  },
  "sourceRoots": ["apps/web/src"],
  "extract": {
    "origins": ["http://127.0.0.1:3000"]
  }
}
```

- `dev.command` is an **argv array**, not a shell string. No interpolation, no pipes, no `&&`.
- `dev.cwd` must be inside the project root.
- `dev.url` must be loopback (`localhost`, `127.0.0.1`, `[::1]`).
- `sourceRoots` are hints for agents and extraction metadata, not a write permission.
- `extract.origins` is an explicit capture allowlist. No arbitrary URL fetching.
- A project can omit `dev` if the user already runs the server elsewhere; Weft can attach by URL and still extract.
- Unknown fields are preserved but ignored until a later version defines them.

### Running another project's app

Two modes:

1. **Attach** — the user already runs the dev server in a terminal. Weft is given the loopback URL and only performs HTTP/headless-browser operations against that origin.
2. **Supervise** — Weft starts the declared command, captures logs, waits for readiness, and stops the process group. This requires explicit approval in the UI or CLI; the command must come from checked-in project config, never from a browser message.

The supervisor should:

- run as the current user with the project cwd;
- use the argv array directly (`spawn(command, args, {cwd, env})`);
- inherit a filtered environment, not the whole shell environment;
- use a new process group and kill the group on stop;
- cap output and expose a log buffer;
- check readiness against the allowlisted URL;
- never expose a general “run command” tool to the browser or an agent.

### Extraction across projects

Once extraction exists, a design file in project A can capture a page from project B only if both the project root and the capture origin are allowlisted. The flow:

```text
allowlisted project root
        +
allowlisted loopback origin
        ▼
Playwright/CDP capture (scripts stripped, assets rewritten, CSS scoped)
        ▼
snapshot files beside the target design page
        ▼
source metadata (URL, selector, viewport, project, commit)
```

The extractor refuses production origins by default, blocks non-allowlisted hosts, never runs captured scripts inside the editor, and treats captured text as untrusted data for agents.

### Agents across projects

Agents do not need Weft to read their projects. They run in the project's own working directory:

```bash
cd ~/projects/Nexus
pi   # or opencode, Claude Code, Codex
```

They use the files and the `weft` CLI against `designs/app.weft`. The hub exposes the live session so their file writes appear in the browser. For in-canvas chat, the bridge will spawn an agent with:

- the project cwd;
- an allowlisted design directory and source roots;
- a session token;
- explicit permission for file writes, dev commands and extraction;
- an audit record of every tool call.

Autonomous agents should work in a **git worktree/branch**, not the live checkout; interactive agents can work in the live session with undo and attribution. The browser should never get an unrestricted shell.

### Git

The hub may read git status and create worktrees/branches, but it should not push or rewrite history. Design files and source changes remain reviewable in the project's normal git workflow. A future agent session can present a diff and let the user merge.

## Why not simpler alternatives?

| Alternative | Why it is not the default |
| --- | --- |
| **Scan the home directory or all repos** | Fast to build, unsafe and surprising. Weft would see credentials, private repos and unrelated work. An explicit registry is predictable and revocable. |
| **Open a local folder with the File System Access API** | Useful for a single Chromium user, but not available consistently across browsers and invisible to CLI agents. The bridge remains the universal path. |
| **Run a separate server per project with no hub** | Already possible (`weft dev` per design). It gives no project picker, shared presence, or cross-project extraction. The hub can start as an optional layer over this. |
| **Let the browser ask the bridge to run shell commands** | A browser compromise or malicious design becomes arbitrary code execution. Project-declared argv commands with approval are the boundary. |
| **A hosted service that mounts local projects** | Contradicts local-first, adds a trust boundary and credentials problem, and still needs a local agent. |

## Delivery branches and exit criteria

The work should land one branch at a time. Each branch is independently testable and does not assume a later branch exists.

### 1. `chore/security-baseline` (current)

CI, CodeQL, Dependabot, SECURITY.md, threat model, branch protection and repository security settings.

Exit criteria: `main` is protected, required checks run on every PR, dependency and secret scanning are enabled, and the security policy is published.

### 2. `security/bridge-auth` (implemented)

Loopback-only host validation, a random per-run session cookie, Origin/Host checks, WebSocket payload limits, and negative tests.

Exit criteria: no cross-site browser can read the API or open the WebSocket; a non-loopback bind is rejected unless a future explicit remote mode exists; oversized frames are rejected.

### 3. `feat/workspace-registry` (implemented)

Workspace file, `weft workspace add/list/remove`, and project/design discovery from the allowlist.

Exit criteria: the registry reads/writes atomically; paths are canonicalized; duplicate and missing roots are reported; discovery finds `weft.json` design directories while ignoring heavy, hidden and symlinked directories; the CLI exposes human and JSON output.

### 4. `feat/workspace-picker`

Bridge APIs and browser UI that consume the registry: list projects/designs, open a design, and switch without restarting the hub.

Exit criteria: the browser lists only registered projects/designs; opening a path outside the registry is rejected; switching designs resets sessions cleanly; one local hub can serve multiple registered designs.

### 5. `feat/dev-server-control`

`weft.project.json`, attach mode, supervised dev commands, readiness checks, logs and process-group shutdown.

Exit criteria: Weft can start and stop one declared dev server for a registered project; it never executes a command not declared in project config; it cannot start a server outside the root; stopping leaves no orphan process.

### 6. `feat/extract-snapshots`

Capture allowlist, Playwright/CDP capture, sanitized snapshot files, source metadata, asset rewriting and prompt-injection defenses.

Exit criteria: a registered page from an allowlisted loopback origin becomes a snapshot frame that renders without scripts; non-allowlisted origins are refused; captured content is readable by an agent without executing it.

### 7. `feat/assets-and-thumbnails`

Asset serving, image rendering, snapshot payload loading, content-addressed assets and thumbnail generation.

Exit criteria: images and captured pages render in the browser without escaping the design directory; missing assets fail validation; no arbitrary local file can be requested through the asset route.

### 8. `feat/editor-create-tools`

Create frames, text and shapes from the UI, plus a basic layer tree and selection range.

Exit criteria: a user can create a new page and frame from the browser, not only edit an existing starter; every creation is a normal command with undo.

### 9. `feat/agent-mcp`

MCP server, tool contract, context packets, per-project permissions and audit log.

Exit criteria: pi/opencode/Claude Code/Codex can list pages, read a node, apply a command and receive a screenshot/context packet through the documented contract; every tool call is attributed.

### 10. `feat/export`

Tokens to CSS variables, a frame to HTML/CSS, and a structured handoff packet for implementation.

Exit criteria: a developer can take one frame and its tokens into a product codebase without reading Weft internals.

## Near-term workaround

Until the workspace registry exists, use one terminal per project:

```bash
node /path/to/Weft/packages/cli/dist/main.js dev ~/projects/Nexus/designs/app.weft --port 5250
```

The design files live in the Nexus repo, the editor runs from Weft, and agents in the Nexus repo edit the same files. That is already a usable local loop; the workspace hub removes the manual switching and adds supervised apps, extraction and per-project policy.
