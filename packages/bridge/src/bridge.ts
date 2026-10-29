import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch, type FSWatcher } from "chokidar";
import WebSocket, { WebSocketServer } from "ws";
import {
  applyDocumentCommand,
  createCommandEnvelope,
  newId,
  readDocumentCommand,
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
import { ExtractError, extractSnapshot, type CapturePage } from "@weft/extract";
import {
  readAssetFile,
  readDesign,
  readSnapshotPayloads,
  writeDocumentCommand,
  writePageFile,
  WeftIoError,
  type SnapshotPayload,
} from "@weft/design-io";
import { PageSession } from "@weft/session";
import { listProjects, readWorkspace } from "@weft/workspace";
import {
  encodeUpdate,
  type BridgeInfo,
  type BridgeMessage,
  type CommandRequestMessage,
  type DesignPayload,
  type DocumentCommandRequestMessage,
  type InitMessage,
  type WorkspacePayload,
  type WirePage,
} from "./protocol.js";
import {
  FrontendError,
  idleFrontend,
  normalizeFrontendUrl,
  probeFrontend,
  type FrontendSnapshot,
} from "./frontend.js";
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
  /** Test seam for the capture pipeline; production discovers Chromium. */
  capture?: CapturePage;
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
    error instanceof WeftIoError ||
    error instanceof ExtractError ||
    error instanceof FrontendError
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
  private readonly capturePage: CapturePage | undefined;
  private readonly server: Server;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly sessions = new Map<string, PageSession>();
  private readonly unsubs = new Map<string, () => void>();

  private manifest: DesignManifest | null = null;
  private snapshots: Record<string, SnapshotPayload> = {};
  private revision = 0;
  private port = 0;
  private frontend: FrontendSnapshot = idleFrontend();
  private captureInFlight = false;
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
    this.capturePage = options.capture;
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
    this.snapshots = await readSnapshotPayloads(this.designDir, design.pages);
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
      const snapshots = await readSnapshotPayloads(this.designDir, design.pages);
      if (version !== this.designVersion) return;
      const manifestChanged =
        !this.manifest || !sameManifest(this.manifest, design.manifest);
      const snapshotsChanged =
        JSON.stringify(this.snapshots) !== JSON.stringify(snapshots);
      this.snapshots = snapshots;

      if (manifestChanged) {
        this.manifest = design.manifest;
        this.rebuildSessions(design);
        this.revision += 1;
        this.broadcastInit();
        return;
      }

      if (snapshotsChanged) {
        // Snapshot payloads and the page that references them can change in
        // the same capture. Rebuild before init so clients never receive the
        // new payload map with an old page session.
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

  private async attachFrontend(value: unknown): Promise<FrontendSnapshot> {
    const target = normalizeFrontendUrl(value);
    if (target.origin === new URL(this.url).origin) {
      throw new FrontendError(
        "frontend.same-origin",
        "Choose the frontend application, not this Weft editor.",
      );
    }
    const checking: FrontendSnapshot = {
      url: target.url,
      origin: target.origin,
      status: "checking",
      httpStatus: null,
      checkedAt: null,
      error: null,
    };
    this.setFrontend(checking);
    const probe = await probeFrontend(target.url);
    const next: FrontendSnapshot = {
      ...checking,
      status: probe.ok ? "reachable" : "error",
      httpStatus: probe.httpStatus,
      checkedAt: new Date().toISOString(),
      error: probe.error,
    };
    this.setFrontend(next);
    return next;
  }

  private async captureFrontendSnapshot(body: unknown): Promise<{
    nodeId: string;
    pageId: string;
    pageFile: string;
    warnings: string[];
  }> {
    if (!this.manifest) {
      throw new WeftBridgeError("bridge.not-ready", "The bridge has no loaded design.");
    }
    const pageId =
      isRecord(body) && typeof body.pageId === "string" ? body.pageId.trim() : "";
    if (!pageId) {
      throw new FrontendError("frontend.page", "Choose a page to capture into.");
    }
    if (!this.manifest.pages.some((ref) => ref.id === pageId)) {
      throw new FrontendError("frontend.page", "The selected page no longer exists.");
    }
    let selector: string | undefined;
    if (isRecord(body) && body.selector !== undefined) {
      if (typeof body.selector !== "string" || body.selector.length > 1_000) {
        throw new FrontendError("frontend.selector", "Selector must be a string under 1000 characters.");
      }
      const trimmed = body.selector.trim();
      if (trimmed.includes("\u0000")) {
        throw new FrontendError("frontend.selector", "Selector must not contain NUL bytes.");
      }
      selector = trimmed || undefined;
    }
    let name: string | undefined;
    if (isRecord(body) && body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.length > 120) {
        throw new FrontendError("frontend.name", "Name must be a string under 120 characters.");
      }
      const trimmed = body.name.trim();
      if (trimmed) name = trimmed;
    }
    let viewport = { width: 1440, height: 900 };
    if (isRecord(body) && body.viewport !== undefined) {
      const candidate = body.viewport;
      if (
        !isRecord(candidate) ||
        !Number.isInteger(candidate.width) ||
        !Number.isInteger(candidate.height) ||
        (candidate.width as number) < 1 ||
        (candidate.height as number) < 1 ||
        (candidate.width as number) > 20_000 ||
        (candidate.height as number) > 20_000
      ) {
        throw new FrontendError(
          "frontend.viewport",
          "Viewport width and height must be integers between 1 and 20000.",
        );
      }
      viewport = { width: candidate.width as number, height: candidate.height as number };
    }
    if (this.captureInFlight) {
      throw new FrontendError(
        "frontend.capture-busy",
        "A capture is already running. Wait for it to finish.",
      );
    }
    const frontend = this.frontend;
    if (!frontend.url || !frontend.origin) {
      throw new FrontendError(
        "frontend.not-attached",
        "Attach a local frontend URL before capturing.",
      );
    }

    this.captureInFlight = true;
    try {
      this.setFrontend({
        ...frontend,
        status: "checking",
        httpStatus: null,
        checkedAt: null,
        error: null,
      });
      const probe = await probeFrontend(frontend.url);
      if (!probe.ok) {
        const failed: FrontendSnapshot = {
          ...frontend,
          status: "error",
          httpStatus: probe.httpStatus,
          checkedAt: new Date().toISOString(),
          error: probe.error,
        };
        this.setFrontend(failed);
        throw new FrontendError(
          probe.error?.code ?? "frontend.unreachable",
          probe.error?.message ?? "The frontend is not reachable.",
        );
      }
      this.setFrontend({
        ...frontend,
        status: "reachable",
        httpStatus: probe.httpStatus,
        checkedAt: new Date().toISOString(),
        error: null,
      });
      const result = await extractSnapshot({
        projectRoot: this.activeProject()?.path ?? this.designDir,
        designDir: this.designDir,
        url: frontend.url,
        page: pageId,
        viewport,
        allowedOrigins: [frontend.origin],
        ...(selector ? { selector } : {}),
        ...(name ? { name } : {}),
        ...(this.capturePage ? { capture: this.capturePage } : {}),
      });
      // The extraction writes the page directly, so rebuild the bridge view
      // before returning. Clients receive the new snapshot and can select it.
      await this.reload();
      return {
        nodeId: result.node.id,
        pageId: result.pageId,
        pageFile: result.pageFile,
        warnings: result.warnings,
      };
    } finally {
      this.captureInFlight = false;
    }
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

      if (url.pathname === "/api/frontend" || url.pathname === "/api/frontend/capture") {
        if (url.pathname === "/api/frontend/capture" && request.method !== "POST") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
          return;
        }
        if (url.pathname === "/api/frontend" && request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
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
        try {
          if (url.pathname === "/api/frontend" && request.method === "GET") {
            this.sendJson(response, 200, { ok: true, frontend: this.frontend });
            return;
          }
          if (url.pathname === "/api/frontend" && request.method === "DELETE") {
            this.setFrontend(idleFrontend());
            this.sendJson(response, 200, { ok: true, frontend: this.frontend });
            return;
          }
          const body = await this.readJsonBody(request);
          if (url.pathname === "/api/frontend") {
            if (!isRecord(body) || typeof body.url !== "string") {
              this.sendJson(response, 400, {
                ok: false,
                error: { code: "request.invalid", message: "url is required." },
              });
              return;
            }
            const frontend = await this.attachFrontend(body.url);
            this.sendJson(response, 200, { ok: true, frontend });
            return;
          }
          const capture = await this.captureFrontendSnapshot(body);
          this.sendJson(response, 200, { ok: true, capture });
        } catch (error) {
          const status =
            error instanceof FrontendError
              ? error.code === "frontend.capture-busy"
                ? 409
                : error.code === "frontend.unreachable" ||
                    error.code === "frontend.timeout" ||
                    error.code === "frontend.unhealthy"
                  ? 502
                  : 400
              : error instanceof ExtractError
                ? error.code === "extract.origin" ||
                    error.code === "extract.url" ||
                    error.code === "extract.viewport" ||
                    error.code === "extract.page"
                  ? 400
                  : 502
                : error instanceof WeftBridgeError
                  ? error.code === "bridge.not-ready"
                    ? 503
                    : error.code === "request.too-large"
                      ? 413
                      : 400
                  : 500;
          this.sendJson(response, status, {
            ok: false,
            error: {
              code:
                error instanceof FrontendError ||
                error instanceof ExtractError ||
                error instanceof WeftBridgeError
                  ? error.code
                  : "frontend.error",
              message: errorMessage(error),
            },
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

      if (url.pathname.startsWith("/api/asset/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
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
        let assetId: string;
        try {
          assetId = decodeURIComponent(url.pathname.slice("/api/asset/".length));
        } catch {
          this.sendJson(response, 400, { ok: false, error: { code: "asset.invalid" } });
          return;
        }
        const asset = this.manifest?.assets?.find((candidate) => candidate.id === assetId);
        if (!asset) {
          this.sendJson(response, 404, { ok: false, error: { code: "asset.missing" } });
          return;
        }
        try {
          const payload = await readAssetFile(this.designDir, asset);
          if (!/^(image|font|video|audio)\//i.test(payload.mime)) {
            this.sendJson(response, 415, { ok: false, error: { code: "asset.type" } });
            return;
          }
          response.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; sandbox",
          );
          response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          response.writeHead(200, {
            "content-type": payload.mime,
            "content-length": payload.bytes.byteLength,
            "cache-control": "no-store",
          });
          if (request.method === "HEAD") response.end();
          else response.end(Buffer.from(payload.bytes));
        } catch {
          this.sendJson(response, 404, { ok: false, error: { code: "asset.missing" } });
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

  private activeProject(): WorkspacePayload["projects"][number] | null {
    if (!this.workspace) return null;
    const active = resolve(this.designDir);
    return (
      this.workspace.projects.find((project) =>
        project.designs.some((design) => resolve(design.path) === active),
      ) ?? null
    );
  }

  private bridgeInfo(): BridgeInfo {
    if (!this.manifest) {
      throw new WeftBridgeError("bridge.not-ready", "The bridge has no loaded design.");
    }
    const project = this.activeProject();
    return {
      url: this.url,
      host: this.host,
      port: this.port,
      designPath: this.designDir,
      designName: this.manifest.name,
      projectPath: project?.path ?? null,
      projectName: project?.name ?? null,
      workspaceFile: this.workspaceFile,
      mode: this.workspace ? "workspace" : "single",
    };
  }

  private setFrontend(frontend: FrontendSnapshot): void {
    this.frontend = frontend;
    this.broadcast({ type: "frontend", frontend });
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
      snapshots: this.snapshots,
      bridge: this.bridgeInfo(),
      frontend: this.frontend,
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

    const version = ++this.designVersion;
    const design = await readDesign(target, { requireFiles: false });
    const snapshots = await readSnapshotPayloads(target, design.pages);
    if (version !== this.designVersion) return;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    await this.watcher?.close().catch(() => undefined);
    this.watcher = undefined;

    this.designDir = target;
    this.manifest = design.manifest;
    this.snapshots = snapshots;
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

  private initMessage(reason?: "designCommand"): InitMessage {
    return {
      type: "init",
      ...this.designPayload(),
      ...(reason ? { reason } : {}),
    };
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
    if (parsed.type === "designCommand") {
      const requestId = typeof parsed.requestId === "string" ? parsed.requestId : "";
      try {
        const command = readDocumentCommand(parsed.command);
        const actor = readActor(parsed.actor);
        void this.handleDocumentCommand(ws, {
          type: "designCommand",
          requestId,
          command,
          actor,
        });
      } catch (error) {
        this.send(ws, {
          type: "designCommandResult",
          requestId,
          ok: false,
          revision: this.revision,
          error: { code: errorCode(error), message: errorMessage(error) },
        });
      }
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

  private async handleDocumentCommand(
    ws: WebSocket,
    message: DocumentCommandRequestMessage,
  ): Promise<void> {
    let commandId: string | undefined;
    try {
      if (!this.manifest) {
        throw new WeftBridgeError("bridge.not-ready", "The bridge has no loaded design.");
      }
      const version = ++this.designVersion;
      const design = await readDesign(this.designDir, { requireFiles: false });
      if (version !== this.designVersion) {
        throw new WeftBridgeError("bridge.superseded", "The design changed while applying the command.");
      }
      const command = message.command;
      const applied = applyDocumentCommand(design, command);
      const written = await writeDocumentCommand(this.designDir, command, applied, design);
      if (written.orphaned.length > 0) {
        console.error(
          `[weft bridge] removed page file could not be deleted: ${written.orphaned.join(", ")}`,
        );
      }

      this.manifest = applied.design.manifest;
      this.snapshots = await readSnapshotPayloads(this.designDir, applied.design.pages);
      this.rebuildSessions(applied.design);
      this.revision += 1;
      commandId = newId("cm");
      this.broadcastInit("designCommand");
      this.broadcast({
        type: "designCommand",
        revision: this.revision,
        commandId,
        command,
        createdPageIds: applied.createdPageIds,
        removedPageIds: applied.removedPageIds,
        actor: message.actor,
      });
      this.send(ws, {
        type: "designCommandResult",
        requestId: message.requestId,
        ok: true,
        revision: this.revision,
        commandId,
        inverse: applied.inverse,
        createdPageIds: applied.createdPageIds,
        removedPageIds: applied.removedPageIds,
        actor: message.actor,
      });
    } catch (error) {
      this.send(ws, {
        type: "designCommandResult",
        requestId: message.requestId,
        ok: false,
        revision: this.revision,
        ...(commandId ? { commandId } : {}),
        error: { code: errorCode(error), message: errorMessage(error) },
        actor: message.actor,
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

  private broadcastInit(reason?: "designCommand"): void {
    if (!this.manifest) return;
    const message = this.initMessage(reason);
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
