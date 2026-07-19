export const DEFAULT_MAX_LOG_BLOCKS_PER_QUERY = 1_999n;

export async function getLogsInBlockChunks<T>(params: {
  fromBlock: bigint;
  toBlock: bigint;
  getLogs: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>;
  maxBlocksPerQuery?: bigint;
  stopAfterCount?: number;
}) {
  const maxBlocksPerQuery =
    params.maxBlocksPerQuery ?? DEFAULT_MAX_LOG_BLOCKS_PER_QUERY;
  if (maxBlocksPerQuery <= 0n) {
    throw new Error("maxBlocksPerQuery must be positive.");
  }
  if (params.fromBlock > params.toBlock) return [];

  const logs: T[] = [];
  let toBlock = params.toBlock;
  while (toBlock >= params.fromBlock) {
    const firstBlockInChunk = toBlock - maxBlocksPerQuery + 1n;
    const fromBlock =
      firstBlockInChunk > params.fromBlock
        ? firstBlockInChunk
        : params.fromBlock;
    logs.push(...(await params.getLogs({ fromBlock, toBlock })));
    if (
      params.stopAfterCount !== undefined &&
      logs.length >= params.stopAfterCount
    ) {
      break;
    }
    toBlock = fromBlock - 1n;
  }
  return logs;
}
