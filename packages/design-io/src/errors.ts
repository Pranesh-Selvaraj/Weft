/** An I/O or path problem in a design directory, separate from schema validation. */
export class WeftIoError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "WeftIoError";
    this.code = code;
    this.path = path;
  }
}
