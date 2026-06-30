export type HandoffDraftPaymentMode = "wallet_calls" | "x402_authorization";
export type HandoffDraftRewardAsset = "lrep" | "usdc";

export function resolveDraftHandoffPaymentMode(params: {
  bountyAsset: HandoffDraftRewardAsset;
  feedbackBonusAsset?: HandoffDraftRewardAsset | null;
  persistedPaymentMode?: HandoffDraftPaymentMode | null;
}): HandoffDraftPaymentMode {
  if (params.bountyAsset === "lrep" || params.feedbackBonusAsset === "lrep") {
    return "wallet_calls";
  }

  return params.persistedPaymentMode ?? "wallet_calls";
}
