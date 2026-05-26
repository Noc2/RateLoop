import {
  hexToNumber,
  http,
  numberToHex,
  type Hex,
  type HttpTransportConfig,
  type RpcLog,
  type Transport,
} from "viem";

type JsonRpcRequest = {
  method: string;
  params?: unknown[];
};

type GetLogsParams = {
  fromBlock?: unknown;
  toBlock?: unknown;
  [key: string]: unknown;
};

function isHexBlock(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

export function chunkGetLogsParams(params: GetLogsParams, maxBlockRange: number): GetLogsParams[] {
  if (!Number.isSafeInteger(maxBlockRange) || maxBlockRange < 1) {
    throw new Error("maxBlockRange must be a positive safe integer.");
  }

  if (!isHexBlock(params.fromBlock) || !isHexBlock(params.toBlock)) {
    return [params];
  }

  const fromBlock = hexToNumber(params.fromBlock);
  const toBlock = hexToNumber(params.toBlock);
  const blockCount = toBlock - fromBlock + 1;

  if (blockCount <= maxBlockRange) {
    return [params];
  }

  const chunks: GetLogsParams[] = [];
  for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += maxBlockRange) {
    const chunkTo = Math.min(chunkFrom + maxBlockRange - 1, toBlock);
    chunks.push({
      ...params,
      fromBlock: numberToHex(chunkFrom),
      toBlock: numberToHex(chunkTo),
    });
  }

  return chunks;
}

export function httpWithGetLogsBlockRange(
  url: string,
  maxBlockRange: number | undefined,
  config?: HttpTransportConfig,
): Transport {
  const baseTransport = http(url, config);

  return options => {
    const transport = baseTransport(options);

    if (maxBlockRange === undefined) {
      return transport;
    }

    const request = (async (requestArgs: JsonRpcRequest, requestOptions?: unknown) => {
      if (requestArgs.method !== "eth_getLogs") {
        return transport.request(requestArgs as never, requestOptions as never);
      }

      const [params] = requestArgs.params ?? [];
      if (params === undefined || typeof params !== "object" || params === null) {
        return transport.request(requestArgs as never, requestOptions as never);
      }

      const chunks = chunkGetLogsParams(params as GetLogsParams, maxBlockRange);
      if (chunks.length === 1 && chunks[0] === params) {
        return transport.request(requestArgs as never, requestOptions as never);
      }

      const logs: RpcLog[] = [];
      for (const chunk of chunks) {
        const chunkLogs = (await transport.request(
          {
            ...requestArgs,
            params: [chunk],
          } as never,
          requestOptions as never,
        )) as RpcLog[];
        logs.push(...chunkLogs);
      }

      return logs;
    }) as typeof transport.request;

    return {
      ...transport,
      config: {
        ...transport.config,
        request,
      },
      request,
    };
  };
}
