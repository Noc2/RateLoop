type BlockNumberClient = {
  getBlockNumber: () => Promise<bigint>;
};

const DEFAULT_NEXT_BLOCK_TIMEOUT_MS = 8_000;
const DEFAULT_BLOCK_POLL_MS = 250;

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
