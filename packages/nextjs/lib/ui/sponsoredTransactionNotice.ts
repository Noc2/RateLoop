export const SPONSORED_TRANSACTION_DELAY_NOTICE_ID = "sponsored-transaction-delay-notice";

type SponsoredTransactionDelayNoticeParams = {
  route: "external-wallet" | "thirdweb";
  sponsorshipMode: "self-funded" | "sponsored";
};

export function getSponsoredTransactionDelayNotice() {
  return {
    title: "Free gas may take a little longer",
    description:
      "RateLoop is sponsoring this transaction. Sponsored transactions can take up to a minute to relay, so keep this tab open and avoid retrying while it submits.",
  };
}

export function getSlowSponsoredTransactionStatus() {
  return {
    title: "Still submitting sponsored transaction",
    description:
      "The sponsored relay is still working. This is expected sometimes; we'll update once the transaction is sent.",
  };
}

export function shouldShowSponsoredTransactionDelayNotice(params: SponsoredTransactionDelayNoticeParams) {
  return params.route === "thirdweb" && params.sponsorshipMode === "sponsored";
}
