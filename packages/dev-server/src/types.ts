export const PROJECT_CONFIG_FILE = "weft.project.json" as const;
export const PROJECT_CONFIG_VERSION = 1 as const;
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
export const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface DevServerConfig {
  /** Absolute loopback URL used for readiness and links. */
  url: string;
  /**
   * argv array for a managed server. When absent, Weft only attaches to an
   * already-running server at url.
   */
  command?: string[];
  /** Absolute working directory inside the project root. */
  cwd: string;
  env: Record<string, string>;
  readyTimeoutMs: number;
  stopTimeoutMs: number;
}

export interface ExtractConfig {
  /** Loopback origins the capture pipeline may navigate to. */
  origins: string[];
}

export interface ProjectConfig {
  /** Absolute project root. */
  root: string;
  /** Absolute path to weft.project.json. */
  path: string;
  version: typeof PROJECT_CONFIG_VERSION;
  devServer: DevServerConfig | null;
  extract: ExtractConfig | null;
}

export interface DevServerProject {
  /** Canonical absolute project root. */
  path: string;
  name: string;
}

export type DevServerMode = "managed" | "attach";

export type DevServerStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type DevServerLogStream = "stdout" | "stderr" | "system";

export interface DevServerLogEntry {
  at: string;
  stream: DevServerLogStream;
  text: string;
}

export interface DevServerProblem {
  code: string;
  message: string;
}

export interface DevServerSnapshot {
  projectPath: string;
  projectName: string;
  configPath: string | null;
  configured: boolean;
  mode: DevServerMode | null;
  status: DevServerStatus;
  url: string | null;
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: DevServerProblem | null;
  configError: DevServerProblem | null;
  logs: DevServerLogEntry[];
}
