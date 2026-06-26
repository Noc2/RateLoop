import { isBlockNotFoundError } from "../transactionErrors";
import type { PublicClient } from "viem";
import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

const BLOCK_NOT_FOUND_RECEIPT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTransactionReceiptWithBlockNotFoundRetry<T>(
  operation: () => Promise<T>,
  delaysMs: readonly number[] = BLOCK_NOT_FOUND_RECEIPT_RETRY_DELAYS_MS,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isBlockNotFoundError(error) || attempt >= delaysMs.length) {
        throw error;
      }

      await wait(delaysMs[attempt]);
    }
  }
}

type WaitForTransactionReceiptParameters = Parameters<typeof waitForTransactionReceipt>[1];
type PublicClientWaitForTransactionReceiptParameters = Parameters<PublicClient["waitForTransactionReceipt"]>[0];

export async function waitForPublicClientTransactionReceiptWithRetry(
  publicClient: PublicClient,
  parameters: PublicClientWaitForTransactionReceiptParameters,
) {
  return waitForTransactionReceiptWithBlockNotFoundRetry(() => publicClient.waitForTransactionReceipt(parameters));
}

export async function waitForTransactionReceiptWithRetry(
  config: Config,
  parameters: WaitForTransactionReceiptParameters,
) {
  return waitForTransactionReceiptWithBlockNotFoundRetry(() => waitForTransactionReceipt(config, parameters));
}
