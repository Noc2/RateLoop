import {
  getSlowSponsoredTransactionStatus,
  getSponsoredSubmittingTransactionStatus,
} from "~~/lib/ui/sponsoredTransactionNotice";
import { getSubmittingTransactionStatus } from "~~/lib/ui/transactionStatusCopy";

type TransactionFlowStatusCopy = {
  title: string;
  description: string;
};

export type TransactionFlowToastParams = {
  action: string;
  sponsored?: boolean;
};

const SLOW_SELF_FUNDED_DESCRIPTION =
  "Your wallet is signing and relaying this transaction. In-app wallets can take up to a minute before confirmation returns.";

export function resolveFlowSubmittingStatus(params: TransactionFlowToastParams): TransactionFlowStatusCopy {
  if (params.sponsored) {
    return getSponsoredSubmittingTransactionStatus(params.action);
  }

  return getSubmittingTransactionStatus(params.action);
}

export function resolveFlowSlowStatus(params: TransactionFlowToastParams): TransactionFlowStatusCopy {
  if (params.sponsored) {
    return getSlowSponsoredTransactionStatus(params.action);
  }

  return {
    title: `Still submitting ${params.action}`,
    description: SLOW_SELF_FUNDED_DESCRIPTION,
  };
}
