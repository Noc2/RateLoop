export class TokenlessMcpToolError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "TokenlessMcpToolError";
    this.code = code;
  }
}

export class TokenlessMcpHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "TokenlessMcpHttpError";
    this.code = code;
    this.status = status;
  }
}
