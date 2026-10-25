export class DevServerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DevServerError";
    this.code = code;
  }
}
