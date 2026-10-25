import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addProject,
  discoverDesigns,
  emptyWorkspace,
  listProjects,
  readWorkspace,
  removeProject,
  validateWorkspace,
  workspaceFilePath,
  writeWorkspace,
  WorkspaceError,
  type WorkspaceConfig,
} from "../src/index.js";

let root: string;
let workspaceFile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-workspace-"));
  workspaceFile = join(root, ".weft", "workspace.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function designDir(project: string, relative: string, name: string): Promise<string> {
  const directory = join(project, relative);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "weft.json"),
    JSON.stringify({
      format: "weft",
      version: 1,
      id: "ds_01M5T0A1B2C3D4E5F6G7H8J9KM",
      name,
      pages: [],
    }),
    "utf8",
  );
  return directory;
}

async function project(name: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("workspace registry", () => {
  it("reads a missing workspace as empty", async () => {
    expect(await readWorkspace(workspaceFile)).toEqual(emptyWorkspace());
  });

  it("adds, lists and removes a project", async () => {
    const nexus = await project("Nexus");
    const design = await designDir(nexus, "designs/app.weft", "Nexus app");

    const added = await addProject(nexus, { file: workspaceFile });
    expect(added.project.path).toBe(resolve(nexus));
    expect(added.project.name).toBe("Nexus");

    const loaded = await readWorkspace(workspaceFile);
    expect(loaded.projects).toHaveLength(1);

    const listed = await listProjects(loaded);
    expect(listed[0].designs).toHaveLength(1);
    expect(listed[0].designs[0].path).toBe(resolve(design));
    expect(listed[0].designs[0].name).toBe("Nexus app");

    const removed = await removeProject("Nexus", { file: workspaceFile });
    expect(removed.project.path).toBe(resolve(nexus));
    expect((await readWorkspace(workspaceFile)).projects).toEqual([]);
  });

  it("rejects duplicates and missing paths", async () => {
    const first = await project("first");
    const second = await project("second");
    await addProject(first, { file: workspaceFile, name: "shared" });
    await expect(addProject(first, { file: workspaceFile })).rejects.toMatchObject({
      code: "project.duplicate",
    });
    await expect(
      addProject(second, { file: workspaceFile, name: "shared" }),
    ).rejects.toMatchObject({ code: "project.name-duplicate" });
    await expect(
      addProject(join(root, "missing"), { file: workspaceFile }),
    ).rejects.toMatchObject({ code: "project.missing" });
  });

  it("generates unique names for projects with the same basename", async () => {
    const one = await project("one/app");
    const two = await project("two/app");
    await addProject(one, { file: workspaceFile });
    const second = await addProject(two, { file: workspaceFile });
    const loaded = await readWorkspace(workspaceFile);
    expect(loaded.projects.map((entry) => entry.name)).toEqual(["app", "app-2"]);
    expect(second.project.name).toBe("app-2");
  });

  it("removes by path and reports unknown selectors", async () => {
    const projectPath = await project("Demo");
    await addProject(projectPath, { file: workspaceFile });
    await removeProject(projectPath, { file: workspaceFile });
    await expect(
      removeProject("Demo", { file: workspaceFile }),
    ).rejects.toMatchObject({ code: "project.not-found" });
  });

  it("discovers designs while ignoring heavy and hidden directories", async () => {
    const projectPath = await project("Discovery");
    const visible = await designDir(projectPath, "apps/web/site.weft", "Site");
    await designDir(projectPath, "node_modules/package/hidden.weft", "Hidden");
    await designDir(projectPath, ".git/hidden.weft", "Hidden git");
    await designDir(projectPath, "packages/tool/other.weft", "Tool");

    const skipped = await designDir(projectPath, "real/asset.weft", "Asset");
    await symlink(skipped, join(projectPath, "linked.weft"));

    const designs = await discoverDesigns({
      path: resolve(projectPath),
      name: "Discovery",
      addedAt: new Date().toISOString(),
    });
    expect(designs.map((design) => design.name)).toEqual(["Asset", "Site", "Tool"]);
    expect(designs.map((design) => design.path)).toContain(resolve(visible));
  });

  it("reports missing registered projects in listings", async () => {
    const projectPath = await project("Gone");
    await addProject(projectPath, { file: workspaceFile });
    await rm(projectPath, { recursive: true, force: true });

    const [listing] = await listProjects(await readWorkspace(workspaceFile));
    expect(listing.exists).toBe(false);
    expect(listing.error).toContain("no longer exists");
  });

  it("validates workspace files and rejects malformed input", async () => {
    expect(() =>
      validateWorkspace({
        version: 1,
        projects: [
          { path: "relative", name: "x", addedAt: new Date().toISOString() },
        ],
      }),
    ).toThrow(WorkspaceError);
    expect(() =>
      validateWorkspace({
        version: 99,
        projects: [],
      }),
    ).toThrow(WorkspaceError);
    expect(() =>
      validateWorkspace({
        version: 1,
        projects: [
          { path: "/a", name: "same", addedAt: new Date().toISOString() },
          { path: "/b", name: "same", addedAt: new Date().toISOString() },
        ],
      }),
    ).toThrow(WorkspaceError);

    await mkdir(join(root, ".weft"), { recursive: true });
    await writeFile(workspaceFile, "{", "utf8");
    await expect(readWorkspace(workspaceFile)).rejects.toMatchObject({
      code: "workspace.json",
    });
  });

  it("round-trips and resolves the workspace path", async () => {
    const config: WorkspaceConfig = emptyWorkspace();
    const written = await writeWorkspace(config, workspaceFile);
    expect(written).toBe(resolve(workspaceFile));
    expect(JSON.parse(await readFile(written, "utf8"))).toEqual(config);
    expect((await stat(written)).isFile()).toBe(true);

    expect(workspaceFilePath("relative.json", {})).toBe(resolve("relative.json"));
    expect(workspaceFilePath(undefined, { WEFT_WORKSPACE: "/tmp/custom.json" })).toBe(
      resolve("/tmp/custom.json"),
    );
  });
});
