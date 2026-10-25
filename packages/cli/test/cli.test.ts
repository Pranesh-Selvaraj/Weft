import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findNodes, isId, newId, serialize } from "@weft/core";
import { MANIFEST_FILE, readDesign } from "@weft/design-io";
import { runCli, VERSION, type CliIO } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const starter = join(repoRoot, "examples/starter.weft");

let root: string;
let out: string[];
let err: string[];
let io: CliIO;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-cli-"));
  out = [];
  err = [];
  io = {
    cwd: root,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function run(
  args: string[],
  stdin?: () => Promise<string>,
): Promise<number> {
  out.length = 0;
  err.length = 0;
  io.stdin = stdin;
  return runCli(args, io);
}

function jsonOut<T = Record<string, unknown>>(): T {
  return JSON.parse(out.join("\n")) as T;
}

async function init(name = "demo.weft"): Promise<string> {
  const code = await run(["init", name, "--name", "Demo", "--json"]);
  expect(code).toBe(0);
  return join(root, name);
}

describe("weft CLI", () => {
  it("prints help and version", async () => {
    expect(await run(["--help"])).toBe(0);
    expect(out.join("\n")).toContain("weft <command> <directory>");

    expect(await run(["--version"])).toBe(0);
    expect(out.join("\n").trim()).toBe(VERSION);

    expect(await run(["help", "fmt"])).toBe(0);
    expect(out.join("\n")).toContain("weft fmt");
  });

  it("rejects unknown commands", async () => {
    expect(await run(["nope"])).toBe(2);
    expect(err.join("\n")).toContain("Unknown command: nope");
  });

  it("initializes a design", async () => {
    const dir = await init();
    expect(err).toEqual([]);
    const payload = jsonOut<{ ok: boolean; summary: { name: string; pageCount: number } }>();
    expect(payload.ok).toBe(true);
    expect(payload.summary.name).toBe("Demo");
    expect(payload.summary.pageCount).toBe(1);

    const design = await readDesign(dir);
    expect(design.manifest.name).toBe("Demo");
    expect(design.pages).toHaveLength(1);
  });

  it("refuses to initialize over a non-empty directory", async () => {
    await mkdir(join(root, "busy"), { recursive: true });
    await writeFile(join(root, "busy", "keep.txt"), "x", "utf8");
    expect(await run(["init", "busy"])).toBe(1);
    expect(err.join("\n")).toContain("init.not-empty");
  });

  it("validates the starter design", async () => {
    expect(await runCli(["validate", starter, "--json"], io)).toBe(0);
    const payload = jsonOut<{ ok: boolean; summary: { name: string; nodeCount: number } }>();
    expect(payload.ok).toBe(true);
    expect(payload.summary.name).toBe("Weft starter");
    expect(payload.summary.nodeCount).toBe(13);
  });

  it("validates the starter design in human mode", async () => {
    expect(await runCli(["validate", starter], io)).toBe(0);
    expect(out.join("\n")).toContain("Valid: Weft starter");
    expect(err).toEqual([]);
  });

  it("reports validation issues as JSON", async () => {
    const dir = await init();
    const design = await readDesign(dir);
    const file = join(dir, design.manifest.pages[0].file);
    const page = JSON.parse(await readFile(file, "utf8")) as {
      background: { type: string; color: string };
    };
    page.background = { type: "solid", color: "" };
    await writeFile(file, serialize(page), "utf8");

    expect(await run(["validate", "demo.weft", "--json"])).toBe(1);
    const payload = jsonOut<{ ok: boolean; issues: Array<{ code: string }> }>();
    expect(payload.ok).toBe(false);
    expect(payload.issues.map((issue) => issue.code)).toContain("color.invalid");
  });

  it("reports a missing directory", async () => {
    expect(await run(["validate", "missing.weft", "--json"])).toBe(1);
    const payload = jsonOut<{ ok: boolean; issues: Array<{ code: string }> }>();
    expect(payload.ok).toBe(false);
    expect(payload.issues.map((issue) => issue.code)).toContain("directory.missing");
  });

  it("checks and applies formatting", async () => {
    const dir = await init();
    const design = await readDesign(dir);
    const file = join(dir, design.manifest.pages[0].file);
    const page = JSON.parse(await readFile(file, "utf8")) as unknown;
    await writeFile(file, JSON.stringify(page, null, 4), "utf8");

    expect(await run(["fmt", "demo.weft", "--check", "--json"])).toBe(1);
    const checked = jsonOut<{ ok: boolean; changed: string[] }>();
    expect(checked.ok).toBe(false);
    expect(checked.changed).toEqual([design.manifest.pages[0].file]);

    expect(await run(["fmt", "demo.weft", "--json"])).toBe(0);
    const written = jsonOut<{ ok: boolean; changed: string[] }>();
    expect(written.ok).toBe(true);
    expect(written.changed).toEqual([design.manifest.pages[0].file]);
    expect(await readFile(file, "utf8")).toBe(serialize(design.pages[0]));

    expect(await run(["fmt", "demo.weft", "--check"])).toBe(0);
    expect(out.join("\n")).toContain("Already canonical.");
  });

  it("refuses to format invalid JSON", async () => {
    const dir = await init();
    const design = await readDesign(dir);
    const file = join(dir, design.manifest.pages[0].file);
    await writeFile(file, "{", "utf8");

    expect(await run(["fmt", "demo.weft", "--json"])).toBe(1);
    const payload = jsonOut<{ ok: boolean; issues: Array<{ code: string }> }>();
    expect(payload.ok).toBe(false);
    expect(payload.issues.map((issue) => issue.code)).toContain("file.json");
  });

  it("inspects a design", async () => {
    const dir = await init();
    expect(await run(["inspect", "demo.weft", "--json"])).toBe(0);
    const payload = jsonOut<{
      ok: boolean;
      directory: string;
      summary: { pageCount: number; nodeCount: number; pages: Array<{ file: string }> };
    }>();
    expect(payload.ok).toBe(true);
    expect(payload.directory).toBe(dir);
    expect(payload.summary.pageCount).toBe(1);
    expect(payload.summary.nodeCount).toBe(0);
    expect(payload.summary.pages[0].file).toBe("pages/page-1.json");
  });

  it("inspects a design in human mode", async () => {
    await init();
    expect(await run(["inspect", "demo.weft"])).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Demo (");
    expect(text).toContain("Pages:");
    expect(text).toContain("Status: valid");
  });

  it("returns a structured error for a missing manifest", async () => {
    await mkdir(join(root, "empty"), { recursive: true });
    expect(await run(["inspect", "empty", "--json"])).toBe(1);
    const payload = jsonOut<{ ok: boolean; issues: Array<{ code: string }> }>();
    expect(payload.ok).toBe(false);
    expect(payload.issues.map((issue) => issue.code)).toContain("file.missing");
  });

  it("generates ids", async () => {
    expect(await run(["id", "--prefix", "pg", "--count", "3", "--json"])).toBe(0);
    const payload = jsonOut<{ ok: boolean; ids: string[] }>();
    expect(payload.ok).toBe(true);
    expect(payload.ids).toHaveLength(3);
    for (const id of payload.ids) expect(isId(id, "pg")).toBe(true);

    expect(await run(["id"])).toBe(0);
    expect(isId(out.join("\n").trim(), "nd")).toBe(true);

    expect(await run(["id", "--prefix", "xx"])).toBe(2);
    expect(await run(["id", "--count", "0"])).toBe(2);
  });

  it("gets a page and a node as JSON", async () => {
    const design = await readDesign(starter);
    const heading = findNodes(design.pages[0], (node) => node.name === "Heading")[0];
    expect(heading).toBeDefined();

    expect(await run(["get", starter, "--page", "Landing"])).toBe(0);
    const page = jsonOut<{ id: string; name: string }>();
    expect(page.name).toBe("Landing");
    expect(page.id).toBe(design.manifest.pages[0].id);

    expect(await run(["get", starter, "--node", heading.id])).toBe(0);
    const context = jsonOut<{
      pageId: string;
      pageFile: string;
      node: { id: string; name: string };
    }>();
    expect(context.pageId).toBe(design.pages[0].id);
    expect(context.pageFile).toBe("pages/landing.json");
    expect(context.node.name).toBe("Heading");

    expect(await run(["get", starter])).toBe(2);
    expect(await run(["get", starter, "--page", "Landing", "--node", heading.id])).toBe(2);
    expect(await run(["get", starter, "--node", newId("nd")])).toBe(1);
    const error = jsonOut<{ ok: boolean; error: { code: string } }>();
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe("node.missing");
  });

  it("applies a command and undoes it with the inverse", async () => {
    const dir = await init();
    const design = await readDesign(dir);
    const pageId = design.pages[0].id;
    const node = {
      id: newId("nd"),
      type: "text",
      name: "Greeting",
      x: 0,
      y: 0,
      width: 240,
      height: 32,
      content: "Hello",
      style: { font: { family: "Inter", size: 16 } },
    };
    const input = {
      pageId,
      command: { type: "node.insert", node, parentId: null, index: 0 },
      actor: { id: "test-agent", kind: "agent", name: "Test agent" },
    };
    await writeFile(join(root, "insert.json"), JSON.stringify(input), "utf8");

    expect(await run(["apply", "demo.weft", "--command", "insert.json"])).toBe(0);
    const result = jsonOut<{
      ok: boolean;
      commandId: string;
      inverse: unknown;
      createdNodeIds: string[];
      dryRun: boolean;
      written: string[];
    }>();
    expect(result.ok).toBe(true);
    expect(isId(result.commandId, "cm")).toBe(true);
    expect(result.createdNodeIds).toEqual([node.id]);
    expect(result.dryRun).toBe(false);
    expect(result.written).toContain("weft.json");
    expect(result.written).toContain(design.manifest.pages[0].file);

    const withNode = await readDesign(dir);
    expect(withNode.pages[0].nodes[node.id]?.name).toBe("Greeting");

    expect(
      await run(["apply", "demo.weft"], async () =>
        JSON.stringify({ pageId, command: result.inverse }),
      ),
    ).toBe(0);
    const undone = await readDesign(dir);
    expect(undone.pages[0].nodes).toEqual({});
  });

  it("dry-runs a command without writing", async () => {
    const dir = await init();
    const design = await readDesign(dir);
    const pageId = design.pages[0].id;
    const node = {
      id: newId("nd"),
      type: "rect",
      name: "Block",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    const insert = {
      pageId,
      command: { type: "node.insert", node, parentId: null, index: 0 },
    };
    expect(
      await run(["apply", "demo.weft"], async () => JSON.stringify(insert)),
    ).toBe(0);

    const update = {
      pageId,
      command: { type: "node.update", nodeId: node.id, patch: { name: "Preview" } },
    };
    expect(
      await run(["apply", "demo.weft", "--dry-run"], async () => JSON.stringify(update)),
    ).toBe(0);
    const result = jsonOut<{ ok: boolean; dryRun: boolean; written: string[] }>();
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.written).toEqual([]);
    const after = await readDesign(dir);
    expect(after.pages[0].nodes[node.id]?.name).toBe("Block");
  });

  it("reports command errors as JSON", async () => {
    await init();
    expect(
      await run(["apply", "demo.weft"], async () =>
        JSON.stringify({ command: { type: "node.remove", nodeId: newId("nd") } }),
      ),
    ).toBe(1);
    const inputError = jsonOut<{ ok: boolean; error: { code: string } }>();
    expect(inputError.ok).toBe(false);
    expect(inputError.error.code).toBe("command.page");

    const design = await readDesign(join(root, "demo.weft"));
    expect(
      await run(["apply", "demo.weft"], async () =>
        JSON.stringify({
          pageId: design.pages[0].id,
          command: { type: "node.remove", nodeId: newId("nd") },
        }),
      ),
    ).toBe(1);
    const nodeError = jsonOut<{ ok: boolean; error: { code: string } }>();
    expect(nodeError.error.code).toBe("node.missing");
  });

  it("registers local projects and discovers their designs", async () => {
    const workspaceFile = join(root, ".weft", "workspace.json");
    const projectDir = join(root, "product");
    const designDir = join(projectDir, "designs", "app.weft");
    await mkdir(designDir, { recursive: true });
    await writeFile(
      join(designDir, "weft.json"),
      JSON.stringify({
        format: "weft",
        version: 1,
        id: "ds_01M5T0A1B2C3D4E5F6G7H8J9KM",
        name: "Product app",
        pages: [],
      }),
      "utf8",
    );

    expect(await run(["workspace", "init", "--file", ".weft/workspace.json", "--json"])).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({ ok: true, created: true });

    expect(
      await run([
        "workspace",
        "add",
        "product",
        "--file",
        ".weft/workspace.json",
        "--name",
        "Product",
        "--json",
      ]),
    ).toBe(0);
    const added = jsonOut<{ ok: boolean; project: { name: string; path: string } }>();
    expect(added.ok).toBe(true);
    expect(added.project.name).toBe("Product");

    expect(
      await run(["workspace", "list", "--file", ".weft/workspace.json", "--json"]),
    ).toBe(0);
    const listed = jsonOut<{
      projects: Array<{ name: string; designs: Array<{ name: string; path: string }> }>;
    }>();
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0].designs[0].name).toBe("Product app");
    expect(listed.projects[0].designs[0].path).toBe(designDir);

    expect(
      await run(["workspace", "remove", "Product", "--file", ".weft/workspace.json", "--json"]),
    ).toBe(0);
    expect(JSON.parse(await readFile(workspaceFile, "utf8")).projects).toEqual([]);
  });

  it("reports workspace registry errors as JSON", async () => {
    const missing = await run([
      "workspace",
      "add",
      "missing",
      "--file",
      ".weft/workspace.json",
      "--json",
    ]);
    expect(missing).toBe(1);
    const payload = jsonOut<{ ok: boolean; error: { code: string } }>();
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("project.missing");
  });

  it("writes canonical files on init", async () => {
    const dir = await init();
    const manifest = await readFile(join(dir, MANIFEST_FILE), "utf8");
    expect(manifest.endsWith("\n")).toBe(true);
    expect(manifest).toBe(serialize(JSON.parse(manifest)));
  });
});
