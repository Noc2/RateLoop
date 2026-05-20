import { resolveClientConfig } from "./config";
import { createRateLoopReadClient, type RateLoopReadClient } from "./read";
import type { RateLoopClientConfig, RateLoopSdkOptions } from "./types";

export interface RateLoopClient {
  config: RateLoopClientConfig;
  read: RateLoopReadClient;
}

export function createRateLoopClient(options: RateLoopSdkOptions = {}): RateLoopClient {
  const config = resolveClientConfig(options);

  return {
    config,
    read: createRateLoopReadClient(config),
  };
}
