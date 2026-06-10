import {
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ExecutionRevertedError,
} from "viem";

/**
 * True when the chain actually answered the call and the call itself failed
 * deterministically: an execution revert, a call against an address without code, or a
 * zero-data response that cannot be decoded. Replaying the call would fail the same way, so
 * callers may legitimately fall back to a default value.
 *
 * Transient failures (HttpRequestError, TimeoutError, RpcRequestError rate limits, plain
 * network errors, ...) deliberately do NOT match: persisting a fallback for those would bake
 * wrong data into the index, so callers must rethrow and let Ponder retry the handler.
 */
export function isDeterministicContractCallError(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  return (
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError ||
        cause instanceof AbiDecodingZeroDataError ||
        cause instanceof ExecutionRevertedError,
    ) !== null
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ContractReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Runs a contract read with a bounded in-process retry for transient RPC failures.
 *
 * - Success: `{ ok: true, value }`.
 * - Deterministic call failure (revert / missing code / zero data): `{ ok: false, error }` so
 *   the caller can apply its documented fallback.
 * - Transient transport/RPC failure: retried up to `attempts` times with exponential backoff,
 *   then rethrown so the indexing handler fails loudly and Ponder retries it instead of
 *   silently persisting fallback data.
 */
export async function tryContractRead<T>(
  read: () => Promise<T>,
  { attempts = 3, backoffMs = 200 }: { attempts?: number; backoffMs?: number } = {},
): Promise<ContractReadResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      if (isDeterministicContractCallError(error)) {
        return { ok: false, error };
      }
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(backoffMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
