import type { Config } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { isBlockNotFoundError } from "../transactionErrors";

const BLOCK_NOT_FOUND_RECEIPT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type WaitForTransactionReceiptParameters = Parameters<typeof waitForTransactionReceipt>[1];

export async function waitForTransactionReceiptWithRetry(
  config: Config,
  parameters: WaitForTransactionReceiptParameters,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await waitForTransactionReceipt(config, parameters);
    } catch (error) {
      if (!isBlockNotFoundError(error) || attempt >= BLOCK_NOT_FOUND_RECEIPT_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await wait(BLOCK_NOT_FOUND_RECEIPT_RETRY_DELAYS_MS[attempt]);
    }
  }
}
