# Local workspace model

The question this document answers: **Weft runs locally — how does it see and interact with other projects under development?**

The short answer: it does not discover them by scanning the machine. A local workspace is an **explicit allowlist** of project roots, project configuration and local origins. The bridge is a hub; each project is a registered guest with a narrow, declared surface.

## What already works

The `@weft/workspace` registry, `weft workspace init/add/list/remove` and `weft workspace dev` now provide the explicit project allowlist, design discovery and browser design picker described below. `@weft/dev-server` adds declared project servers, attach mode, readiness, logs and process-group stop. `@weft/extract` adds an allowlisted capture path from a running loopback page into sanitized snapshot files.

`weft dev <design.weft>` can point at a design directory anywhere on disk, including inside another repository:

```bash
cd ~/projects/Weft
pnpm build
node packages/cli/dist/main.js dev ~/projects/Nexus/designs/app.weft
```

The bridge watches that directory and writes pages there. The design can live in the product repository while the Weft checkout stays separate. This is enough for one project at a time.

What does not exist yet:

- a bridge/UI Extract button (the CLI is the current entry point);
- serving project assets and thumbnails;
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
  "devServer": {
    "command": ["pnpm", "dev"],
    "cwd": ".",
    "url": "http://127.0.0.1:3000/",
    "env": { "PORT": "3000" },
    "readyTimeoutMs": 30000,
    "stopTimeoutMs": 5000
  },
  "extract": {
    "origins": ["http://127.0.0.1:3000"]
  }
}
```

- `devServer.command` is an **argv array**, not a shell string. No interpolation, no pipes, no `&&`.
- `devServer.cwd` must stay inside the project root, including after `realpath`.
- `devServer.url` must be loopback (`localhost`, `127.0.0.1`, `[::1]`), HTTP(S), with no credentials.
- `devServer.env` is merged over the bridge environment; there is no implicit `.env` loading.
- A project can omit `command` if the user already runs the server elsewhere; Weft attaches by URL and can still run an allowlisted CLI capture against it.
- `extract.origins` is the exact loopback origin allowlist for capture; it is required before `weft extract` will launch a browser.
- `designs` and `sourceRoots` remain proposed fields for later slices; unknown fields are ignored for now, so they can land without a config version bump.

### Running another project's app

Two modes:

1. **Attach** — the user already runs the dev server in a terminal. Weft is given the loopback URL and only performs HTTP/headless-browser operations against that origin.
2. **Supervise** — Weft starts the declared command, captures logs, waits for readiness, and stops the process group. This requires an explicit Start action in the browser; the command must come from checked-in project config, never from a browser message.

The implemented manager:

- runs as the current user with the project cwd;
- uses the argv array directly with `shell: false` and an explicit environment;
- creates a process group and kills the group on stop;
- caps output in a bounded in-memory log ring;
- checks readiness against the declared loopback URL;
- never exposes a general “run command” tool to the browser or an agent.

See [Declared dev servers](dev-server.md) for the exact rules and limits.

### Extraction across projects

A design file in project A can capture a page from project B only if the capture origin is allowlisted in the project config used for the command. The flow:

```text
allowlisted project root
        +
allowlisted loopback origin
        ▼
Playwright/CDP capture (scripts stripped, assets rewritten, CSS scoped)
        ▼
snapshot files beside the target design page
        ▼
source metadata (URL, selector, viewport, timestamp)
```

The extractor refuses non-allowlisted or non-loopback origins, blocks external HTTP/WebSocket traffic during capture, never runs captured scripts inside the editor, and treats captured text as untrusted data for agents. See [Snapshot extraction](extraction.md).

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

### 4. `feat/workspace-picker` (implemented)

Bridge APIs and browser UI that consume the registry: list projects/designs, open a design, and switch without restarting the hub.

Exit criteria: the browser lists only registered projects/designs; opening a path outside the registry is rejected; switching designs resets sessions cleanly; one local hub can serve multiple registered designs.

`weft workspace dev` now starts that hub, and the browser has a design selector. Declared dev servers and snapshot extraction are implemented in the following slices.

### 5. `feat/dev-server-control` (implemented)

`weft.project.json`, attach mode, supervised dev commands, readiness checks, logs and process-group shutdown.

Exit criteria: Weft can start and stop one declared dev server for a registered project; it never executes a command not declared in project config; it cannot start a server outside the root; stopping leaves no orphan process.

The manager and browser Project server panel now implement this. See [Declared dev servers](dev-server.md) and ADR 0012.

### 6. `feat/extract-snapshots` (implemented)

Capture allowlist, Playwright/CDP capture, sanitized snapshot files, source metadata, asset rewriting and prompt-injection defenses.

Exit criteria: a registered page from an allowlisted loopback origin becomes a snapshot frame that renders without scripts; non-allowlisted origins are refused; captured content is readable by an agent without executing it.

The `weft extract` command, `@weft/extract` and the sandboxed renderer payload path now implement this. See [Snapshot extraction](extraction.md) and ADR 0013. A bridge/UI Extract action remains a follow-up.

### 7. `feat/assets-and-thumbnails`

Asset serving, image rendering, content-addressed assets and thumbnail generation. Snapshot payload loading for extracted frames is implemented; image-node assets are still placeholders.

Exit criteria: images and captured pages render in the browser without escaping the design directory; missing assets fail validation; no arbitrary local file can be requested through the asset route.

### 8. `feat/editor-create-tools` (implemented)

Create frames, text and shapes from the UI, plus a basic layer tree and selection range.

Exit criteria: a user can create a new page and frame from the browser, not only edit an existing starter; every creation is a normal command with undo.

Node creation (frames, text, rectangles, ellipses), parent-aware insertion, the layer tree and browser page create/delete now use ordinary page or document commands with inverses and undo. See ADR 0014 and ADR 0015. Page rename/reorder are now implemented; page duplicate and background/token editors remain follow-ups.

### 9. `feat/agent-mcp` (partially implemented)

MCP server, tool contract, context packets, per-project permissions and audit log.

Exit criteria: pi/opencode/Claude Code/Codex can list pages, read a node, apply a command and receive a screenshot/context packet through the documented contract; every tool call is attributed.

`@weft/mcp` and `weft mcp` now expose allowlisted reads, page/node commands, page document commands, validation and a JSON context packet over stdio; writes are attributed to the fixed MCP actor. Per-project/tool permissions, a durable audit log, screenshots and a published binary remain follow-ups. See [MCP server](mcp.md) and ADR 0016.

### 10. `feat/export`

Tokens to CSS variables, a frame to HTML/CSS, and a structured handoff packet for implementation.

Exit criteria: a developer can take one frame and its tokens into a product codebase without reading Weft internals.

## Near-term workaround

Until the workspace registry exists, use one terminal per project:

```bash
node /path/to/Weft/packages/cli/dist/main.js dev ~/projects/Nexus/designs/app.weft --port 5250
```

The design files live in the Nexus repo, the editor runs from Weft, and agents in the Nexus repo edit the same files. That is already a usable local loop; the workspace hub removes the manual switching and adds supervised apps, extraction and per-project policy.
