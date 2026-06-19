export const DEFAULT_POLLING_INTERVAL = 30_000;
export const BASE_POLLING_INTERVAL = 5_000;
export const BASE_PRECONF_POLLING_INTERVAL = 2_000;

export const RPC_OVERRIDES = {} as const satisfies Partial<Record<number, string>>;

const BASE_CHAIN_IDS = new Set([8453, 84532]);

export function getPollingIntervalForChainId(
  chainId: number,
  fallback = DEFAULT_POLLING_INTERVAL,
  options?: { preconfirmation?: boolean },
) {
  if (!BASE_CHAIN_IDS.has(chainId)) return fallback;
  return options?.preconfirmation ? BASE_PRECONF_POLLING_INTERVAL : BASE_POLLING_INTERVAL;
}
