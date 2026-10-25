export class ExtractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}
