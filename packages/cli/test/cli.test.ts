import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serialize } from "@weft/core";
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

async function run(args: string[]): Promise<number> {
  out.length = 0;
  err.length = 0;
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

  it("writes canonical files on init", async () => {
    const dir = await init();
    const manifest = await readFile(join(dir, MANIFEST_FILE), "utf8");
    expect(manifest.endsWith("\n")).toBe(true);
    expect(manifest).toBe(serialize(JSON.parse(manifest)));
  });
});
