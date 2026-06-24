import { isBlockNotFoundError } from "../transactionErrors";

type BlockNumberClient = {
  getBlockNumber: () => Promise<bigint>;
};

type BlockLookupClient<TBlock> = {
  getBlock: (params: { blockNumber: bigint } | { blockTag: "latest" }) => Promise<TBlock>;
};

const DEFAULT_NEXT_BLOCK_TIMEOUT_MS = 8_000;
const DEFAULT_BLOCK_POLL_MS = 250;
const DEFAULT_BLOCK_LOOKUP_TIMEOUT_MS = 15_000;
const BLOCK_NOT_FOUND_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function readLatestBlockNumber(client: BlockNumberClient | null | undefined) {
  if (!client) return null;
  try {
    return await client.getBlockNumber();
  } catch {
    return null;
  }
}

export async function waitForNextObservedBlock(
  client: BlockNumberClient | null | undefined,
  options: {
    afterBlockNumber: bigint | null | undefined;
    pollMs?: number;
    timeoutMs?: number;
  },
) {
  if (!client || options.afterBlockNumber === null || options.afterBlockNumber === undefined) return false;

  const pollMs = Math.max(50, Math.floor(options.pollMs ?? DEFAULT_BLOCK_POLL_MS));
  const timeoutMs = Math.max(pollMs, Math.floor(options.timeoutMs ?? DEFAULT_NEXT_BLOCK_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const blockNumber = await readLatestBlockNumber(client);
    if (blockNumber !== null && blockNumber > options.afterBlockNumber) {
      return true;
    }
    await wait(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  return false;
}

export async function getBlockWithRetry<TBlock>(
  client: BlockLookupClient<TBlock>,
  params: { blockNumber: bigint } | { blockTag: "latest" },
  options: {
    pollMs?: number;
    timeoutMs?: number;
  } = {},
) {
  const pollMs = Math.max(50, Math.floor(options.pollMs ?? DEFAULT_BLOCK_POLL_MS));
  const timeoutMs = Math.max(pollMs, Math.floor(options.timeoutMs ?? DEFAULT_BLOCK_LOOKUP_TIMEOUT_MS));
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  for (;;) {
    try {
      return await client.getBlock(params);
    } catch (error) {
      if (!isBlockNotFoundError(error) || Date.now() >= deadline) {
        throw error;
      }

      const retryDelay =
        BLOCK_NOT_FOUND_RETRY_DELAYS_MS[Math.min(attempt, BLOCK_NOT_FOUND_RETRY_DELAYS_MS.length - 1)] ?? pollMs;
      attempt += 1;
      await wait(Math.min(retryDelay, Math.max(0, deadline - Date.now())));
    }
  }
}
