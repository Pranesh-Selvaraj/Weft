import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  loadProjectConfig,
  resolveProjectCwd,
} from "./config.js";
import { DevServerError } from "./errors.js";
import {
  DEFAULT_STOP_TIMEOUT_MS,
  type DevServerConfig,
  type DevServerLogEntry,
  type DevServerLogStream,
  type DevServerMode,
  type DevServerProblem,
  type DevServerProject,
  type DevServerSnapshot,
  type DevServerStatus,
  type ProjectConfig,
} from "./types.js";

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LINE = 2_000;
const MAX_SNAPSHOT_LOGS = 100;
const PROBE_TIMEOUT_MS = 1_500;
const PROBE_INTERVAL_MS = 250;

interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface Runtime {
  project: DevServerProject;
  config: ProjectConfig | null;
  configError: DevServerProblem | null;
  mode: DevServerMode | null;
  status: DevServerStatus;
  url: string | null;
  child: ChildProcess | null;
  groupPid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: DevServerProblem | null;
  logs: DevServerLogEntry[];
  generation: number;
  abort?: AbortController;
  spawnError?: Error;
}

export interface DevServerManagerOptions {
  projects: readonly DevServerProject[];
  /** Called on every accepted state transition; not on every log line. */
  onChange?: (snapshot: DevServerSnapshot) => void;
  maxLogs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function problem(error: unknown): DevServerProblem {
  if (error instanceof DevServerError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "dev.error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function exitMessage(info: ExitInfo): string {
  if (info.signal) return `Dev server exited with signal ${info.signal}.`;
  return `Dev server exited with code ${info.code ?? "unknown"}.`;
}

/**
 * Ready means the HTTP endpoint answered at all below 500. A 401, 403 or 404
 * still proves a server is listening; a 5xx may be an application error, but
 * we deliberately do not require a specific app-level response.
 */
async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.1" },
    });
    try {
      await response.body?.cancel();
    } catch {
      // The body may already be closed by a redirect or an empty response.
    }
    return response.status < 500;
  } catch {
    return false;
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    try {
      process.kill(pid, signal);
    } catch (fallback) {
      if ((fallback as NodeJS.ErrnoException).code !== "ESRCH") {
        // The process may already be gone; stop() reports the final state.
      }
    }
  }
}

async function taskkill(pid: number): Promise<void> {
  await new Promise<void>((resolveKill) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => resolveKill());
    killer.once("exit", () => resolveKill());
  });
}

export class DevServerManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly onChange?: (snapshot: DevServerSnapshot) => void;
  private readonly maxLogs: number;
  private closed = false;

  constructor(options: DevServerManagerOptions) {
    this.onChange = options.onChange;
    this.maxLogs = Math.max(1, options.maxLogs ?? MAX_LOG_ENTRIES);
    for (const project of options.projects) {
      const path = project.path;
      if (this.runtimes.has(path)) continue;
      this.runtimes.set(path, {
        project: { path, name: project.name },
        config: null,
        configError: null,
        mode: null,
        status: "stopped",
        url: null,
        child: null,
        groupPid: null,
        startedAt: null,
        exitCode: null,
        signal: null,
        error: null,
        logs: [],
        generation: 0,
      });
    }
  }

  async init(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      await this.loadConfig(runtime);
    }
  }

  snapshots(): DevServerSnapshot[] {
    return [...this.runtimes.values()].map((runtime) => this.snapshot(runtime));
  }

  snapshotOf(projectPath: string): DevServerSnapshot {
    return this.snapshot(this.find(projectPath));
  }

  async start(projectPath: string): Promise<DevServerSnapshot> {
    if (this.closed) {
      throw new DevServerError("dev.closed", "The dev-server manager is closed.");
    }
    const runtime = this.find(projectPath);
    if (runtime.status === "starting" || runtime.status === "stopping") {
      throw new DevServerError(
        "dev.busy",
        `The dev server for ${runtime.project.name} is ${runtime.status}.`,
      );
    }
    if (runtime.status === "running") return this.snapshot(runtime);

    await this.loadConfig(runtime);
    if (runtime.configError) {
      throw new DevServerError(runtime.configError.code, runtime.configError.message);
    }
    const config = runtime.config?.devServer;
    if (!config) {
      throw new DevServerError(
        "dev.not-configured",
        `${runtime.project.name} has no devServer in ${runtime.project.path}/weft.project.json.`,
      );
    }

    if (runtime.groupPid) {
      await this.terminate(runtime, config.stopTimeoutMs);
    }

    const generation = ++runtime.generation;
    const abort = new AbortController();
    runtime.abort = abort;
    runtime.mode = config.command ? "managed" : "attach";
    runtime.url = config.url;
    runtime.status = "starting";
    runtime.startedAt = null;
    runtime.exitCode = null;
    runtime.signal = null;
    runtime.error = null;
    runtime.spawnError = undefined;
    runtime.groupPid = null;
    runtime.logs = [];
    this.pushLog(runtime, "system", `Starting ${runtime.mode} server for ${runtime.project.name}.`);
    this.emit(runtime);

    try {
      if (runtime.mode === "attach") {
        await this.attach(runtime, config);
      } else {
        await this.startManaged(runtime, config, generation, abort.signal);
      }
      if (runtime.generation !== generation) {
        throw new DevServerError("dev.stopped", "The dev server start was cancelled.");
      }
      if (runtime.exitCode !== null) {
        throw new DevServerError(
          "dev.exit",
          exitMessage({ code: runtime.exitCode, signal: runtime.signal as NodeJS.Signals | null }),
        );
      }
      runtime.status = "running";
      runtime.startedAt = new Date().toISOString();
      this.pushLog(runtime, "system", `Ready at ${config.url}.`);
      this.emit(runtime);
      return this.snapshot(runtime);
    } catch (error) {
      const cancelled = runtime.generation !== generation;
      await this.terminate(runtime, config.stopTimeoutMs);
      if (cancelled) {
        throw new DevServerError("dev.stopped", "The dev server start was cancelled.");
      }
      const failure = problem(error);
      runtime.status = "error";
      runtime.error = failure;
      runtime.startedAt = null;
      this.pushLog(runtime, "system", failure.message);
      this.emit(runtime);
      throw error instanceof DevServerError
        ? error
        : new DevServerError(failure.code, failure.message);
    }
  }

  async stop(projectPath: string): Promise<DevServerSnapshot> {
    const runtime = this.find(projectPath);
    runtime.generation += 1;
    runtime.abort?.abort();
    runtime.abort = undefined;

    if (runtime.mode === "attach") {
      if (runtime.status !== "stopped") {
        runtime.status = "stopped";
        runtime.startedAt = null;
        runtime.error = null;
        this.pushLog(runtime, "system", "Detached from the external dev server.");
        this.emit(runtime);
      }
      return this.snapshot(runtime);
    }

    if (runtime.status === "stopped" && !runtime.child && !runtime.groupPid) {
      return this.snapshot(runtime);
    }

    if (runtime.child || runtime.groupPid) {
      runtime.status = "stopping";
      this.emit(runtime);
      await this.terminate(
        runtime,
        runtime.config?.devServer?.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS,
      );
    }

    runtime.status = "stopped";
    runtime.startedAt = null;
    runtime.error = null;
    runtime.child = null;
    runtime.groupPid = null;
    runtime.abort = undefined;
    this.pushLog(runtime, "system", "Stopped.");
    this.emit(runtime);
    return this.snapshot(runtime);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const results = await Promise.allSettled(
      [...this.runtimes.keys()].map((path) => this.stop(path)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  private find(projectPath: string): Runtime {
    const runtime = this.runtimes.get(projectPath);
    if (!runtime) {
      throw new DevServerError(
        "dev.unknown-project",
        `${projectPath} is not a registered workspace project.`,
      );
    }
    return runtime;
  }

  private async loadConfig(runtime: Runtime): Promise<void> {
    try {
      const config = await loadProjectConfig(runtime.project.path);
      runtime.config = config;
      runtime.configError = null;
      runtime.mode = config?.devServer
        ? config.devServer.command
          ? "managed"
          : "attach"
        : null;
      runtime.url = config?.devServer?.url ?? null;
    } catch (error) {
      runtime.config = null;
      runtime.configError = problem(error);
      runtime.mode = null;
      runtime.url = null;
    }
  }

  private async attach(runtime: Runtime, config: DevServerConfig): Promise<void> {
    this.pushLog(runtime, "system", `Checking ${config.url}.`);
    if (!(await probeUrl(config.url, 2_000))) {
      throw new DevServerError(
        "dev.attach-unreachable",
        `No server answered at ${config.url}. Start it yourself, or declare devServer.command for a managed server.`,
      );
    }
  }

  private async startManaged(
    runtime: Runtime,
    config: DevServerConfig,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (!config.command) {
      throw new DevServerError("dev.command", "A managed server needs a command.");
    }
    const cwd = await resolveProjectCwd(config, runtime.project.path);
    const info = await stat(cwd);
    if (!info.isDirectory()) {
      throw new DevServerError("dev.cwd", `Dev server cwd ${cwd} is not a directory.`);
    }
    if (signal.aborted || runtime.generation !== generation) {
      throw new DevServerError("dev.stopped", "The dev server start was cancelled.");
    }

    const env = { ...process.env, ...config.env };
    let child: ChildProcess;
    try {
      child = spawn(config.command[0], config.command.slice(1), {
        cwd,
        env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      throw new DevServerError(
        "dev.spawn",
        `Could not start the dev command: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    runtime.child = child;
    runtime.groupPid = child.pid ?? null;
    this.captureOutput(runtime, child);
    this.pushLog(
      runtime,
      "system",
      `Started ${config.command[0]} (pid ${child.pid ?? "unknown"}).`,
    );
    this.emit(runtime);

    child.once("error", (error) => {
      runtime.spawnError = error;
      this.pushLog(runtime, "stderr", `Spawn failed: ${error.message}`);
    });

    child.once("exit", (code, exitSignal) => {
      runtime.exitCode = code;
      runtime.signal = exitSignal;
      this.pushLog(
        runtime,
        "system",
        exitMessage({ code, signal: exitSignal }),
      );
      if (runtime.generation !== generation) return;
      if (runtime.status === "running") {
        runtime.status = code === 0 ? "stopped" : "error";
        runtime.startedAt = null;
        runtime.error =
          code === 0
            ? null
            : {
                code: "dev.exit",
                message: exitMessage({ code, signal: exitSignal }),
              };
        this.emit(runtime);
      } else if (runtime.status === "starting") {
        this.emit(runtime);
      }
    });

    const ready = await this.waitForReady(runtime, config, generation, signal);
    if (runtime.spawnError) {
      throw new DevServerError("dev.spawn", runtime.spawnError.message);
    }
    if (runtime.exitCode !== null) {
      throw new DevServerError(
        "dev.exit",
        exitMessage({ code: runtime.exitCode, signal: runtime.signal as NodeJS.Signals | null }),
      );
    }
    if (!ready) {
      throw new DevServerError(
        "dev.timeout",
        `The dev server did not become ready at ${config.url} within ${config.readyTimeoutMs} ms.`,
      );
    }
  }

  private async waitForReady(
    runtime: Runtime,
    config: DevServerConfig,
    generation: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + config.readyTimeoutMs;
    while (Date.now() <= deadline) {
      if (signal.aborted || runtime.generation !== generation) return false;
      if (runtime.spawnError) return false;
      if (runtime.exitCode !== null) return false;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (await probeUrl(config.url, Math.min(PROBE_TIMEOUT_MS, remaining))) {
        return !signal.aborted && runtime.generation === generation;
      }
      await delay(Math.min(PROBE_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    return false;
  }

  private captureOutput(runtime: Runtime, child: ChildProcess): void {
    const attach = (stream: NodeJS.ReadableStream | null, kind: "stdout" | "stderr"): void => {
      if (!stream) return;
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      lines.on("line", (line) => this.pushLog(runtime, kind, line));
      lines.once("close", () => lines.removeAllListeners());
    };
    attach(child.stdout, "stdout");
    attach(child.stderr, "stderr");
  }

  private async terminate(runtime: Runtime, timeoutMs: number): Promise<void> {
    const child = runtime.child;
    const pid = child?.pid ?? runtime.groupPid;
    if (!pid) {
      runtime.child = null;
      runtime.groupPid = null;
      return;
    }

    const exited = new Promise<void>((resolveExit) => {
      if (!child || child.exitCode !== null) {
        resolveExit();
        return;
      }
      child.once("exit", () => resolveExit());
    });

    if (process.platform === "win32") {
      await taskkill(pid);
      await Promise.race([exited, delay(timeoutMs)]);
    } else {
      killGroup(pid, "SIGTERM");
      await Promise.race([exited, delay(timeoutMs)]);
      // Kill the whole group even when the leader exited, so a shell wrapper or
      // package-manager child cannot survive the stop.
      killGroup(pid, "SIGKILL");
      await Promise.race([exited, delay(1_000)]);
    }

    runtime.child = null;
    runtime.groupPid = null;
  }

  private pushLog(
    runtime: Runtime,
    stream: DevServerLogStream,
    text: string,
  ): void {
    const normalised = text.replace(/\r$/, "").replace(/\u001b\[[0-9;]*m/g, "");
    const clipped =
      normalised.length > MAX_LOG_LINE
        ? `${normalised.slice(0, MAX_LOG_LINE - 1)}…`
        : normalised;
    runtime.logs.push({
      at: new Date().toISOString(),
      stream,
      text: clipped,
    });
    if (runtime.logs.length > this.maxLogs) {
      runtime.logs.splice(0, runtime.logs.length - this.maxLogs);
    }
  }

  private snapshot(runtime: Runtime): DevServerSnapshot {
    return {
      projectPath: runtime.project.path,
      projectName: runtime.project.name,
      configPath: runtime.config?.path ?? null,
      configured: Boolean(runtime.config?.devServer),
      mode: runtime.mode,
      status: runtime.status,
      url: runtime.url,
      pid: runtime.status === "running" ? runtime.groupPid : null,
      startedAt: runtime.startedAt,
      exitCode: runtime.exitCode,
      signal: runtime.signal,
      error: runtime.error,
      configError: runtime.configError,
      logs: runtime.logs.slice(-MAX_SNAPSHOT_LOGS).map((entry) => ({ ...entry })),
    };
  }

  private emit(runtime: Runtime): void {
    if (!this.onChange) return;
    try {
      this.onChange(this.snapshot(runtime));
    } catch {
      // A UI callback must not break process supervision.
    }
  }
}
