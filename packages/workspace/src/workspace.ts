import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  WORKSPACE_VERSION,
  WorkspaceError,
  type DiscoveredDesign,
  type ProjectListing,
  type WorkspaceConfig,
  type WorkspaceProject,
} from "./types.js";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".weft-cache",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
]);
const MAX_DISCOVERY_DEPTH = 6;

export interface AddProjectOptions {
  name?: string;
  file?: string;
  cwd?: string;
}

export interface RemoveProjectOptions {
  file?: string;
  cwd?: string;
}

export interface ProjectMutationResult {
  config: WorkspaceConfig;
  file: string;
  project: WorkspaceProject;
}

export function emptyWorkspace(): WorkspaceConfig {
  return { version: WORKSPACE_VERSION, projects: [] };
}

/** Resolve the workspace file: explicit option, WEFT_WORKSPACE, then ~/.weft/workspace.json. */
export function workspaceFilePath(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicit && explicit.trim().length > 0) return resolve(explicit);
  const fromEnv = env.WEFT_WORKSPACE;
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv);
  return join(homedir(), ".weft", "workspace.json");
}

export function validateWorkspace(value: unknown): WorkspaceConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkspaceError("workspace.invalid", "Workspace must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== WORKSPACE_VERSION) {
    throw new WorkspaceError(
      "workspace.version",
      `Unsupported workspace version ${String(record.version)}.`,
    );
  }
  if (!Array.isArray(record.projects)) {
    throw new WorkspaceError("workspace.invalid", "workspace.projects must be an array.");
  }

  const paths = new Set<string>();
  const names = new Set<string>();
  const projects: WorkspaceProject[] = [];
  for (const [index, item] of record.projects.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new WorkspaceError("workspace.invalid", `projects[${index}] must be an object.`);
    }
    const project = item as Record<string, unknown>;
    if (typeof project.path !== "string" || !isAbsolute(project.path)) {
      throw new WorkspaceError(
        "workspace.path",
        `projects[${index}].path must be an absolute path.`,
      );
    }
    if (typeof project.name !== "string" || project.name.trim().length === 0) {
      throw new WorkspaceError(
        "workspace.name",
        `projects[${index}].name must be a non-empty string.`,
      );
    }
    if (typeof project.addedAt !== "string" || Number.isNaN(Date.parse(project.addedAt))) {
      throw new WorkspaceError(
        "workspace.addedAt",
        `projects[${index}].addedAt must be an ISO timestamp.`,
      );
    }
    if (paths.has(project.path)) {
      throw new WorkspaceError("workspace.duplicate-path", `Duplicate project path ${project.path}.`);
    }
    if (names.has(project.name)) {
      throw new WorkspaceError("workspace.duplicate-name", `Duplicate project name ${project.name}.`);
    }
    paths.add(project.path);
    names.add(project.name);
    projects.push({
      path: project.path,
      name: project.name,
      addedAt: project.addedAt,
    });
  }

  return { version: WORKSPACE_VERSION, projects };
}

export async function readWorkspace(file?: string): Promise<WorkspaceConfig> {
  const path = workspaceFilePath(file);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkspace();
    throw new WorkspaceError("workspace.read", `Could not read ${path}: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new WorkspaceError("workspace.json", `Invalid JSON in ${path}: ${String(error)}`);
  }
  return validateWorkspace(parsed);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function writeWorkspace(
  config: WorkspaceConfig,
  file?: string,
): Promise<string> {
  const path = workspaceFilePath(file);
  validateWorkspace(config);
  await writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

export async function addProject(
  projectPath: string,
  options: AddProjectOptions = {},
): Promise<ProjectMutationResult> {
  const requested = resolve(options.cwd ?? process.cwd(), projectPath);
  let canonical: string;
  try {
    canonical = await realpath(requested);
  } catch {
    throw new WorkspaceError("project.missing", `Project ${requested} does not exist.`);
  }

  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new WorkspaceError("project.not-directory", `${canonical} is not a directory.`);
  }

  const file = workspaceFilePath(options.file);
  const config = await readWorkspace(file);
  if (config.projects.some((project) => project.path === canonical)) {
    throw new WorkspaceError("project.duplicate", `${canonical} is already registered.`);
  }

  const taken = new Set(config.projects.map((project) => project.name));
  const requestedName = options.name?.trim();
  let name: string;
  if (requestedName) {
    if (taken.has(requestedName)) {
      throw new WorkspaceError("project.name-duplicate", `Project name ${requestedName} is already used.`);
    }
    name = requestedName;
  } else {
    name = uniqueName(basename(canonical), taken);
  }

  const project: WorkspaceProject = {
    path: canonical,
    name,
    addedAt: new Date().toISOString(),
  };
  const next: WorkspaceConfig = {
    ...config,
    projects: [...config.projects, project],
  };
  await writeWorkspace(next, file);
  return { config: next, file, project };
}

export async function removeProject(
  selector: string,
  options: RemoveProjectOptions = {},
): Promise<ProjectMutationResult> {
  const file = workspaceFilePath(options.file);
  const config = await readWorkspace(file);

  const selectorPath = resolve(options.cwd ?? process.cwd(), selector);
  let canonicalSelector = selectorPath;
  try {
    canonicalSelector = await realpath(canonicalSelector);
  } catch {
    // A missing path can still match an already-registered path string.
  }

  const project = config.projects.find(
    (candidate) =>
      candidate.name === selector ||
      candidate.path === selectorPath ||
      candidate.path === canonicalSelector,
  );
  if (!project) {
    throw new WorkspaceError("project.not-found", `No registered project matches ${selector}.`);
  }

  const next: WorkspaceConfig = {
    ...config,
    projects: config.projects.filter((candidate) => candidate.path !== project.path),
  };
  await writeWorkspace(next, file);
  return { config: next, file, project };
}

async function designName(directory: string): Promise<string> {
  try {
    const text = await readFile(join(directory, "weft.json"), "utf8");
    const parsed = JSON.parse(text) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name;
    }
  } catch {
    // A malformed manifest still identifies a design directory by name.
  }
  return basename(directory);
}

async function isDesignDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(join(directory, "weft.json"))).isFile();
  } catch {
    return false;
  }
}

async function walk(
  root: string,
  project: WorkspaceProject,
  depth: number,
  designs: DiscoveredDesign[],
): Promise<void> {
  if (depth > MAX_DISCOVERY_DEPTH) return;
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const directory = join(root, entry.name);
    if (await isDesignDirectory(directory)) {
      designs.push({
        path: directory,
        name: await designName(directory),
        projectPath: project.path,
        projectName: project.name,
      });
      continue;
    }
    await walk(directory, project, depth + 1, designs);
  }
}

export async function discoverDesigns(project: WorkspaceProject): Promise<DiscoveredDesign[]> {
  let info;
  try {
    info = await stat(project.path);
  } catch {
    throw new WorkspaceError("project.missing", `Project ${project.path} no longer exists.`);
  }
  if (!info.isDirectory()) {
    throw new WorkspaceError("project.not-directory", `${project.path} is not a directory.`);
  }

  const designs: DiscoveredDesign[] = [];
  if (await isDesignDirectory(project.path)) {
    designs.push({
      path: project.path,
      name: await designName(project.path),
      projectPath: project.path,
      projectName: project.name,
    });
  } else {
    await walk(project.path, project, 0, designs);
  }
  return designs.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listProjects(config: WorkspaceConfig): Promise<ProjectListing[]> {
  const listings: ProjectListing[] = [];
  for (const project of config.projects) {
    try {
      listings.push({
        ...project,
        exists: true,
        designs: await discoverDesigns(project),
      });
    } catch (error) {
      listings.push({
        ...project,
        exists: false,
        designs: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return listings;
}
