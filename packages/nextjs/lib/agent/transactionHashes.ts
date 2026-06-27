import { type Hex } from "viem";

export const MAX_AGENT_TRANSACTION_HASHES = 32;

type ErrorFactory = (message: string) => Error;

function fail(createError: ErrorFactory, message: string): never {
  throw createError(message);
}

export function readAgentTransactionHashes(
  value: unknown,
  createError: ErrorFactory = message => new Error(message),
): Hex[] {
  if (!Array.isArray(value)) {
    fail(createError, "transactionHashes must be an array.");
  }
  if (value.length > MAX_AGENT_TRANSACTION_HASHES) {
    fail(createError, `transactionHashes must contain at most ${MAX_AGENT_TRANSACTION_HASHES} transaction hashes.`);
  }
  const hashes = value.filter((hash): hash is Hex => typeof hash === "string") as Hex[];
  if (hashes.length === 0 || hashes.length !== value.length || hashes.some(hash => !/^0x[a-fA-F0-9]{64}$/.test(hash))) {
    fail(createError, "transactionHashes must contain at least one transaction hash.");
  }
  return hashes;
}
