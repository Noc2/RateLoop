export class RateLoopSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLoopSdkError";
  }
}

export class RateLoopApiError extends RateLoopSdkError {
  readonly code?: string;
  readonly details?: unknown;
  readonly originalCode?: string;
  readonly recoverWith?: string;
  readonly retryable?: boolean;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    details: {
      code?: string;
      details?: unknown;
      originalCode?: string;
      recoverWith?: string;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "RateLoopApiError";
    this.code = details.code;
    this.details = details.details;
    this.originalCode = details.originalCode;
    this.recoverWith = details.recoverWith;
    this.retryable = details.retryable;
    this.status = status;
  }
}
