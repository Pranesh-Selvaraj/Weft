import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDesign,
  createNode,
  createPage,
  insertNode,
  nextPageFile,
  type DesignFile,
  type TextNode,
} from "@weft/core";
import { readDesign, writeDesign } from "@weft/design-io";
import { writeWorkspace } from "@weft/workspace";
import { createWeftMcpServer } from "../src/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

let root: string;
let designDir: string;
let design: DesignFile;
let nodeId: string;
let server: McpServer | null = null;
let client: Client | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "weft-mcp-"));
  designDir = join(root, "agent.weft");
  const base = createDesign({ name: "Agent design", pageName: "Landing" });
  const node = createNode({ type: "text", content: "Hello agent" });
  nodeId = node.id;
  const page = insertNode(base.pages[0], node);
  design = { manifest: base.manifest, pages: [page] };
  await writeDesign(designDir, design);
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

async function disconnect(): Promise<void> {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  client = null;
  server = null;
}

async function connect(designPath = designDir, readOnly = false): Promise<void> {
  server = await createWeftMcpServer({ designDir: designPath, readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "weft-mcp-test", version: "1.0.0" });
  await client.connect(clientTransport);
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  if (!client) throw new Error("client not connected");
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((entry) => entry.type === "text")?.text;
  if (!text) throw new Error("tool returned no text");
  return JSON.parse(text) as Record<string, any>;
}

describe("Weft MCP server", () => {
  it("lists its tools and the allowlisted design", async () => {
    await connect();
    const tools = await client!.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "weft_list_designs",
        "weft_design_summary",
        "weft_get_page",
        "weft_get_node",
        "weft_validate",
        "weft_apply_command",
        "weft_page_command",
        "weft_context",
      ]),
    );

    const listed = await call("weft_list_designs");
    expect(listed.ok).toBe(true);
    expect(listed.designs[0]).toMatchObject({ path: designDir, name: "Agent design" });

    const summary = await call("weft_design_summary", { designPath: designDir });
    expect(summary.ok).toBe(true);
    expect(summary.summary.pages).toHaveLength(1);
    expect(summary.summary.nodeCount).toBe(1);

    const page = await call("weft_get_page", { designPath: designDir, page: "Landing" });
    expect(page.page.nodes[nodeId].content).toBe("Hello agent");
    const node = await call("weft_get_node", { designPath: designDir, nodeId });
    expect(node.node.id).toBe(nodeId);
    expect(node.ancestors).toEqual([]);
  });

  it("applies a page command and returns its inverse", async () => {
    await connect();
    const result = await call("weft_apply_command", {
      designPath: designDir,
      pageId: design.pages[0].id,
      command: { type: "node.update", nodeId, patch: { content: "Updated by agent" } },
    });
    expect(result.ok).toBe(true);
    expect(result.inverse.type).toBe("node.replace");
    expect(result.createdNodeIds).toEqual([]);

    const updated = await readDesign(designDir);
    expect((updated.pages[0].nodes[nodeId] as TextNode).content).toBe("Updated by agent");

    const dry = await call("weft_apply_command", {
      designPath: designDir,
      pageId: design.pages[0].id,
      command: { type: "node.update", nodeId, patch: { content: "Not written" } },
      dryRun: true,
    });
    expect(dry.written).toEqual([]);
    const unchanged = await readDesign(designDir);
    expect((unchanged.pages[0].nodes[nodeId] as TextNode).content).toBe("Updated by agent");
  });

  it("creates pages through a document command and returns a context packet", async () => {
    await connect();
    const page = createPage({ name: "Agent page" });
    const command = {
      type: "page.create",
      page,
      file: nextPageFile(design.manifest, page.name),
    };
    const result = await call("weft_page_command", { designPath: designDir, command });
    expect(result.ok).toBe(true);
    expect(result.inverse).toEqual({ type: "page.remove", pageId: page.id });
    expect(result.pages).toBe(2);

    const context = await call("weft_context", {
      designPath: designDir,
      page: "Landing",
      nodeId,
    });
    expect(context.ok).toBe(true);
    expect(context.node.id).toBe(nodeId);
    expect(context.notice).toContain("untrusted");
    expect(context.summary.pages).toHaveLength(2);
  });

  it("enforces the design allowlist and read-only mode", async () => {
    await connect();
    const denied = await call("weft_design_summary", { designPath: join(root, "outside.weft") });
    expect(denied.ok).toBe(false);
    expect(denied.error.code).toBe("design.denied");

    await disconnect();
    await connect(designDir, true);
    const readOnly = await call("weft_apply_command", {
      designPath: designDir,
      pageId: design.pages[0].id,
      command: { type: "node.update", nodeId, patch: { content: "blocked" } },
    });
    expect(readOnly.ok).toBe(false);
    expect(readOnly.error.code).toBe("mcp.read-only");

    const workspaceFile = join(root, "workspace.json");
    await writeWorkspace(
      {
        version: 1,
        projects: [
          { path: designDir, name: "Agent project", addedAt: "2026-10-25T00:00:00.000Z" },
        ],
      },
      workspaceFile,
    );
    await disconnect();
    server = await createWeftMcpServer({ workspaceFile });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "weft-mcp-test", version: "1.0.0" });
    await client.connect(clientTransport);
    const listed = await call("weft_list_designs");
    expect(listed.designs[0]).toMatchObject({
      path: designDir,
      projectName: "Agent project",
    });
  });
});
