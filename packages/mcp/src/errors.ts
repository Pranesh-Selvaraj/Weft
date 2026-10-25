export class McpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}
