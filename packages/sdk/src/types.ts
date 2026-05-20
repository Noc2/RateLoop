export type RateLoopFetch = typeof fetch;

export interface RateLoopSdkOptions {
  chainId?: number;
  apiBaseUrl?: string;
  frontendCode?: `0x${string}`;
  fetchImpl?: RateLoopFetch;
  timeoutMs?: number;
}

export interface RateLoopClientConfig {
  chainId?: number;
  apiBaseUrl?: string;
  frontendCode?: `0x${string}`;
  fetchImpl: RateLoopFetch;
  timeoutMs: number;
}
