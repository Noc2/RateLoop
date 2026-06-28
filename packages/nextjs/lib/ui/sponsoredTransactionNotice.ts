export const SPONSORED_TRANSACTION_DELAY_NOTICE_ID = "sponsored-transaction-delay-notice";

const SPONSORED_TRANSACTION_DELAY_DESCRIPTION = "Sponsored transactions can take up to a minute.";

type SponsoredTransactionDelayNoticeParams = {
  route: "external-wallet" | "thirdweb";
  sponsorshipMode: "self-funded" | "sponsored";
};

export function getSponsoredTransactionDelayNotice() {
  return {
    title: "Submitting transaction",
    description: SPONSORED_TRANSACTION_DELAY_DESCRIPTION,
  };
}

export function getSponsoredSubmittingTransactionStatus(action: string) {
  return {
    title: `Submitting ${action}`,
    description: SPONSORED_TRANSACTION_DELAY_DESCRIPTION,
  };
}

export function getSlowSponsoredTransactionStatus(action: string) {
  return {
    title: `Still submitting ${action}`,
    description: SPONSORED_TRANSACTION_DELAY_DESCRIPTION,
  };
}

export function shouldShowSponsoredTransactionDelayNotice(params: SponsoredTransactionDelayNoticeParams) {
  return params.route === "thirdweb" && params.sponsorshipMode === "sponsored";
}
