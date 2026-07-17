import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";
import type { ReviewRequestProfileInput } from "./reviewCriterion";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];

export type ReviewCompensationFormValues = {
  compensationMode: ReviewRequestProfile["compensationMode"];
  usdcPerReviewer: string;
  feedbackBonusEnabled?: boolean;
  feedbackBonusUsdc?: string;
  feedbackBonusAwarderKind?: "requester" | "designated";
  feedbackBonusAwarderAccount?: string;
  authority: AgentSetupReviewDraft["authority"];
};

export const REVIEW_USDC_DECIMAL_MAX_LENGTH = 86;

const USDC_SCALE = 1_000_000n;
const MAX_USDC_ATOMIC = (1n << 256n) - 1n;
const POSITIVE_ATOMIC_PATTERN = /^[1-9][0-9]*$/u;
const USDC_DECIMAL_PATTERN = /^([0-9]+)(?:\.([0-9]{1,6}))?$/u;

export function usdcAtomicToDecimal(value: string) {
  if (!POSITIVE_ATOMIC_PATTERN.test(value)) throw new Error("Saved USDC bounty is invalid.");
  const atomic = BigInt(value);
  if (atomic > MAX_USDC_ATOMIC) throw new Error("Saved USDC bounty is outside the supported range.");
  const whole = atomic / USDC_SCALE;
  const fraction = (atomic % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function usdcDecimalToAtomic(value: string, panelSize: number) {
  const normalized = value.trim();
  if (normalized.length > REVIEW_USDC_DECIMAL_MAX_LENGTH) {
    throw new Error("USDC per reviewer is outside the supported range.");
  }
  const match = USDC_DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error("USDC per reviewer must be a decimal with up to 6 places.");
  const atomic = BigInt(match[1]!) * USDC_SCALE + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  if (atomic <= 0n) throw new Error("USDC per reviewer must be greater than zero.");
  if (atomic > MAX_USDC_ATOMIC || atomic * BigInt(panelSize) > MAX_USDC_ATOMIC) {
    throw new Error("USDC per reviewer is outside the supported range for this panel.");
  }
  return atomic.toString();
}

export function reviewCompensationFormValues(
  profile: ReviewRequestProfile | null | undefined,
  authority: AgentSetupReviewDraft["authority"] | null | undefined,
): ReviewCompensationFormValues {
  return {
    compensationMode: profile?.compensationMode ?? "unpaid",
    usdcPerReviewer: profile?.bountyPerSeatAtomic ? usdcAtomicToDecimal(profile.bountyPerSeatAtomic) : "1",
    feedbackBonusEnabled: profile?.feedbackBonusEnabled ?? false,
    feedbackBonusUsdc: profile?.feedbackBonusPoolAtomic ? usdcAtomicToDecimal(profile.feedbackBonusPoolAtomic) : "2",
    feedbackBonusAwarderKind: profile?.feedbackBonusAwarderKind ?? "requester",
    feedbackBonusAwarderAccount: profile?.feedbackBonusAwarderAccount ?? "",
    authority: authority ?? "check_only",
  };
}

export function buildReviewCompensationConfiguration(
  profile: ReviewRequestProfileInput,
  values: ReviewCompensationFormValues,
): { requestProfile: ReviewRequestProfileInput; authority: AgentSetupReviewDraft["authority"] } {
  if (
    !(
      values.authority === "check_only" ||
      values.authority === "prepare_for_approval" ||
      values.authority === "ask_automatically"
    )
  ) {
    throw new Error("Choose a valid agent authority.");
  }
  const compensationMode = profile.audience === "private_invited" ? values.compensationMode : "usdc";
  if (!(compensationMode === "unpaid" || compensationMode === "usdc")) {
    throw new Error("Choose a valid reviewer payment.");
  }
  const bountyPerSeatAtomic =
    compensationMode === "unpaid" ? null : usdcDecimalToAtomic(values.usdcPerReviewer, profile.panelSize ?? 0);
  const feedbackBonusEnabled = values.feedbackBonusEnabled ?? false;
  const feedbackBonusAwarderKind = values.feedbackBonusAwarderKind ?? "requester";
  const feedbackBonusAwarderAccount = (values.feedbackBonusAwarderAccount ?? "").trim();
  if (!(feedbackBonusAwarderKind === "requester" || feedbackBonusAwarderKind === "designated")) {
    throw new Error("Choose a valid Feedback Bonus awarder.");
  }
  if (feedbackBonusAwarderKind === "designated" && !feedbackBonusAwarderAccount) {
    throw new Error("Enter the authenticated account for the designated Feedback Bonus awarder.");
  }
  const feedbackBonusPoolAtomic = feedbackBonusEnabled ? usdcDecimalToAtomic(values.feedbackBonusUsdc ?? "", 1) : null;
  return {
    requestProfile: {
      ...profile,
      compensationMode,
      bountyPerSeatAtomic,
      feedbackBonusEnabled,
      feedbackBonusPoolAtomic,
      feedbackBonusAwarderKind: feedbackBonusEnabled ? feedbackBonusAwarderKind : "requester",
      feedbackBonusAwarderAccount:
        feedbackBonusEnabled && feedbackBonusAwarderKind === "designated" ? feedbackBonusAwarderAccount : null,
      feedbackBonusAwardWindowSeconds: feedbackBonusEnabled ? 604_800 : null,
      rationaleMode: feedbackBonusEnabled && profile.rationaleMode === "off" ? "optional" : profile.rationaleMode,
    },
    authority: values.authority,
  };
}
