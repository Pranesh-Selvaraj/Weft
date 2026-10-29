# Security model

This document is the working threat model for Weft. It describes what the system trusts, what it does not, the controls that exist today, and the controls that are planned. `SECURITY.md` is the reporting policy; this file is the engineering map.

## Assets

- design files and their history in git;
- source code and local dev servers of the projects Weft is used on;
- the user's agent sessions, credentials and shell environment;
- the browser session that can edit designs;
- captured product pages and their assets.

## Trust boundaries

```text
Browser (editor UI) ── cookie/WebSocket ── Bridge (localhost)
       │                                         │
       │ sandboxed iframe                        │ filesystem + git
       ▼                                         ▼
Captured HTML / assets                    Project directories
       │                                         │
       └────────────── agents / harnesses ───────┘
```

- **The browser is not trusted** to send valid commands. Every command is parsed and validated by the bridge, then validated again against the resulting page before it is written.
- **Captured HTML is never trusted.** It renders in a sandboxed iframe without scripts. Extraction must sanitize, scope styles and block external network access by default.
- **Design files are untrusted input.** Manifest paths, node maps, ids and snapshot references are validated. Writes stay inside the design directory and are atomic.
- **Agents are trusted local processes, but not privileged by the bridge.** An agent with shell access already has the user's filesystem permissions; Weft should not give it a wider surface than the user chose.
- **Project dev servers are separate processes.** Weft must not execute arbitrary shell from a browser. Dev commands come from checked-in project configuration and are explicitly approved/started.

## Current controls

- loopback-only bind hosts; non-loopback hosts are rejected;
- per-run 256-bit session token in an `HttpOnly`, `SameSite=Strict` cookie;
- required session cookie on `/api/design`, `/api/open`, `/api/live` and `/api/dev`;
- workspace `/api/open` accepts only design paths discovered inside registered project roots; `weft dev <dir>` remains the explicit single-design escape hatch;
- project dev servers are declared as argv arrays in `weft.project.json`; the bridge never accepts a command from the browser;
- extraction requires an exact loopback origin in `extract.origins`; the capture browser routes HTTP/WebSocket traffic to allowlisted origins only, blocks service workers/dialogs/popups and uses a fresh context;
- captured markup/CSS are sanitized in the browser and then verified by a dependency-free Node pass that fails closed on executable tags, event attributes or non-data URLs; images are inlined as data URLs;
- snapshot payloads render in `sandbox=""` iframes with a CSP that allows only inline styles and `data:` images;
- the MCP server is stdio-only, accepts only designs in its startup workspace/single-design allowlist, can run with `--read-only`, reuses the same command validation/atomic writes, and attributes writes to the fixed MCP actor;
- static export adds no scripts, keeps snapshot payloads in sandboxed iframes, validates referenced files, and preserves unrelated files in a non-empty output directory;
- dev-server URLs are loopback HTTP(S) only, cwd is checked lexically and through `realpath`, the config file is a capped regular file that rejects symlinks, and managed children are stopped as a process group;
- `/api/dev/start` and `/api/dev/stop` require the session cookie and Origin check;
- Host and Origin checks against the loopback host and port;
- constant-time token comparison and a 1 MiB WebSocket payload limit;
- security headers (`nosniff`, no-referrer, frame-ancestors, object/base restrictions);
- deterministic schema and semantic validation before writes;
- path traversal and absolute-path checks for design files;
- atomic page/manifest writes; page creation/removal validates page ids, file paths, manifest collisions and the last-page invariant; the manifest path cannot be replaced by a page file;
- page removal writes the manifest before unlinking the old page file, so a failure cannot leave the manifest pointing at missing content;
- command parsing, stable error codes, and inverse-based rollback on write failure;
- sandboxed snapshot iframes in the renderer;
- no database, no cloud dependency, no remote bind;
- GitHub CI, CodeQL, Dependabot, dependency review and branch protection for the repository.

## Known gaps

These are deliberately tracked before Weft is used on real projects:

- the token is single-user local hardening, not team authentication; a same-user process or browser tab with the cookie remains inside the trust boundary;
- restarting the bridge rotates the token and requires open tabs to reload;
- `weft dev <dir>` can still be pointed at any design directory the user can read by explicit command; only `weft workspace dev` enforces the registry;
- no per-project read/write permissions or audit log;
- no sandbox, resource limit, network policy or credential isolation for declared dev-server commands; they run as the user;
- extraction fidelity is partial: external fonts/assets are blocked, canvas/video/iframes are omitted, and captured text can still carry prompt-injection instructions (treated as untrusted data, not executable code);
- capture requires a local Chromium/Chrome binary and executes the allowlisted app's own scripts during capture;
- no bridge/UI Extract action or git-commit metadata yet;
- page removal has no filesystem journal: a crash between manifest write and file unlink can leave an orphan page file; the page content needed for undo lives in the command inverse and in git history, not a durable transaction log;
- no asset server for image nodes and thumbnails; snapshot payloads are served inline;
- MCP has no per-project/tool permissions, durable audit log, rate limits or remote auth; a writable server can edit every design in its allowlist;
- no published, signed release artifacts or published CLI binary.

## Planned controls and branch order

1. `security/bridge-auth` — implemented: loopback-only host validation, random per-run session cookie, Origin/Host checks, WebSocket payload limits, timing-safe comparisons.
2. `feat/workspace-registry` — implemented: explicit workspace roots and design discovery; never scan the home directory.
3. `feat/workspace-picker` — implemented: bridge/UI project switching, with `/api/open` accepting only designs discovered in the registry.
4. `feat/dev-server-control` — implemented: project-declared argv commands, no shell interpolation, process groups, readiness probes, bounded logs, stop, and loopback-only targets.
5. `feat/extract-snapshots` — implemented: allowlisted capture origins, Playwright/Chromium capture, scoped computed CSS, data-URL assets, a browser sanitizer plus a fail-closed verifier, CSP/sandbox rendering and prompt-injection guidance.
6. `feat/agent-mcp` — partially implemented: stdio MCP server with allowlisted reads/writes, context packets, inverses and read-only mode; per-project/tool permissions and a durable audit log remain.
7. `feat/export` — tokens and frames to implementation artifacts.

## Security review checklist for changes

- Does the change widen filesystem, process, network or agent permissions?
- Can an untrusted design file or captured page influence a privileged action?
- Are all new paths resolved through the design/workspace allowlist?
- Are new WebSocket messages authenticated and size-limited?
- Are captured scripts, external requests and secrets blocked?
- Is there a test proving the negative case, not just the happy path?
