import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { readDesign } from "@weft/design-io";
import { listProjects, readWorkspace, workspaceFilePath } from "@weft/workspace";
import { McpError } from "./errors.js";
import type { McpDesignEntry, WeftMcpOptions } from "./types.js";

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    throw new McpError("design.missing", `Design directory ${path} does not exist.`);
  }
}

/**
 * Build the allowlist once at server start. A caller cannot point the MCP
 * server at an arbitrary directory later; every tool resolves through this map.
 */
export async function loadDesigns(
  options: WeftMcpOptions,
): Promise<{ designs: McpDesignEntry[]; workspaceFile: string | null; designDir: string | null }> {
  if (options.designDir && options.workspaceFile) {
    throw new McpError(
      "mcp.options",
      "Choose either --design or --workspace, not both.",
    );
  }

  if (options.designDir) {
    const path = await canonical(options.designDir);
    const design = await readDesign(path, { requireFiles: false });
    return {
      designs: [{ path, name: design.manifest.name }],
      workspaceFile: null,
      designDir: path,
    };
  }

  const file = workspaceFilePath(options.workspaceFile);
  const config = await readWorkspace(file);
  const projects = await listProjects(config);
  const designs = projects.flatMap((project) =>
    project.designs.map((design) => ({
      path: design.path,
      name: design.name,
      projectPath: project.path,
      projectName: project.name,
    })),
  );
  if (designs.length === 0) {
    throw new McpError(
      "workspace.empty",
      `No designs found in workspace ${file}. Register a project with weft workspace add first.`,
    );
  }
  return { designs, workspaceFile: file, designDir: null };
}
