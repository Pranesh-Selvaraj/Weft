import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch, type FSWatcher } from "chokidar";
import WebSocket, { WebSocketServer } from "ws";
import {
  createCommandEnvelope,
  readPageCommand,
  serialize,
  WeftCommandError,
  WeftOperationError,
  WeftValidationError,
  type CommandActor,
  type DesignFile,
  type DesignManifest,
} from "@weft/core";
import { DevServerError, DevServerManager, type DevServerSnapshot } from "@weft/dev-server";
import { readDesign, writePageFile, WeftIoError } from "@weft/design-io";
import { PageSession } from "@weft/session";
import { listProjects, readWorkspace } from "@weft/workspace";
import {
  encodeUpdate,
  type BridgeMessage,
  type CommandRequestMessage,
  type DesignPayload,
  type InitMessage,
  type WorkspacePayload,
  type WirePage,
} from "./protocol.js";
import { serveStatic } from "./static.js";

const DEFAULT_WEB_DIST = fileURLToPath(
  new URL("../../../apps/web/dist", import.meta.url),
);
const DEFAULT_PORT = 5250;
const SESSION_COOKIE = "weft_session";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_WS_PAYLOAD = 1024 * 1024;

export interface BridgeOptions {
  designDir: string;
  host?: string;
  port?: number;
  /**
   * Directory containing the built web app. Defaults to apps/web/dist in this
   * repository. Pass null to run API/WebSocket only (used by tests).
   */
  webDist?: string | null;
  /** Watch the design directory for changes. Default: true. */
  watch?: boolean;
  /**
   * Enable the workspace picker by exposing the registered projects and
   * allowing the browser to open another registered design.
   */
  workspaceFile?: string;
}

export class WeftBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WeftBridgeError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Only expose messages from errors we construct or from the document layer.
 * Unexpected exceptions may carry stack or filesystem context, so their text
 * stays in the server log instead of crossing the bridge API.
 */
function errorMessage(error: unknown): string {
  if (
    error instanceof WeftBridgeError ||
    error instanceof DevServerError ||
    error instanceof WeftCommandError ||
    error instanceof WeftOperationError ||
    error instanceof WeftValidationError ||
    error instanceof WeftIoError
  ) {
    return error.message;
  }
  return "Internal bridge error.";
}

function sameManifest(left: DesignManifest, right: DesignManifest): boolean {
  return serialize(left) === serialize(right);
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

function displayHost(host: string): string {
  return host === "::1" ? "[::1]" : host;
}

function errorCode(error: unknown): string {
  if (
    error instanceof WeftCommandError ||
    error instanceof WeftOperationError ||
    error instanceof WeftIoError
  ) {
    return error.code;
  }
  return "command.error";
}

function readActor(value: unknown): CommandActor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new WeftCommandError("command.actor", "actor must be a JSON object.");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new WeftCommandError("command.actor", "actor.id must be a non-empty string.");
  }
  if (value.kind !== "human" && value.kind !== "agent" && value.kind !== "system") {
    throw new WeftCommandError(
      "command.actor",
      'actor.kind must be "human", "agent" or "system".',
    );
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    throw new WeftCommandError("command.actor", "actor.name must be a string when present.");
  }
  return {
    id: value.id,
    kind: value.kind,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
  };
}

/**
 * Local live bridge.
 *
 * The bridge owns one Yjs PageSession per page, watches the design directory,
 * ingests whole-page file writes into those sessions, and broadcasts the
 * resulting Yjs updates. It is read-only for now: it serves the built app and
 * streams state, but does not accept client commands or write canonical files.
 */
export class WeftBridge {
  designDir: string;

  readonly sessionToken: string;

  private readonly workspaceFile: string | null;
  private workspace: WorkspacePayload | null = null;
  private devServers: DevServerManager | null = null;
  private designVersion = 0;

  private readonly host: string;
  private readonly requestedPort: number;
  private readonly webDist: string | null;
  private readonly watchEnabled: boolean;
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly sessions = new Map<string, PageSession>();
  private readonly unsubs = new Map<string, () => void>();

  private manifest: DesignManifest | null = null;
  private revision = 0;
  private port = 0;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private reloading = false;
  private pending = false;
  private closing = false;

  constructor(options: BridgeOptions) {
    this.designDir = resolve(options.designDir);
    this.workspaceFile = options.workspaceFile
      ? resolve(options.workspaceFile)
      : null;
    const requestedHost = options.host ?? "127.0.0.1";
    this.host = requestedHost === "[::1]" ? "::1" : requestedHost;
    if (!LOOPBACK_HOSTS.has(this.host)) {
      throw new WeftBridgeError(
        "host.unsafe",
        `Host ${JSON.stringify(requestedHost)} is not loopback. The bridge is local-only.`,
      );
    }
    this.sessionToken = randomBytes(32).toString("base64url");
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.watchEnabled = options.watch !== false;
    const webDist = options.webDist === undefined ? DEFAULT_WEB_DIST : options.webDist;
    this.webDist = webDist === null ? null : resolve(webDist);

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WS_PAYLOAD,
    });

    this.server.on("upgrade", (request, socket, head) => {
      const url = this.requestUrl(request);
      if (url.pathname !== "/api/live") {
        socket.destroy();
        return;
      }
      if (!this.isAllowedHost(request)) {
        this.rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      if (!this.isAuthorized(request)) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      if (!this.isAllowedOrigin(request)) {
        this.rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  get url(): string {
    return `http://${displayHost(this.host)}:${this.port}`;
  }

  async start(): Promise<this> {
    if (this.webDist && !existsSync(join(this.webDist, "index.html"))) {
      throw new WeftBridgeError(
        "web.missing",
        `Built web app not found at ${this.webDist}. Run pnpm build first, or pass a webDist option.`,
      );
    }

    try {
      await this.loadWorkspace();
      await this.loadInitial();
      await this.listen();
      if (this.watchEnabled) await this.startWatcher();
      return this;
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    await this.watcher?.close().catch(() => undefined);
    this.watcher = undefined;

    await this.devServers?.close().catch(() => undefined);
    this.devServers = null;

    for (const unsubscribe of this.unsubs.values()) unsubscribe();
    this.unsubs.clear();
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();

    for (const client of this.clients) {
      try {
        client.close(1001, "bridge stopping");
      } catch {
        // already closed
      }
    }
    this.clients.clear();

    await new Promise<void>((resolveClose) => {
      this.wss.close(() => resolveClose());
    });
    await new Promise<void>((resolveClose, rejectClose) => {
      if (!this.server.listening) {
        resolveClose();
        return;
      }
      this.server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    });
    this.closing = false;
  }

  private async loadWorkspace(): Promise<void> {
    if (!this.workspaceFile) return;
    const config = await readWorkspace(this.workspaceFile);
    const listings = await listProjects(config);
    const designs = listings.flatMap((listing) => listing.designs);
    if (designs.length === 0) {
      throw new WeftBridgeError(
        "workspace.empty",
        `No designs found in workspace ${this.workspaceFile}. Run weft workspace add <project> first.`,
      );
    }

    const active = resolve(this.designDir);
    if (!designs.some((design) => resolve(design.path) === active)) {
      throw new WeftBridgeError(
        "workspace.design",
        `Design ${active} is not in workspace ${this.workspaceFile}.`,
      );
    }

    const devServers = new DevServerManager({
      projects: listings.map((listing) => ({
        path: listing.path,
        name: listing.name,
      })),
      onChange: (server) => this.handleDevServerChange(server),
    });
    await devServers.init();
    this.devServers = devServers;

    this.workspace = {
      file: this.workspaceFile,
      activeDesignPath: active,
      projects: listings.map((listing) => ({
        path: listing.path,
        name: listing.name,
        exists: listing.exists,
        designs: listing.designs,
        ...(listing.error ? { error: listing.error } : {}),
      })),
      servers: devServers.snapshots(),
    };
  }

  private handleDevServerChange(server: DevServerSnapshot): void {
    if (!this.workspace || this.closing) return;
    const servers = this.workspace.servers.map((candidate) =>
      candidate.projectPath === server.projectPath ? server : candidate,
    );
    this.workspace = { ...this.workspace, servers };
    this.broadcast({ type: "dev", server });
  }

  private async loadInitial(): Promise<void> {
    const design = await readDesign(this.designDir, { requireFiles: false });
    this.manifest = design.manifest;
    this.rebuildSessions(design);
    this.revision = 1;
  }

  private rebuildSessions(design: DesignFile): void {
    for (const unsubscribe of this.unsubs.values()) unsubscribe();
    this.unsubs.clear();
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();

    const tokens = design.manifest.tokens;
    const assets = design.manifest.assets;
    try {
      for (const page of design.pages) {
        const session = PageSession.fromPage(page, { tokens, assets });
        const unsubscribe = session.onUpdate((update) => {
          this.broadcast({
            type: "update",
            revision: this.revision,
            pageId: page.id,
            update: encodeUpdate(update),
          });
        });
        this.sessions.set(page.id, session);
        this.unsubs.set(page.id, unsubscribe);
      }
    } catch (error) {
      for (const session of this.sessions.values()) session.destroy();
      this.sessions.clear();
      throw error;
    }
  }

  private async listen(): Promise<void> {
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error): void => {
        this.server.off("listening", onListening);
        rejectListen(error);
      };
      const onListening = (): void => {
        this.server.off("error", onError);
        const address = this.server.address();
        if (address && typeof address === "object") this.port = address.port;
        resolveListen();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.requestedPort, this.host);
    });
  }

  private async startWatcher(): Promise<void> {
    const watcher = watch(this.designDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      ignored: (path) => this.isIgnored(path),
    });
    this.watcher = watcher;

    await new Promise<void>((resolveReady, rejectReady) => {
      const onReady = (): void => {
        watcher.off("error", onError);
        resolveReady();
      };
      const onError = (error: unknown): void => {
        watcher.off("ready", onReady);
        rejectReady(error);
      };
      watcher.once("ready", onReady);
      watcher.once("error", onError);
    });

    watcher.on("all", () => this.scheduleReload());
    watcher.on("error", (error: unknown) => {
      this.broadcast({
        type: "error",
        revision: this.revision,
        message: `Watch error: ${errorMessage(error)}`,
      });
    });
  }

  private isIgnored(path: string): boolean {
    const normalized = path.replaceAll("\\", "/");
    return (
      normalized.includes("/.git/") ||
      normalized.endsWith("/.git") ||
      normalized.includes("/node_modules/") ||
      normalized.includes("/.weft-cache/") ||
      normalized.endsWith(".tmp")
    );
  }

  private scheduleReload(): void {
    if (this.closing) return;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined;
      void this.reload();
    }, 60);
  }

  private async reload(): Promise<void> {
    if (this.closing) return;
    if (this.reloading) {
      this.pending = true;
      return;
    }
    this.reloading = true;

    try {
      const version = this.designVersion;
      const design = await readDesign(this.designDir, { requireFiles: false });
      if (version !== this.designVersion) return;
      const manifestChanged =
        !this.manifest || !sameManifest(this.manifest, design.manifest);

      if (manifestChanged) {
        this.manifest = design.manifest;
        this.rebuildSessions(design);
        this.revision += 1;
        this.broadcastInit();
        return;
      }

      this.revision += 1;
      for (const page of design.pages) {
        const session = this.sessions.get(page.id);
        if (!session) {
          this.manifest = design.manifest;
          this.rebuildSessions(design);
          this.broadcastInit();
          return;
        }
        const result = session.ingestPage(page);
        if (result.conflicts.length > 0) {
          this.broadcast({
            type: "conflict",
            revision: this.revision,
            pageId: page.id,
            conflicts: result.conflicts,
          });
        }
      }
    } catch (error) {
      this.broadcast({
        type: "error",
        revision: this.revision,
        message: errorMessage(error),
      });
      console.error("[weft bridge] reload failed:", error);
    } finally {
      this.reloading = false;
      if (this.pending) {
        this.pending = false;
        this.scheduleReload();
      }
    }
  }

  private requestUrl(request: IncomingMessage): URL {
    return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  }

  private allowedHosts(): Set<string> {
    return new Set(
      [...LOOPBACK_HOSTS].map((host) => `${displayHost(host)}:${this.port}`),
    );
  }

  private allowedOrigins(): Set<string> {
    return new Set(
      [...LOOPBACK_HOSTS].map((host) => `http://${displayHost(host)}:${this.port}`),
    );
  }

  private isAllowedHost(request: IncomingMessage): boolean {
    const host = request.headers.host;
    return typeof host === "string" && this.allowedHosts().has(host);
  }

  private isAllowedOrigin(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    return this.allowedOrigins().has(origin);
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const provided = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (!provided) return false;
    const expectedBuffer = Buffer.from(this.sessionToken);
    const providedBuffer = Buffer.from(provided);
    return (
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer)
    );
  }

  private ensureSessionCookie(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    if (this.isAuthorized(request)) return;
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${this.sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
    );
  }

  private applySecurityHeaders(response: ServerResponse): void {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
    );
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
  }

  private rejectUpgrade(
    socket: import("node:stream").Duplex,
    status: number,
    reason: string,
  ): void {
    socket.write(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.applySecurityHeaders(response);

    try {
      const url = this.requestUrl(request);
      if (!this.isAllowedHost(request)) {
        this.sendJson(response, 403, { ok: false, error: { code: "host.forbidden" } });
        return;
      }

      if (url.pathname === "/api/open") {
        if (request.method !== "POST") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
          return;
        }
        if (!this.workspace) {
          this.sendJson(response, 404, { ok: false, error: { code: "workspace.none" } });
          return;
        }
        if (!this.isAuthorized(request)) {
          this.sendJson(response, 401, { ok: false, error: { code: "session.unauthorized" } });
          return;
        }
        if (!this.isAllowedOrigin(request)) {
          this.sendJson(response, 403, { ok: false, error: { code: "origin.forbidden" } });
          return;
        }
        try {
          const body = await this.readJsonBody(request);
          const designPath =
            isRecord(body) && typeof body.designPath === "string" ? body.designPath : null;
          if (!designPath) {
            this.sendJson(response, 400, {
              ok: false,
              error: { code: "request.invalid", message: "designPath is required." },
            });
            return;
          }
          await this.openDesign(designPath);
          this.sendJson(response, 200, {
            ok: true,
            activeDesignPath: this.workspace.activeDesignPath,
          });
        } catch (error) {
          const status = error instanceof WeftBridgeError && error.code === "workspace.denied"
            ? 403
            : 400;
          this.sendJson(response, status, {
            ok: false,
            error: { code: errorCode(error), message: errorMessage(error) },
          });
        }
        return;
      }

      if (url.pathname === "/api/dev") {
        if (request.method !== "GET") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
          return;
        }
        if (!this.isAuthorized(request)) {
          this.sendJson(response, 401, { ok: false, error: { code: "session.unauthorized" } });
          return;
        }
        if (!this.isAllowedOrigin(request)) {
          this.sendJson(response, 403, { ok: false, error: { code: "origin.forbidden" } });
          return;
        }
        if (!this.devServers) {
          this.sendJson(response, 404, { ok: false, error: { code: "workspace.none" } });
          return;
        }
        this.sendJson(response, 200, {
          ok: true,
          servers: this.devServers.snapshots(),
        });
        return;
      }

      if (url.pathname === "/api/dev/start" || url.pathname === "/api/dev/stop") {
        if (request.method !== "POST") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
          return;
        }
        if (!this.isAuthorized(request)) {
          this.sendJson(response, 401, { ok: false, error: { code: "session.unauthorized" } });
          return;
        }
        if (!this.isAllowedOrigin(request)) {
          this.sendJson(response, 403, { ok: false, error: { code: "origin.forbidden" } });
          return;
        }
        if (!this.devServers) {
          this.sendJson(response, 404, { ok: false, error: { code: "workspace.none" } });
          return;
        }
        try {
          const body = await this.readJsonBody(request);
          const projectPath =
            isRecord(body) && typeof body.projectPath === "string"
              ? body.projectPath
              : null;
          if (!projectPath) {
            this.sendJson(response, 400, {
              ok: false,
              error: { code: "request.invalid", message: "projectPath is required." },
            });
            return;
          }
          const server =
            url.pathname === "/api/dev/start"
              ? await this.devServers.start(projectPath)
              : await this.devServers.stop(projectPath);
          this.sendJson(response, 200, { ok: true, server });
        } catch (error) {
          const status =
            error instanceof DevServerError
              ? error.code === "dev.unknown-project"
                ? 404
                : error.code === "dev.busy"
                  ? 409
                  : error.code === "dev.attach-unreachable"
                    ? 502
                    : 400
              : 500;
          this.sendJson(response, status, {
            ok: false,
            error: {
              code: error instanceof DevServerError ? error.code : "dev.error",
              message: errorMessage(error),
            },
          });
        }
        return;
      }

      if (url.pathname === "/api/design") {
        if (request.method !== "GET") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
          return;
        }
        if (!this.isAuthorized(request)) {
          this.sendJson(response, 401, { ok: false, error: { code: "session.unauthorized" } });
          return;
        }
        if (!this.isAllowedOrigin(request)) {
          this.sendJson(response, 403, { ok: false, error: { code: "origin.forbidden" } });
          return;
        }
        this.sendJson(response, 200, this.designPayload());
        return;
      }

      if (url.pathname === "/api/health") {
        this.sendJson(response, 200, {
          ok: true,
          revision: this.revision,
          pages: this.sessions.size,
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        this.sendJson(response, 404, { ok: false, error: { code: "api.not-found" } });
        return;
      }

      this.ensureSessionCookie(request, response);
      const served = await serveStatic(this.webDist, url.pathname, response);
      if (!served) {
        this.sendJson(response, 404, { ok: false, error: { code: "not-found" } });
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      this.sendJson(response, 500, {
        ok: false,
        error: { code: "bridge.error", message: errorMessage(error) },
      });
    }
  }

  private designPayload(): DesignPayload {
    if (!this.manifest) {
      throw new WeftBridgeError("bridge.not-ready", "The bridge has no loaded design.");
    }
    const pages: WirePage[] = [];
    for (const ref of this.manifest.pages) {
      const session = this.sessions.get(ref.id);
      if (!session) continue;
      pages.push({
        pageId: ref.id,
        update: encodeUpdate(session.encodeStateAsUpdate()),
      });
    }
    return {
      revision: this.revision,
      manifest: this.manifest,
      pages,
      ...(this.workspace ? { workspace: this.workspace } : {}),
    };
  }

  private async openDesign(designPath: string): Promise<void> {
    if (!this.workspace) {
      throw new WeftBridgeError("workspace.none", "This bridge was not started with a workspace.");
    }

    let target = resolve(designPath);
    try {
      target = await realpath(target);
    } catch {
      throw new WeftBridgeError("workspace.denied", `Design ${target} does not exist.`);
    }

    const allowed = this.workspace.projects.some((project) =>
      project.designs.some((design) => resolve(design.path) === target),
    );
    if (!allowed) {
      throw new WeftBridgeError(
        "workspace.denied",
        `Design ${target} is not registered in this workspace.`,
      );
    }
    if (target === this.designDir) return;

    this.designVersion += 1;
    const design = await readDesign(target, { requireFiles: false });
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    await this.watcher?.close().catch(() => undefined);
    this.watcher = undefined;

    this.designDir = target;
    this.manifest = design.manifest;
    this.workspace = { ...this.workspace, activeDesignPath: target };
    this.rebuildSessions(design);
    this.revision += 1;
    this.broadcastInit();

    if (this.watchEnabled) await this.startWatcher();
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolveBody, rejectBody) => {
      const chunks: Buffer[] = [];
      let size = 0;
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) {
          request.destroy();
          rejectBody(new WeftBridgeError("request.too-large", "Request body is too large."));
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        try {
          resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          rejectBody(new WeftBridgeError("request.json", "Request body must be valid JSON."));
        }
      });
      request.on("error", (error) => rejectBody(error));
    });
  }

  private initMessage(): InitMessage {
    return { type: "init", ...this.designPayload() };
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.send(ws, this.initMessage());
    ws.on("message", (data) => this.handleClientMessage(ws, data));
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  private handleClientMessage(ws: WebSocket, data: WebSocket.RawData): void {
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(String(data)) as unknown;
      if (!isRecord(value) || typeof value.type !== "string") return;
      parsed = value;
    } catch {
      return;
    }

    if (parsed.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }
    if (parsed.type === "refresh") {
      this.scheduleReload();
      return;
    }
    if (parsed.type !== "command") return;

    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : "";
    const pageId = typeof parsed.pageId === "string" ? parsed.pageId : "";
    try {
      const command = readPageCommand(parsed.command);
      const actor = readActor(parsed.actor);
      void this.handleCommand(ws, {
        type: "command",
        requestId,
        pageId,
        command,
        actor,
      });
    } catch (error) {
      this.send(ws, {
        type: "commandResult",
        requestId,
        pageId,
        ok: false,
        error: { code: errorCode(error), message: errorMessage(error) },
      });
    }
  }

  private async handleCommand(
    ws: WebSocket,
    message: CommandRequestMessage,
  ): Promise<void> {
    const manifest = this.manifest;
    const session = this.sessions.get(message.pageId);
    const pageRef = manifest?.pages.find((ref) => ref.id === message.pageId);
    if (!manifest || !session || !pageRef) {
      this.send(ws, {
        type: "commandResult",
        requestId: message.requestId,
        pageId: message.pageId,
        ok: false,
        error: {
          code: "page.missing",
          message: `Page ${message.pageId} is not open in the bridge.`,
        },
      });
      return;
    }

    const envelope = createCommandEnvelope({
      pageId: message.pageId,
      command: message.command,
      actor: message.actor,
    });
    this.revision += 1;

    let applied: ReturnType<PageSession["applyCommand"]> | undefined;
    try {
      applied = session.applyCommand(message.command);
      await writePageFile(this.designDir, pageRef.file, applied.page, {
        tokens: manifest.tokens,
        assets: manifest.assets,
      });
      session.markMaterialized(applied.page);

      this.send(ws, {
        type: "commandResult",
        requestId: message.requestId,
        pageId: message.pageId,
        ok: true,
        revision: this.revision,
        commandId: envelope.id,
        inverse: applied.inverse,
        createdNodeIds: applied.createdNodeIds,
        actor: message.actor,
      });
      this.broadcast({
        type: "command",
        revision: this.revision,
        pageId: message.pageId,
        commandId: envelope.id,
        command: message.command,
        createdNodeIds: applied.createdNodeIds,
        actor: message.actor,
      });
    } catch (error) {
      if (applied) {
        try {
          session.applyCommand(applied.inverse);
        } catch {
          // The inverse may fail if a concurrent change has already been applied.
        }
      }
      this.send(ws, {
        type: "commandResult",
        requestId: message.requestId,
        pageId: message.pageId,
        ok: false,
        revision: this.revision,
        error: { code: errorCode(error), message: errorMessage(error) },
        actor: message.actor,
      });
    }
  }

  private broadcastInit(): void {
    if (!this.manifest) return;
    const message = this.initMessage();
    for (const client of this.clients) this.send(client, message);
  }

  private broadcast(message: BridgeMessage): void {
    for (const client of this.clients) this.send(client, message);
  }

  private send(ws: WebSocket, message: BridgeMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private sendJson(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }
}

export async function startBridge(options: BridgeOptions): Promise<WeftBridge> {
  return new WeftBridge(options).start();
}
