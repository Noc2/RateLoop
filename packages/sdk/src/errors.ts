export class RateLoopSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLoopSdkError";
  }
}

export class RateLoopApiError extends RateLoopSdkError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RateLoopApiError";
    this.status = status;
  }
}
