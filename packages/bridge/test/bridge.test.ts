import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDesign,
  createNode,
  createPage,
  insertNode,
  newId,
  nextPageFile,
  type DesignFile,
  type SnapshotNode,
  type TextNode,
} from "@weft/core";
import { readDesign, writeDesign, writeSnapshotFiles } from "@weft/design-io";
import { PageSession } from "@weft/session";
import { writeWorkspace } from "@weft/workspace";
import {
  startBridge,
  type BridgeMessage,
  type CommandResultMessage,
  type DesignPayload,
  type InitMessage,
  type UpdateMessage,
  type WeftBridge,
} from "../src/index.js";

let root: string;
let designDir: string;
let design: DesignFile;
let headingId: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-bridge-"));
  designDir = join(root, "live.weft");
  const base = createDesign({ name: "Live", pageName: "Landing" });
  const heading = createNode({
    type: "text",
    name: "Heading",
    x: 20,
    y: 20,
    width: 400,
    height: 48,
    content: "Hello",
    style: { font: { family: "Inter", size: 24 } },
  });
  headingId = heading.id;
  const page = insertNode(base.pages[0], heading);
  design = { manifest: base.manifest, pages: [page] };
  await writeDesign(designDir, design);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function decode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function sessionCookie(bridge: WeftBridge): string {
  return `weft_session=${bridge.sessionToken}`;
}

function connectLive(bridge: WeftBridge): WebSocket {
  return new WebSocket(`${bridge.url.replace(/^http/, "ws")}/api/live`, {
    headers: { Cookie: sessionCookie(bridge) },
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: BridgeMessage) => boolean,
  timeoutMs = 8000,
): Promise<BridgeMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a bridge message."));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(String(data)) as BridgeMessage;
      } catch {
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

describe("local bridge", () => {
  it("serves the design and streams file updates", async () => {
    const bridge: WeftBridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });
    const socket = connectLive(bridge);
    const initPromise = waitForMessage(
      socket,
      (message) => message.type === "init",
    );

    try {
      const health = await fetch(`${bridge.url}/api/health`).then(
        (response) => response.json() as Promise<{ ok: boolean; pages: number }>,
      );
      expect(health.ok).toBe(true);
      expect(health.pages).toBe(1);

      const api = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(api.manifest.name).toBe("Live");
      expect(api.pages).toHaveLength(1);

      const init = (await initPromise) as InitMessage;
      const initPage = init.pages[0];
      expect(initPage.pageId).toBe(design.pages[0].id);

      const session = PageSession.fromUpdate(decode(initPage.update), {
        tokens: design.manifest.tokens,
        assets: design.manifest.assets,
      });
      expect((session.toPage().nodes[headingId] as TextNode).content).toBe("Hello");

      const updatePromise = waitForMessage(
        socket,
        (message) => message.type === "update",
      );
      const current = await readDesign(designDir, { requireFiles: false });
      const nextPage = structuredClone(current.pages[0]);
      (nextPage.nodes[headingId] as TextNode).content = "Changed on disk";
      await writeDesign(designDir, {
        manifest: current.manifest,
        pages: [nextPage],
      });

      const update = (await updatePromise) as UpdateMessage;
      session.applyUpdate(decode(update.update));
      expect((session.toPage().nodes[headingId] as TextNode).content).toBe(
        "Changed on disk",
      );
      expect(update.revision).toBeGreaterThan(init.revision);
      session.destroy();
    } finally {
      socket.close();
      await bridge.close();
    }
  }, 15000);

  it("requires a session cookie and rejects cross-origin API requests", async () => {
    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });

    try {
      const unauthorized = await fetch(`${bridge.url}/api/design`);
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("x-content-type-options")).toBe("nosniff");

      const crossOrigin = await fetch(`${bridge.url}/api/design`, {
        headers: {
          cookie: sessionCookie(bridge),
          origin: "http://evil.example",
        },
      });
      expect(crossOrigin.status).toBe(403);

      const authorized = await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      });
      expect(authorized.status).toBe(200);
    } finally {
      await bridge.close();
    }
  });

  it("sets the session cookie from the app and accepts it on the API", async () => {
    const webDir = join(root, "web");
    await mkdir(webDir, { recursive: true });
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>Weft</title>", "utf8");

    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: webDir,
    });

    try {
      const page = await fetch(`${bridge.url}/`);
      expect(page.status).toBe(200);
      const setCookie = page.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("weft_session=");
      expect(setCookie).toContain("HttpOnly");
      const cookie = setCookie.split(";")[0];

      const api = await fetch(`${bridge.url}/api/design`, {
        headers: { cookie },
      });
      expect(api.status).toBe(200);
    } finally {
      await bridge.close();
    }
  });

  it("refuses a non-loopback host", async () => {
    await expect(
      startBridge({
        designDir,
        host: "0.0.0.0",
        port: 0,
        webDist: null,
      }),
    ).rejects.toMatchObject({ code: "host.unsafe" });
  });

  it("starts and stops a declared project server through the API", async () => {
    const listener = createServer();
    await new Promise<void>((resolveListen) => listener.listen(0, "127.0.0.1", resolveListen));
    const address = listener.address();
    const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolveClose) => listener.close(() => resolveClose()));

    const script =
      'const http=require("node:http");const server=http.createServer((q,s)=>{s.writeHead(200);s.end("ok")});server.listen(Number(process.env.PORT),"127.0.0.1",()=>console.log("listening"));';
    await writeFile(
      join(designDir, "weft.project.json"),
      JSON.stringify(
        {
          version: 1,
          devServer: {
            url: `http://127.0.0.1:${port}/`,
            command: [process.execPath, "-e", script],
            env: { PORT: String(port) },
            readyTimeoutMs: 5000,
            stopTimeoutMs: 1000,
          },
        },
        null,
        2,
      ),
    );

    const workspaceFile = join(root, "workspace.json");
    await writeWorkspace(
      {
        version: 1,
        projects: [
          {
            path: resolve(designDir),
            name: "Server fixture",
            addedAt: new Date().toISOString(),
          },
        ],
      },
      workspaceFile,
    );

    const bridge = await startBridge({
      designDir,
      workspaceFile,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });

    try {
      const listing = (await fetch(`${bridge.url}/api/dev`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as {
        servers: Array<{ configured: boolean; status: string }>;
      };
      expect(listing.servers[0].configured).toBe(true);
      expect(listing.servers[0].status).toBe("stopped");

      const unauthorized = await fetch(`${bridge.url}/api/dev/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: designDir }),
      });
      expect(unauthorized.status).toBe(401);

      const outside = await fetch(`${bridge.url}/api/dev/start`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(bridge),
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectPath: join(root, "outside") }),
      });
      expect(outside.status).toBe(404);

      const started = await fetch(`${bridge.url}/api/dev/start`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(bridge),
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectPath: designDir }),
      });
      expect(started.status).toBe(200);
      const startedPayload = (await started.json()) as {
        server: { status: string };
      };
      expect(startedPayload.server.status).toBe("running");
      expect(await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text())).toBe("ok");

      const stopped = await fetch(`${bridge.url}/api/dev/stop`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(bridge),
          "content-type": "application/json",
        },
        body: JSON.stringify({ projectPath: designDir }),
      });
      expect(stopped.status).toBe(200);
      const stoppedPayload = (await stopped.json()) as {
        server: { status: string };
      };
      expect(stoppedPayload.server.status).toBe("stopped");
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    } finally {
      await bridge.close();
    }
  }, 15000);

  it("lists a workspace and switches the active design", async () => {
    const secondDesign = createDesign({ name: "Second design", pageName: "Settings" });
    const secondDir = join(root, "second.weft");
    await writeDesign(secondDir, secondDesign);

    const workspaceFile = join(root, "workspace.json");
    await writeWorkspace(
      {
        version: 1,
        projects: [
          {
            path: resolve(designDir),
            name: "First",
            addedAt: new Date().toISOString(),
          },
          {
            path: resolve(secondDir),
            name: "Second",
            addedAt: new Date().toISOString(),
          },
        ],
      },
      workspaceFile,
    );

    const bridge = await startBridge({
      designDir,
      workspaceFile,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });

    try {
      const api = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(api.workspace?.projects).toHaveLength(2);
      expect(api.workspace?.activeDesignPath).toBe(resolve(designDir));

      const unauthorized = await fetch(`${bridge.url}/api/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ designPath: secondDir }),
      });
      expect(unauthorized.status).toBe(401);

      const opened = await fetch(`${bridge.url}/api/open`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(bridge),
          "content-type": "application/json",
        },
        body: JSON.stringify({ designPath: secondDir }),
      });
      expect(opened.status).toBe(200);

      const after = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(after.manifest.name).toBe("Second design");
      expect(after.workspace?.activeDesignPath).toBe(resolve(secondDir));

      const outside = await fetch(`${bridge.url}/api/open`, {
        method: "POST",
        headers: {
          cookie: sessionCookie(bridge),
          "content-type": "application/json",
        },
        body: JSON.stringify({ designPath: join(root, "outside.weft") }),
      });
      expect(outside.status).toBe(403);
    } finally {
      await bridge.close();
    }
  }, 15000);

  it("creates and removes pages through a document command", async () => {
    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });
    const socket = connectLive(bridge);
    try {
      await new Promise<void>((resolveOpen, rejectOpen) => {
        socket.once("open", () => resolveOpen());
        socket.once("error", (error) => rejectOpen(error));
      });
      const page = createPage({ name: "Second page" });
      const command = {
        type: "page.create" as const,
        page,
        file: nextPageFile(design.manifest, page.name),
      };
      const createdPromise = waitForMessage(
        socket,
        (message) => message.type === "designCommandResult" && message.requestId === "page-create-1",
      );
      socket.send(JSON.stringify({ type: "designCommand", requestId: "page-create-1", command }));
      const created = await createdPromise;
      if (created.type !== "designCommandResult") throw new Error("unexpected message");
      expect(created.ok).toBe(true);
      expect(created.createdPageIds).toEqual([page.id]);
      expect(created.inverse).toEqual({ type: "page.remove", pageId: page.id });

      const afterCreate = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(afterCreate.manifest.pages).toHaveLength(2);
      expect(afterCreate.manifest.pages[1]).toMatchObject({ id: page.id, name: "Second page" });

      const removedPromise = waitForMessage(
        socket,
        (message) => message.type === "designCommandResult" && message.requestId === "page-remove-1",
      );
      socket.send(
        JSON.stringify({
          type: "designCommand",
          requestId: "page-remove-1",
          command: created.inverse,
        }),
      );
      const removed = await removedPromise;
      if (removed.type !== "designCommandResult") throw new Error("unexpected message");
      expect(removed.ok).toBe(true);
      expect(removed.removedPageIds).toEqual([page.id]);
      const afterRemove = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(afterRemove.manifest.pages).toHaveLength(1);
      await expect(readFile(join(designDir, command.file))).rejects.toThrow();
    } finally {
      socket.close();
      await bridge.close();
    }
  }, 15000);

  it("serves snapshot payloads with the design", async () => {
    const nodeId = newId("nd");
    const files = await writeSnapshotFiles(designDir, nodeId, {
      html: '<div data-weft-k="0">captured fixture</div>',
      css: '[data-weft-k="0"]{color:#111}',
    });
    const snapshot = createNode({
      type: "snapshot",
      id: nodeId,
      source: {
        url: "http://127.0.0.1:3000/",
        viewport: { width: 640, height: 480 },
        capturedAt: "2026-10-25T00:00:00.000Z",
      },
      files: files.files,
    }) as SnapshotNode;
    const page = insertNode(design.pages[0], snapshot);
    await writeDesign(designDir, { ...design, pages: [page] });

    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });
    try {
      const payload = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(payload.snapshots[nodeId]).toEqual({
        html: '<div data-weft-k="0">captured fixture</div>',
        css: '[data-weft-k="0"]{color:#111}',
      });
    } finally {
      await bridge.close();
    }
  });

  it("refuses to start when the built web app is missing", async () => {
    const missing = join(root, "missing-web");
    await expect(
      startBridge({
        designDir,
        host: "127.0.0.1",
        port: 0,
        webDist: missing,
      }),
    ).rejects.toMatchObject({ code: "web.missing" });
  });

  it("applies a browser command, writes the page, and undoes it", async () => {
    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });
    const socket = connectLive(bridge);
    const initPromise = waitForMessage(
      socket,
      (message) => message.type === "init",
    );

    try {
      const init = (await initPromise) as InitMessage;
      const pageId = init.pages[0].pageId;
      const actor = { id: "bridge-test", kind: "human" as const, name: "Bridge test" };

      const resultPromise = waitForMessage(
        socket,
        (message) =>
          message.type === "commandResult" && message.requestId === "cmd-1",
      );
      socket.send(
        JSON.stringify({
          type: "command",
          requestId: "cmd-1",
          pageId,
          actor,
          command: {
            type: "node.update",
            nodeId: headingId,
            patch: { content: "From the browser" },
          },
        }),
      );
      const result = (await resultPromise) as CommandResultMessage;
      expect(result.ok).toBe(true);
      expect(result.inverse).toBeDefined();
      expect(result.actor?.name).toBe("Bridge test");

      const changed = await readDesign(designDir, { requireFiles: false });
      expect((changed.pages[0].nodes[headingId] as TextNode).content).toBe(
        "From the browser",
      );

      const undoPromise = waitForMessage(
        socket,
        (message) =>
          message.type === "commandResult" && message.requestId === "cmd-2",
      );
      socket.send(
        JSON.stringify({
          type: "command",
          requestId: "cmd-2",
          pageId,
          actor,
          command: result.inverse,
        }),
      );
      const undone = (await undoPromise) as CommandResultMessage;
      expect(undone.ok).toBe(true);

      const restored = await readDesign(designDir, { requireFiles: false });
      expect((restored.pages[0].nodes[headingId] as TextNode).content).toBe("Hello");
    } finally {
      socket.close();
      await bridge.close();
    }
  }, 15000);

  it("keeps the last good state when a file write is invalid", async () => {
    const bridge = await startBridge({
      designDir,
      host: "127.0.0.1",
      port: 0,
      webDist: null,
    });
    const socket = connectLive(bridge);

    try {
      const init = (await waitForMessage(
        socket,
        (message) => message.type === "init",
      )) as InitMessage;
      const errorPromise = waitForMessage(
        socket,
        (message) => message.type === "error",
      );
      await writeFile(join(designDir, "pages", "landing.json"), "{", "utf8");
      const error = await errorPromise;
      expect(error.type).toBe("error");

      const api = (await fetch(`${bridge.url}/api/design`, {
        headers: { cookie: sessionCookie(bridge) },
      }).then((response) => response.json())) as DesignPayload;
      expect(api.pages).toHaveLength(init.pages.length);
      expect(api.revision).toBe(init.revision);
    } finally {
      socket.close();
      await bridge.close();
    }
  });
});
