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

- the bridge, CLI, session engine and renderer;
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
- A random per-run token is set as an `HttpOnly`, `SameSite=Strict` session cookie on the app page. `/api/design` and `/api/live` require it; cross-origin requests and WebSocket handshakes are rejected. Host and Origin checks block DNS rebinding and cross-site browser access.
- WebSocket payloads are limited to 1 MiB, and responses carry restrictive security headers.
- Restarting the bridge rotates the token; reload open tabs after a restart.
- The bridge reads a design directory and writes only page files inside it after a valid command. Paths are checked, writes are atomic, and page data is validated before writing.
- Design files and captured HTML are untrusted input. HTML snapshots render in a sandboxed iframe without scripts. Extraction is not shipped yet.
- Agents run with the permissions of your user account. Only connect agents you trust. The bridge does not yet supervise arbitrary project processes.
- Do not put secrets in design files, comments, sample assets or captured pages. They are committed to your repository.

## Hardening roadmap

The next security work is documented in [`docs/security.md`](docs/security.md) and will land in separate branches:

1. A workspace allowlist so the bridge can only see explicitly added project roots.
2. A process supervisor that runs only project-declared dev commands with explicit approval.
3. Capture allowlists and a stricter snapshot policy.
4. Workspace audit logging and permission boundaries for agents.

## Disclosure timeline

We aim to acknowledge a report promptly, agree a disclosure date after a fix is available, and credit reporters who want credit. There is no bug bounty yet.
