import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DevServerManager,
  PROJECT_CONFIG_FILE,
  loadProjectConfig,
  resolveProjectCwd,
  validateProjectConfig,
  type DevServerSnapshot,
} from "../src/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-dev-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function validConfig(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    devServer: {
      url: "http://127.0.0.1:3000",
      ...overrides,
    },
  };
}

async function writeConfig(value: unknown): Promise<void> {
  await writeFile(join(root, PROJECT_CONFIG_FILE), JSON.stringify(value, null, 2));
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("project config", () => {
  it("returns null when weft.project.json is absent", async () => {
    expect(await loadProjectConfig(root)).toBeNull();
  });

  it("normalizes a managed server config", async () => {
    await writeConfig(validConfig({ command: ["pnpm", "dev"], cwd: "app" }));
    await mkdir(join(root, "app"));
    const config = await loadProjectConfig(root);
    expect(config?.devServer?.command).toEqual(["pnpm", "dev"]);
    expect(config?.devServer?.cwd).toBe(join(root, "app"));
    expect(config?.devServer?.env).toEqual({});
    expect(config?.devServer?.url).toBe("http://127.0.0.1:3000/");
    expect(config?.devServer?.readyTimeoutMs).toBe(30_000);
  });

  it("rejects non-loopback URLs and credential-bearing URLs", () => {
    expect(() =>
      validateProjectConfig(
        { version: 1, devServer: { url: "http://example.com:3000" } },
        root,
      ),
    ).toThrow(/loopback/);
    expect(() =>
      validateProjectConfig(
        { version: 1, devServer: { url: "http://user:pass@127.0.0.1:3000" } },
        root,
      ),
    ).toThrow(/credentials/);
  });

  it("rejects cwd escapes, bad commands and malformed env", () => {
    expect(() =>
      validateProjectConfig(
        { version: 1, devServer: { url: "http://127.0.0.1:3000", cwd: "../outside" } },
        root,
      ),
    ).toThrow(/inside the project root/);
    expect(() =>
      validateProjectConfig(
        { version: 1, devServer: { url: "http://127.0.0.1:3000", command: [] } },
        root,
      ),
    ).toThrow(/argv/);
    expect(() =>
      validateProjectConfig(
        {
          version: 1,
          devServer: {
            url: "http://127.0.0.1:3000",
            command: ["node", "-e", "x"],
            env: { "BAD KEY": "value" },
          },
        },
        root,
      ),
    ).toThrow(/environment name/);
  });

  it("rejects a config symlink and a symlinked cwd escape", async () => {
    const outside = await mkdtemp(join(tmpdir(), "weft-dev-outside-"));
    try {
      await writeFile(join(outside, "weft.project.json"), JSON.stringify(validConfig()));
      await symlink(join(outside, "weft.project.json"), join(root, PROJECT_CONFIG_FILE));
      await expect(loadProjectConfig(root)).rejects.toThrow(/symbolic link/);

      await rm(join(root, PROJECT_CONFIG_FILE));
      await mkdir(join(root, "inside"));
      await symlink(outside, join(root, "inside", "link"));
      const config = validateProjectConfig(
        {
          version: 1,
          devServer: { url: "http://127.0.0.1:3000", cwd: "inside/link" },
        },
        root,
      );
      await expect(resolveProjectCwd(config.devServer!, root)).rejects.toThrow(/outside/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("dev-server manager", () => {
  it("starts a managed server, captures logs, and stops the process group", async () => {
    const port = await freePort();
    const script = `
      const http = require("node:http");
      const server = http.createServer((request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ready");
      });
      server.listen(Number(process.env.PORT), "127.0.0.1", () => {
        console.log("listening on " + process.env.PORT);
      });
    `;
    await writeConfig(
      validConfig({
        url: `http://127.0.0.1:${port}/`,
        command: [process.execPath, "-e", script],
        env: { PORT: String(port) },
        readyTimeoutMs: 5000,
        stopTimeoutMs: 1000,
      }),
    );

    const states: DevServerSnapshot[] = [];
    const manager = new DevServerManager({
      projects: [{ path: root, name: "Fixture" }],
      onChange: (snapshot) => states.push(snapshot),
    });
    await manager.init();
    try {
      const running = await manager.start(root);
      expect(running.status).toBe("running");
      expect(running.mode).toBe("managed");
      expect(running.pid).not.toBeNull();
      expect(running.url).toBe(`http://127.0.0.1:${port}/`);
      expect(running.logs.some((entry) => entry.text.includes("listening on"))).toBe(true);
      expect(states.some((snapshot) => snapshot.status === "starting")).toBe(true);
      expect(states.some((snapshot) => snapshot.status === "running")).toBe(true);
      expect(await fetch(running.url!).then((response) => response.text())).toBe("ready");

      const pid = running.pid!;
      expect(isAlive(pid)).toBe(true);

      const stopped = await manager.stop(root);
      expect(stopped.status).toBe("stopped");
      expect(stopped.pid).toBeNull();
      await waitFor(() => !isAlive(pid));
      await expect(fetch(running.url!)).rejects.toThrow();
      expect(states.some((snapshot) => snapshot.status === "stopping")).toBe(true);
      expect(states.some((snapshot) => snapshot.status === "stopped")).toBe(true);
    } finally {
      await manager.close();
    }
  }, 15000);

  it("close stops every running managed server", async () => {
    const port = await freePort();
    const script =
      'const http=require("node:http");http.createServer((q,s)=>{s.writeHead(204);s.end()}).listen(Number(process.env.PORT),"127.0.0.1");';
    await writeConfig(
      validConfig({
        url: `http://127.0.0.1:${port}/`,
        command: [process.execPath, "-e", script],
        env: { PORT: String(port) },
        readyTimeoutMs: 5000,
        stopTimeoutMs: 1000,
      }),
    );
    const manager = new DevServerManager({ projects: [{ path: root, name: "Closer" }] });
    await manager.init();
    const running = await manager.start(root);
    const pid = running.pid!;
    expect(isAlive(pid)).toBe(true);

    await manager.close();
    await waitFor(() => !isAlive(pid));
    await expect(fetch(running.url!)).rejects.toThrow();
  }, 15000);

  it("attaches to an external server without taking ownership", async () => {
    const external = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolveListen) =>
      external.listen(0, "127.0.0.1", resolveListen),
    );
    const address = external.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      await writeConfig(validConfig({ url: `http://127.0.0.1:${port}/` }));
      const manager = new DevServerManager({
        projects: [{ path: root, name: "Attached" }],
      });
      await manager.init();
      try {
        const running = await manager.start(root);
        expect(running.status).toBe("running");
        expect(running.mode).toBe("attach");
        expect(running.pid).toBeNull();

        const stopped = await manager.stop(root);
        expect(stopped.status).toBe("stopped");
        expect(external.listening).toBe(true);
        expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(204);
      } finally {
        await manager.close();
      }
    } finally {
      await new Promise<void>((resolveClose) => external.close(() => resolveClose()));
    }
  });

  it("reports an early exit with the exit code and captured output", async () => {
    await writeConfig(
      validConfig({
        url: "http://127.0.0.1:1/",
        command: [
          process.execPath,
          "-e",
          'console.error("fixture failure"); setTimeout(() => process.exit(7), 50);',
        ],
        readyTimeoutMs: 1000,
        stopTimeoutMs: 500,
      }),
    );
    const manager = new DevServerManager({ projects: [{ path: root, name: "Exits" }] });
    await manager.init();
    try {
      await expect(manager.start(root)).rejects.toThrow(/exited/);
      const snapshot = manager.snapshotOf(root);
      expect(snapshot.status).toBe("error");
      expect(snapshot.exitCode).toBe(7);
      expect(snapshot.logs.some((entry) => entry.text.includes("fixture failure"))).toBe(true);
      expect(snapshot.error?.code).toBe("dev.exit");
    } finally {
      await manager.close();
    }
  });

  it("times out, kills the child, and never leaves the process alive", async () => {
    await writeConfig(
      validConfig({
        url: "http://127.0.0.1:1/",
        command: [process.execPath, "-e", "setTimeout(() => {}, 10000);"],
        readyTimeoutMs: 600,
        stopTimeoutMs: 500,
      }),
    );
    const manager = new DevServerManager({ projects: [{ path: root, name: "Slow" }] });
    await manager.init();
    try {
      await expect(manager.start(root)).rejects.toThrow(/did not become ready/);
      const snapshot = manager.snapshotOf(root);
      expect(snapshot.status).toBe("error");
      expect(snapshot.error?.code).toBe("dev.timeout");
      const pid = snapshot.logs
        .map((entry) => /pid (\d+)/.exec(entry.text)?.[1])
        .find((value): value is string => value !== undefined);
      if (pid) await waitFor(() => !isAlive(Number(pid)));
    } finally {
      await manager.close();
    }
  }, 10000);

  it("does not start without a declared devServer", async () => {
    const manager = new DevServerManager({ projects: [{ path: root, name: "Empty" }] });
    await manager.init();
    try {
      await expect(manager.start(root)).rejects.toThrow(/no devServer/);
    } finally {
      await manager.close();
    }
  });
});
