import { getOptionalAppUrl } from "~~/lib/env/server";

const TERMS_PATH = "/legal/terms";
const PRIVACY_PATH = "/legal/privacy";

function legalUrl(path: string): string {
  const appUrl = getOptionalAppUrl();
  return appUrl ? new URL(path, appUrl).toString() : path;
}

export function buildAgentLegalNotice() {
  return {
    acceptance:
      "Continuing by authorizing wallet spend, signing an x402 authorization, or submitting an ask confirms the operator chose to proceed after receiving these links.",
    notice:
      "Review the RateLoop Terms and Privacy Notice before paid asks. Bounties are non-refundable task payments, not investment returns.",
    privacyUrl: legalUrl(PRIVACY_PATH),
    termsUrl: legalUrl(TERMS_PATH),
  };
}
