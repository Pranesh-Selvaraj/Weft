import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch, type FSWatcher } from "chokidar";
import WebSocket, { WebSocketServer } from "ws";
import { serialize, type DesignFile, type DesignManifest } from "@weft/core";
import { readDesign } from "@weft/design-io";
import { PageSession } from "@weft/session";
import {
  encodeUpdate,
  type BridgeMessage,
  type ClientMessage,
  type DesignPayload,
  type InitMessage,
  type WirePage,
} from "./protocol.js";
import { serveStatic } from "./static.js";

const DEFAULT_WEB_DIST = fileURLToPath(
  new URL("../../../apps/web/dist", import.meta.url),
);
const DEFAULT_PORT = 5250;

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameManifest(left: DesignManifest, right: DesignManifest): boolean {
  return serialize(left) === serialize(right);
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
  readonly designDir: string;

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
    this.host = options.host ?? "127.0.0.1";
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.watchEnabled = options.watch !== false;
    const webDist = options.webDist === undefined ? DEFAULT_WEB_DIST : options.webDist;
    this.webDist = webDist === null ? null : resolve(webDist);

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (request, socket, head) => {
      const url = this.requestUrl(request);
      if (url.pathname !== "/api/live") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit("connection", ws, request);
      });
    });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  get url(): string {
    const host = this.host === "0.0.0.0" ? "127.0.0.1" : this.host;
    return `http://${host}:${this.port}`;
  }

  async start(): Promise<this> {
    if (this.webDist && !existsSync(join(this.webDist, "index.html"))) {
      throw new WeftBridgeError(
        "web.missing",
        `Built web app not found at ${this.webDist}. Run pnpm build first, or pass a webDist option.`,
      );
    }

    try {
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
      const design = await readDesign(this.designDir, { requireFiles: false });
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

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = this.requestUrl(request);

      if (url.pathname === "/api/design") {
        if (request.method !== "GET") {
          this.sendJson(response, 405, { ok: false, error: { code: "method.not-allowed" } });
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
    return { revision: this.revision, manifest: this.manifest, pages };
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
    let message: ClientMessage;
    try {
      const parsed = JSON.parse(String(data)) as unknown;
      if (!isRecord(parsed) || typeof parsed.type !== "string") return;
      message = parsed as unknown as ClientMessage;
    } catch {
      return;
    }

    if (message.type === "ping") {
      this.send(ws, { type: "pong" });
    } else if (message.type === "refresh") {
      this.scheduleReload();
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
