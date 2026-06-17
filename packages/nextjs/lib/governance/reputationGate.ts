type GovernanceReputationGateState = "loading" | "error" | "zero-lrep" | "ready";

export function getGovernanceReputationGateState({
  hasAddress,
  lrepBalance,
  lrepBalanceError,
}: {
  hasAddress: boolean;
  lrepBalance: bigint | undefined;
  lrepBalanceError: boolean;
}): GovernanceReputationGateState {
  if (!hasAddress) return "ready";
  if (lrepBalance !== undefined) return lrepBalance === 0n ? "zero-lrep" : "ready";
  return lrepBalanceError ? "error" : "loading";
}
