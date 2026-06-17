import { correlationVoteScanPageBudget } from "@rateloop/node-utils/correlationScoring";

export { CORRELATION_VOTE_PAGE_SIZE } from "@rateloop/node-utils/correlationScoring";
export { correlationVoteScanPageBudget };

export function isCorrelationVoteScanTruncated(params: {
  endedNaturally: boolean;
  eligibleSeen: number;
  offset: number;
}): boolean {
  return !params.endedNaturally || params.eligibleSeen < params.offset;
}
