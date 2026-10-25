# 0011. Local bridge security boundary

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** Pranesh Selvaraj
- **Supersedes:** —
- **Superseded by:** —

## Context

The bridge now accepts browser commands, writes page files, watches project directories and will soon start talking to other local projects. Binding to localhost is not a security boundary: any local web page can target `http://127.0.0.1:<port>` or open a WebSocket to it, DNS rebinding can make a public hostname resolve to loopback, and a browser tab running old code can keep a stale session alive after a restart.

The bridge needs a boundary that is appropriate for a single-user local tool, without pretending to be multi-user authentication.

## Decision

### 1. Loopback only

The bridge accepts only these bind hosts: `127.0.0.1`, `localhost` and `::1`. `[::1]` is normalized to `::1`. Any other host is rejected before the server starts with `host.unsafe`.

This is not a temporary default; remote/team access requires a separate design with authentication, TLS and explicit consent.

### 2. A per-run session token

On start, the bridge generates a 256-bit random token. The HTML response sets it as:

```text
Set-Cookie: weft_session=<token>; HttpOnly; SameSite=Strict; Path=/
```

- The cookie is `HttpOnly`, so app JavaScript cannot read it; `SameSite=Strict` prevents cross-site requests from carrying it.
- `GET /api/design` and the `/api/live` WebSocket require the cookie.
- `GET /api/health` is public but still requires an allowed Host; it exposes only readiness, revision and page count.
- The token rotates on every bridge start. A browser tab from a previous run must reload the app; the bridge does not silently issue a new token to an unauthenticated API request.
- Token comparison uses `crypto.timingSafeEqual` with equal-length buffers.

### 3. Host and Origin checks

- The `Host` header must match `127.0.0.1:<port>`, `localhost:<port>`, or `[::1]:<port>`. This blocks DNS rebinding to a public hostname.
- If an `Origin` header is present, it must match one of the loopback origins. Cross-origin browser requests and WebSockets are rejected with 403.
- A missing `Origin` is allowed only with a valid session cookie, so CLI and test WebSocket clients can connect. Browsers always send an Origin for WebSocket handshakes.

### 4. Transport limits and headers

- The WebSocket server rejects payloads larger than 1 MiB.
- Every HTTP response sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'none'`, and a restrictive `Permissions-Policy`.
- Failed WebSocket upgrades receive an HTTP 401/403 and a closed socket, not a silent hang.
- Static files still resolve only under the built app directory; design files still resolve only under the design directory.

### 5. What this is not

This is local single-user hardening, not team authentication. It does not provide:

- user accounts or roles;
- a remote bind or TLS;
- per-project permissions;
- protection against a malicious process running as the same OS user (it can read the cookie store or the files directly);
- revocation beyond restarting the bridge.

Those are workspace/relay features with their own decisions.

## Consequences

**Easier**

- A random public web page cannot drive the bridge or read the design through the browser.
- DNS rebinding and cross-origin WebSocket attempts are rejected.
- The browser app works unchanged: it loads the page, receives the cookie, and uses it for fetch and WebSocket automatically.
- Tests can exercise the boundary with the exposed per-run token.

**Harder, and knowingly accepted**

- Any non-browser client must send the cookie (or the app must set it first).
- Restarting the bridge invalidates open tabs until they reload.
- There is no remote collaboration path; `--host` is deliberately restricted.
- A local process running as the same user remains inside the trust boundary.
- The token is exposed as a public property for tests and local tooling, not as a remote API.
- A future relay needs a separate auth model; this token is not it.

## Alternatives considered

| Alternative | Why it lost |
| --- | --- |
| **Trust localhost with no token** | A local web page can target localhost, and DNS rebinding can make a public name resolve there. Localhost is a network location, not a trust boundary. |
| **Token in the URL/query string** | Leaks through history, logs, screenshots and referrers; harder to rotate. |
| **Authorization header from the app** | The WebSocket API cannot set arbitrary headers, so the browser would need a second transport or a query token. A cookie is the natural same-origin credential. |
| **HTTP Basic auth** | Puts credentials in a header managed by the browser; awkward for WebSocket and unnecessary for a per-run random token. |
| **Unix domain socket only** | Better local isolation, but browsers cannot connect directly and it complicates cross-platform packaging. A loopback HTTP/WS server plus token is the portable path. |
| **OS file permissions alone** | Design files are protected, but the bridge's HTTP/WS surface is not. |
| **mTLS or a local reverse proxy** | Heavy for a local developer tool; belongs to a future team/relay mode. |
| **Rely on `SameSite=Strict` alone** | Ports on the same host are same-site, so a malicious localhost page would still send the cookie. Host and Origin checks are required. |

## Prior art / what this replaces

ADR 0009 shipped the bridge read-only and localhost-bound without authentication; ADR 0010 made it a writer. This record adds the boundary those capabilities require. It does not change the document, command or session semantics.
