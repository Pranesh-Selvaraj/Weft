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
- required session cookie on `/api/design`, `/api/open` and `/api/live`;
- workspace `/api/open` accepts only design paths discovered inside registered project roots; `weft dev <dir>` remains the explicit single-design escape hatch;
- Host and Origin checks against the loopback host and port;
- constant-time token comparison and a 1 MiB WebSocket payload limit;
- security headers (`nosniff`, no-referrer, frame-ancestors, object/base restrictions);
- deterministic schema and semantic validation before writes;
- path traversal and absolute-path checks for design files;
- atomic page writes;
- command parsing, stable error codes, and inverse-based rollback on write failure;
- sandboxed snapshot iframes in the renderer;
- no database, no cloud dependency, no remote bind;
- GitHub CI, CodeQL, Dependabot, dependency review and branch protection for the repository.

## Known gaps

These are deliberately tracked before Weft is used on real projects:

- the token is single-user local hardening, not team authentication; a same-user process or browser tab with the cookie remains inside the trust boundary;
- restarting the bridge rotates the token and requires open tabs to reload;
- `weft dev <dir>` can still be pointed at any design directory the user can read by explicit command; only `weft workspace dev` enforces the registry;
- no per-project read/write permissions, audit log or dev-server supervisor;
- no process supervisor for project dev servers;
- no capture/extraction pipeline or origin allowlist yet;
- no asset server; images and snapshots are placeholders today;
- no audit log or per-agent permission boundary;
- no published, signed release artifacts.

## Planned controls and branch order

1. `security/bridge-auth` — implemented: loopback-only host validation, random per-run session cookie, Origin/Host checks, WebSocket payload limits, timing-safe comparisons.
2. `feat/workspace-registry` — implemented: explicit workspace roots and design discovery; never scan the home directory.
3. `feat/workspace-picker` — implemented: bridge/UI project switching, with `/api/open` accepting only designs discovered in the registry.
4. `feat/dev-server-control` — project-declared dev commands, no shell interpolation, process groups, health checks, logs, stop/restart, localhost-only targets.
5. `feat/extract-snapshots` — allowlisted capture origins, Playwright/CDP, sanitization, scoped CSS, asset rewriting, prompt-injection defenses.
6. `feat/agent-mcp` — agent tool contract and per-project permissions, context packets, audit log.
7. `feat/export` — tokens and frames to implementation artifacts.

## Security review checklist for changes

- Does the change widen filesystem, process, network or agent permissions?
- Can an untrusted design file or captured page influence a privileged action?
- Are all new paths resolved through the design/workspace allowlist?
- Are new WebSocket messages authenticated and size-limited?
- Are captured scripts, external requests and secrets blocked?
- Is there a test proving the negative case, not just the happy path?
