import { cp, mkdir, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startBridge } from "../packages/bridge/dist/index.js";

const starter = fileURLToPath(new URL("../examples/starter.weft", import.meta.url));
// A fixed path makes every run start clean. The fixture is disposable; the
// committed starter design is never modified.
const root = join(tmpdir(), "weft-e2e");
const designDir = join(root, "starter.weft");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await cp(starter, designDir, { recursive: true });

const bridge = await startBridge({
  designDir,
  host: "127.0.0.1",
  port: 5260,
});

console.log(`Weft E2E bridge ${bridge.url}`);
console.log(`Design ${designDir}`);

const cleanup = () => rmSync(root, { recursive: true, force: true });
process.on("exit", cleanup);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await bridge.close().catch(() => undefined);
  cleanup();
  process.exit(0);
}

process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
