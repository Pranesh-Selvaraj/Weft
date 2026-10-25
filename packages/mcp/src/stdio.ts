import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWeftMcpServer } from "./server.js";
import type { WeftMcpOptions } from "./types.js";

/**
 * Run the MCP server over stdio. Stdout is reserved for the protocol; logs
 * must go to stderr.
 */
export async function runWeftMcpStdio(options: WeftMcpOptions): Promise<void> {
  const server = await createWeftMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolveClose) => {
    let closed = false;
    const finish = (): void => {
      if (closed) return;
      closed = true;
      resolveClose();
    };
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      finish();
    };
    const stop = (): void => {
      void server.close().catch(() => undefined).finally(finish);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await server.close().catch(() => undefined);
}
