import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValidateFunction } from "ajv";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createDesign,
  createNode,
  createPage,
  insertNode,
  newId,
  parseJson,
  readDocumentCommand,
  readPageCommand,
  validateDesign,
  validateManifest,
  validatePage,
  WeftCommandError,
  type DesignManifest,
  type PageDocument,
  type TokenTree,
} from "@weft/core";

type Kind = "manifest" | "page" | "commandRequest" | "commandEnvelope";

interface FixtureEntry {
  kind: Kind;
  file: string;
  code?: string;
}

interface FixtureIndex {
  valid: FixtureEntry[];
  schemaInvalid: FixtureEntry[];
  semanticInvalid: FixtureEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repoRoot = resolve(packageRoot, "../..");

const schema = parseJson(
  readFileSync(join(packageRoot, "schema/weft.schema.json"), "utf8"),
);
const index = parseJson(
  readFileSync(join(packageRoot, "fixtures/conformance.json"), "utf8"),
) as FixtureIndex;

interface AjvInstance {
  compile(schema: object): ValidateFunction;
  errorsText(errors?: unknown): string;
}

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020.js") as new (options?: Record<string, unknown>) => AjvInstance;
const addFormats = require("ajv-formats") as (ajv: AjvInstance) => unknown;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema as object);

function readFixture(file: string): unknown {
  return parseJson(readFileSync(join(packageRoot, "fixtures", file), "utf8"));
}

function schemaResult(value: unknown): { ok: boolean; errors: string } {
  const ok = validate(value) === true;
  return { ok, errors: ok ? "" : ajv.errorsText(validate.errors) };
}

function commandCodes(value: unknown): string[] {
  const record = value as { command?: unknown };
  try {
    readPageCommand(record.command);
    return [];
  } catch (error) {
    if (error instanceof WeftCommandError) return [error.code];
    throw error;
  }
}

function coreCodes(kind: Kind, value: unknown, tokens?: TokenTree): string[] {
  switch (kind) {
    case "manifest":
      return validateManifest(value).map((issue) => issue.code);
    case "page":
      return validatePage(value, { tokens }).map((issue) => issue.code);
    case "commandRequest":
    case "commandEnvelope":
      return commandCodes(value);
  }
}

function findValid(kind: Kind): unknown {
  const entry = index.valid.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Missing valid fixture for ${kind}`);
  return readFixture(entry.file);
}

describe("published schema", () => {
  beforeAll(() => {
    expect(schemaResult({})).toMatchObject({ ok: false });
    expect(schemaResult([])).toMatchObject({ ok: false });
    expect(schemaResult(null)).toMatchObject({ ok: false });
  });

  it("accepts every valid fixture", () => {
    for (const entry of index.valid) {
      const result = schemaResult(readFixture(entry.file));
      expect(result.ok, `${entry.file}: ${result.errors}`).toBe(true);
      expect(coreCodes(entry.kind, readFixture(entry.file)), entry.file).toEqual([]);
    }
  });

  it("accepts the valid manifest and page as one design", () => {
    const manifest = findValid("manifest") as DesignManifest;
    const page = findValid("page") as PageDocument;
    expect(validateDesign(manifest, [page])).toEqual([]);
    expect(schemaResult(manifest).ok).toBe(true);
    expect(schemaResult(page).ok).toBe(true);
  });

  it("rejects schema-invalid fixtures in both the schema and the core", () => {
    for (const entry of index.schemaInvalid) {
      const value = readFixture(entry.file);
      const result = schemaResult(value);
      expect(result.ok, `${entry.file} should fail the schema`).toBe(false);
      const codes = coreCodes(entry.kind, value, manifestTokens());
      expect(codes, `${entry.file} core codes: ${codes.join(", ")}`).toContain(entry.code);
    }
  });

  it("keeps semantic-invalid fixtures schema-valid and rejects them in the core", () => {
    for (const entry of index.semanticInvalid) {
      const value = readFixture(entry.file);
      const result = schemaResult(value);
      expect(result.ok, `${entry.file} should pass the structural schema: ${result.errors}`).toBe(true);
      const codes = coreCodes(entry.kind, value, manifestTokens());
      expect(codes, `${entry.file} core codes: ${codes.join(", ")}`).toContain(entry.code);
    }
  });

  it("accepts every v1 node type", () => {
    const base = createDesign({ name: "All nodes", pageName: "Page" });
    const assetId = newId("as");
    base.manifest.assets = [{ id: assetId, file: "assets/x.png", mime: "image/png" }];
    const nodes = [
      createNode({ type: "frame", name: "Frame" }),
      createNode({ type: "group", name: "Group" }),
      createNode({ type: "text", name: "Text", content: "Hello" }),
      createNode({ type: "rect", name: "Rect" }),
      createNode({ type: "ellipse", name: "Ellipse" }),
      createNode({ type: "image", name: "Image", asset: assetId }),
      createNode({
        type: "snapshot",
        name: "Snapshot",
        source: {
          url: "https://example.com/",
          viewport: { width: 1440, height: 900 },
          capturedAt: "2026-10-25T00:00:00.000Z",
        },
        files: { html: "snapshots/x.html" },
      }),
    ];
    let page = base.pages[0];
    for (const node of nodes) page = insertNode(page, node);
    expect(validateDesign(base.manifest, [page])).toEqual([]);
    const result = schemaResult(page);
    expect(result.ok, result.errors).toBe(true);
  });

  it("accepts every command type", () => {
    const pageId = "pg_01M5T0A1B2C3D4E5F6G7H8J9KN";
    const nodeId = "nd_01M5T0A1B2C3D4E5F6G7H8J9KQ";
    const node = createNode({ type: "rect", name: "Rect" });
    const text = createNode({ type: "text", name: "Text", content: "Hi" });
    const commands = [
      { type: "node.insert", node, parentId: null, index: 0 },
      {
        type: "node.insertSubtree",
        nodes: [node, text],
        rootId: node.id,
        parentId: null,
        index: 0,
      },
      { type: "node.update", nodeId, patch: { content: "Hi" } },
      { type: "node.replace", node },
      { type: "node.move", nodeId, parentId: null, index: 0 },
      { type: "node.remove", nodeId },
      { type: "node.duplicate", nodeId, parentId: null, index: 0 },
    ];
    for (const command of commands) {
      const result = schemaResult({ pageId, command });
      expect(result.ok, `${command.type}: ${result.errors}`).toBe(true);
      expect(commandCodes({ pageId, command })).toEqual([]);
    }
  });

  it("publishes page document commands", () => {
    const page = createPage({ name: "About" });
    const create = {
      type: "page.create",
      page,
      file: "pages/about.json",
    };
    const createResult = schemaResult(create);
    expect(createResult.ok, createResult.errors).toBe(true);
    expect(readDocumentCommand(create).type).toBe("page.create");

    const requestResult = schemaResult({ command: create });
    expect(requestResult.ok, requestResult.errors).toBe(true);

    const removeResult = schemaResult({
      type: "page.remove",
      pageId: page.id,
    });
    expect(removeResult.ok, removeResult.errors).toBe(true);
    expect(readDocumentCommand({ type: "page.remove", pageId: page.id })).toEqual({
      type: "page.remove",
      pageId: page.id,
    });

    expect(
      schemaResult({ ...create, file: "weft.json" }).ok,
      "the manifest path is reserved",
    ).toBe(false);
    expect(
      schemaResult({ type: "page.rename", pageId: page.id, name: "Renamed" }).ok,
    ).toBe(true);
    expect(
      schemaResult({ type: "page.move", pageId: page.id, index: 0 }).ok,
    ).toBe(true);
  });

  it("accepts the starter design", () => {
    const starter = join(repoRoot, "examples/starter.weft");
    const manifest = parseJson(
      readFileSync(join(starter, "weft.json"), "utf8"),
    ) as DesignManifest;
    const pages = manifest.pages.map((ref) =>
      parseJson(readFileSync(join(starter, ref.file), "utf8")) as PageDocument,
    );
    expect(validateDesign(manifest, pages)).toEqual([]);
    const manifestSchema = schemaResult(manifest);
    expect(manifestSchema.ok, manifestSchema.errors).toBe(true);
    for (const page of pages) {
      const pageSchema = schemaResult(page);
      expect(pageSchema.ok, pageSchema.errors).toBe(true);
    }
  });
});

function manifestTokens(): TokenTree | undefined {
  const manifest = findValid("manifest") as DesignManifest;
  return manifest.tokens;
}
