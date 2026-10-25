import type { CommandActor } from "@weft/core";

export interface McpDesignEntry {
  /** Canonical absolute design directory. */
  path: string;
  name: string;
  projectPath?: string;
  projectName?: string;
}

export interface WeftMcpOptions {
  /** Explicit workspace registry. When designDir is omitted, this is the allowlist. */
  workspaceFile?: string;
  /** Single-design mode. Mutually exclusive with workspaceFile for a narrow server. */
  designDir?: string;
  /** Disable page and node mutations. */
  readOnly?: boolean;
  /** Actor attributed to every write. Defaults to an agent identity. */
  actor?: CommandActor;
  /** MCP server implementation name/version. */
  serverName?: string;
  serverVersion?: string;
}

export interface McpContext {
  designs: McpDesignEntry[];
  readOnly: boolean;
  actor: CommandActor;
  workspaceFile: string | null;
  designDir: string | null;
}
