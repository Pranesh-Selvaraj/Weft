import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDesign,
  createNode,
  insertNode,
  type DesignFile,
  type TextNode,
} from "@weft/core";
import { readDesign, writeDesign } from "@weft/design-io";
import { PageSession } from "@weft/session";
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
