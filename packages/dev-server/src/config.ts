import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { DevServerError } from "./errors.js";
import {
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
  PROJECT_CONFIG_FILE,
  PROJECT_CONFIG_VERSION,
  type DevServerConfig,
  type ProjectConfig,
} from "./types.js";

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_COMMAND_ARGS = 64;
const MAX_ARGUMENT_BYTES = 4_096;
const MAX_ENV_KEYS = 128;
const MAX_ENV_VALUE_BYTES = 8_192;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configError(message: string): DevServerError {
  return new DevServerError("project.config", message);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function parseLoopbackUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw configError("devServer.url must be a non-empty string.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configError("devServer.url must be an absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configError("devServer.url must use http or https.");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw configError(
      `devServer.url must use a loopback host (127.0.0.1, localhost or ::1), got ${JSON.stringify(url.hostname)}.`,
    );
  }
  if (url.username || url.password) {
    throw configError("devServer.url must not contain credentials.");
  }
  if (url.hash) {
    throw configError("devServer.url must not contain a fragment.");
  }
  return url.toString();
}

function parseCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw configError("devServer.command must be a non-empty argv array.");
  }
  if (value.length > MAX_COMMAND_ARGS) {
    throw configError(`devServer.command may have at most ${MAX_COMMAND_ARGS} entries.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw configError(`devServer.command[${index}] must be a non-empty string.`);
    }
    if (entry.includes("\0")) {
      throw configError(`devServer.command[${index}] must not contain a NUL byte.`);
    }
    if (Buffer.byteLength(entry, "utf8") > MAX_ARGUMENT_BYTES) {
      throw configError(`devServer.command[${index}] is too long.`);
    }
    return entry;
  });
}

function parseEnv(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw configError("devServer.env must be an object of string values.");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ENV_KEYS) {
    throw configError(`devServer.env may have at most ${MAX_ENV_KEYS} keys.`);
  }
  const env: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw configError(`devServer.env key ${JSON.stringify(key)} is not a valid environment name.`);
    }
    if (typeof entry !== "string") {
      throw configError(`devServer.env.${key} must be a string.`);
    }
    if (entry.includes("\0")) {
      throw configError(`devServer.env.${key} must not contain a NUL byte.`);
    }
    if (Buffer.byteLength(entry, "utf8") > MAX_ENV_VALUE_BYTES) {
      throw configError(`devServer.env.${key} is too long.`);
    }
    env[key] = entry;
  }
  return env;
}

function parseTimeout(
  value: unknown,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw configError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseDevServer(value: unknown, root: string): DevServerConfig {
  if (!isRecord(value)) {
    throw configError("devServer must be an object.");
  }
  const url = parseLoopbackUrl(value.url);
  const command = value.command === undefined ? undefined : parseCommand(value.command);
  const env = parseEnv(value.env);
  const rawCwd = value.cwd === undefined ? "." : value.cwd;
  if (typeof rawCwd !== "string" || rawCwd.length === 0) {
    throw configError("devServer.cwd must be a non-empty string.");
  }
  const cwd = resolve(root, rawCwd);
  if (!isInside(root, cwd)) {
    throw configError("devServer.cwd must stay inside the project root.");
  }
  return {
    url,
    ...(command ? { command } : {}),
    cwd,
    env,
    readyTimeoutMs: parseTimeout(
      value.readyTimeoutMs,
      "devServer.readyTimeoutMs",
      DEFAULT_READY_TIMEOUT_MS,
      500,
      120_000,
    ),
    stopTimeoutMs: parseTimeout(
      value.stopTimeoutMs,
      "devServer.stopTimeoutMs",
      DEFAULT_STOP_TIMEOUT_MS,
      100,
      60_000,
    ),
  };
}

/** Validate an already-parsed project config object. */
export function validateProjectConfig(value: unknown, projectRoot: string): ProjectConfig {
  const root = resolve(projectRoot);
  if (!isRecord(value)) {
    throw configError("Project config must be a JSON object.");
  }
  if (value.version !== PROJECT_CONFIG_VERSION) {
    throw configError(
      `Project config version must be ${PROJECT_CONFIG_VERSION}, got ${JSON.stringify(value.version)}.`,
    );
  }
  const devServer =
    value.devServer === undefined ? null : parseDevServer(value.devServer, root);
  return {
    root,
    path: resolve(root, PROJECT_CONFIG_FILE),
    version: PROJECT_CONFIG_VERSION,
    devServer,
  };
}

/**
 * Read and validate weft.project.json. A missing file is not an error and
 * returns null. The config file is deliberately read as a regular file, not a
 * symlink, so it cannot point outside the project root.
 */
export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig | null> {
  const root = resolve(projectRoot);
  const path = resolve(root, PROJECT_CONFIG_FILE);
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DevServerError(
      "project.config",
      `Could not inspect ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new DevServerError("project.config", `${path} must not be a symbolic link.`);
  }
  if (!stat.isFile()) {
    throw new DevServerError("project.config", `${path} must be a regular file.`);
  }
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new DevServerError(
      "project.config",
      `${path} is larger than ${MAX_CONFIG_BYTES} bytes.`,
    );
  }

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new DevServerError(
      "project.config",
      `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new DevServerError(
      "project.config",
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateProjectConfig(value, root);
}

/**
 * Resolve cwd and reject symlink escapes. This is checked at start time, after
 * the config itself has been validated.
 */
export async function resolveProjectCwd(
  config: DevServerConfig,
  projectRoot: string,
): Promise<string> {
  const realRoot = await realpath(projectRoot);
  let realCwd: string;
  try {
    realCwd = await realpath(config.cwd);
  } catch {
    throw new DevServerError(
      "dev.cwd",
      `Dev server cwd ${config.cwd} does not exist.`,
    );
  }
  if (!isInside(realRoot, realCwd)) {
    throw new DevServerError(
      "dev.cwd",
      `Dev server cwd ${config.cwd} resolves outside the project root.`,
    );
  }
  return realCwd;
}
