export const WORKSPACE_VERSION = 1 as const;

export interface WorkspaceProject {
  /** Canonical absolute path. */
  path: string;
  /** Unique display name. */
  name: string;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

export interface WorkspaceConfig {
  version: typeof WORKSPACE_VERSION;
  projects: WorkspaceProject[];
}

export interface DiscoveredDesign {
  /** Absolute path to the design directory. */
  path: string;
  /** Name from the manifest when readable, otherwise the directory name. */
  name: string;
  projectPath: string;
  projectName: string;
}

export interface ProjectListing extends WorkspaceProject {
  exists: boolean;
  designs: DiscoveredDesign[];
  error?: string;
}

export class WorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
