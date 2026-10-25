import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { readDesign, readSnapshotPayloads } from "@weft/design-io";
import { defineConfig, type Plugin } from "vite";

const VIRTUAL_ID = "virtual:weft-design";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const defaultDesign = fileURLToPath(
  new URL("../../examples/starter.weft", import.meta.url),
);
const designDirectory = process.env.WEFT_DESIGN
  ? resolve(process.cwd(), process.env.WEFT_DESIGN)
  : defaultDesign;

function weftDesign(): Plugin {
  return {
    name: "weft-design",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return null;
      const design = await readDesign(designDirectory);
      const snapshots = await readSnapshotPayloads(designDirectory, design.pages);
      return `export default ${JSON.stringify({
        manifest: design.manifest,
        pages: design.pages,
        snapshots,
      })};`;
    },
    configureServer(server) {
      server.watcher.add(designDirectory);
    },
    handleHotUpdate(context) {
      if (!context.file.startsWith(resolve(designDirectory))) return;
      const module = context.server.moduleGraph.getModuleById(RESOLVED_ID);
      if (module) context.server.moduleGraph.invalidateModule(module);
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}

export default defineConfig({
  plugins: [react(), weftDesign()],
  server: {
    host: "127.0.0.1",
    port: 5240,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
