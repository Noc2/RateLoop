export function getFreeTransactionAllowanceDisplayState(params: {
  canShowFreeTransactionAllowance: boolean;
  isResolved: boolean;
  limit: number;
  remaining: number;
  verified: boolean;
}) {
  if (!params.isResolved || !params.canShowFreeTransactionAllowance) {
    return { kind: "hidden" as const };
  }

  if (!params.verified) {
    return params.limit > 0 ? { kind: "verify" as const, limit: params.limit } : { kind: "hidden" as const };
  }

  if (params.remaining <= 0 || params.limit <= 0) {
    return { kind: "hidden" as const };
  }

  return {
    kind: "quota" as const,
    limit: params.limit,
    remaining: params.remaining,
  };
}
