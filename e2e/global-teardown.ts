import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function globalTeardown(): Promise<void> {
  await rm(join(tmpdir(), "weft-e2e"), { recursive: true, force: true }).catch(
    () => undefined,
  );
}
