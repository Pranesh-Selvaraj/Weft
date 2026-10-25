# Security policy

Weft is pre-alpha. It has no published release yet; `main` is the only supported line.

## Reporting a vulnerability

Use **[GitHub private vulnerability reporting](https://github.com/Pranesh-Selvaraj/Weft/security/advisories/new)**. Do not open a public issue for a suspected vulnerability.

Include:

- the affected commit or version;
- a reproduction (commands, design file, browser state, or a minimal harness);
- the impact, including whether the issue requires a local process, a malicious design file, a captured page, or a remote peer;
- any suggested fix or mitigation.

You will get an acknowledgement, an assessment, and a coordinated disclosure plan. Please do not publish details before a fix is available.

## Scope

In scope:

- the bridge, CLI, session engine, declared dev-server manager, extractor and renderer;
- design-file parsing, path handling, snapshot sandboxing and agent command paths;
- GitHub workflows, release configuration and repository automation.

Usually out of scope:

- vulnerabilities in third-party dependencies (report upstream; Dependabot tracks them here);
- designs or applications authored by users;
- vulnerabilities in the coding agents or harnesses connected to Weft;
- social engineering or a compromised local account.

## Current local security model

Weft is a local-first tool, not a hosted service.

- The bridge accepts only loopback bind hosts (`127.0.0.1`, `localhost`, `::1`). Non-loopback hosts are rejected.
- A random per-run token is set as an `HttpOnly`, `SameSite=Strict` session cookie on the app page. `/api/design`, `/api/live` and `/api/dev` require it; cross-origin requests and WebSocket handshakes are rejected. Host and Origin checks block DNS rebinding and cross-site browser access.
- Project dev servers can only run argv commands declared in `weft.project.json`; the browser cannot supply a command. URLs must be loopback, cwd must stay inside the registered project root, and managed children are stopped as a process group. A declared command still runs with your user permissions and is not sandboxed.
- Extraction requires an exact loopback origin in `extract.origins`. The capture browser routes external HTTP/WebSocket traffic away, blocks service workers/dialogs/popups, and uses a fresh context. Captured markup/CSS are sanitized in the browser and verified again in Node; scripts/forms/frames/event handlers/external URLs are rejected, images become data URLs, and the result renders in a sandboxed iframe under a restrictive CSP.
- WebSocket payloads are limited to 1 MiB, and responses carry restrictive security headers.
- Restarting the bridge rotates the token; reload open tabs after a restart.
- The bridge reads a design directory and writes page files/manifests inside it after a valid command, and removes a page file when a validated page-removal command is applied. Paths are checked, writes are atomic, page data and the resulting design are validated before writing, and the manifest path cannot be replaced by a page file.
- Design files and captured HTML are untrusted input. HTML snapshots render in a sandboxed iframe without scripts and with a data-only CSP. Captured text can still contain prompt-injection instructions; agents must treat it as untrusted product data, never as instructions.
- Agents run with the permissions of your user account. Only connect agents you trust. Only declare dev commands you trust; they can read files, reach the network and start other processes.
- Do not put secrets in design files, comments, sample assets or captured pages. They are committed to your repository.

## Hardening roadmap

The next security work is documented in [`docs/security.md`](docs/security.md) and will land in separate branches:

1. Per-project read/write permissions and optional resource limits on top of the workspace allowlist.
2. Workspace audit logging and permission boundaries for agents.
3. A trust marker for captured content and a stricter capture report.

## Disclosure timeline

We aim to acknowledge a report promptly, agree a disclosure date after a fix is available, and credit reporters who want credit. There is no bug bounty yet.
