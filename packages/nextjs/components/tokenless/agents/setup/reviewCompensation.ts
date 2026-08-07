import type { ReviewRequestProfileInput } from "./reviewCriterion";
import { type SetupLocalization, type SetupMessages, SetupValidationError, setupMessages } from "./setupMessages";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

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

export function usdcAtomicToDecimal(value: string, localization?: SetupLocalization) {
  const messages = setupMessages(localization);
  if (!POSITIVE_ATOMIC_PATTERN.test(value)) throw new SetupValidationError(messages.savedBountyInvalid());
  const atomic = BigInt(value);
  if (atomic > MAX_USDC_ATOMIC) throw new SetupValidationError(messages.savedBountyRange());
  const whole = atomic / USDC_SCALE;
  const fraction = (atomic % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function usdcDecimalToAtomic(value: string, panelSize: number, messages: SetupMessages) {
  const label = messages.policy.payment.bountyPerReviewer;
  const normalized = value.trim();
  if (normalized.length > REVIEW_USDC_DECIMAL_MAX_LENGTH) {
    throw new SetupValidationError(messages.amountRange(label));
  }
  const match = USDC_DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new SetupValidationError(messages.decimalPlaces(label));
  const atomic = BigInt(match[1]!) * USDC_SCALE + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  if (atomic <= 0n) throw new SetupValidationError(messages.greaterThanZero(label));
  if (atomic > MAX_USDC_ATOMIC || atomic * BigInt(panelSize) > MAX_USDC_ATOMIC) {
    throw new SetupValidationError(messages.amountRangeForPanel(label));
  }
  return atomic.toString();
}

export function reviewCompensationFormValues(
  profile: ReviewRequestProfile | null | undefined,
  authority: AgentSetupReviewDraft["authority"] | null | undefined,
  localization?: SetupLocalization,
): ReviewCompensationFormValues {
  return {
    compensationMode: profile?.compensationMode ?? "unpaid",
    usdcPerReviewer: profile?.bountyPerSeatAtomic
      ? usdcAtomicToDecimal(profile.bountyPerSeatAtomic, localization)
      : "1",
    feedbackBonusEnabled: profile?.feedbackBonusEnabled ?? false,
    feedbackBonusUsdc: profile?.feedbackBonusPoolAtomic
      ? usdcAtomicToDecimal(profile.feedbackBonusPoolAtomic, localization)
      : "2",
    feedbackBonusAwarderKind: profile?.feedbackBonusAwarderKind ?? "requester",
    feedbackBonusAwarderAccount: profile?.feedbackBonusAwarderAccount ?? "",
    authority: authority ?? "check_only",
  };
}

export function buildReviewCompensationConfiguration(
  profile: ReviewRequestProfileInput,
  values: ReviewCompensationFormValues,
  localization?: SetupLocalization,
): { requestProfile: ReviewRequestProfileInput; authority: AgentSetupReviewDraft["authority"] } {
  const messages = setupMessages(localization);
  if (
    !(
      values.authority === "check_only" ||
      values.authority === "prepare_for_approval" ||
      values.authority === "ask_automatically"
    )
  ) {
    throw new SetupValidationError(messages.invalidAuthority());
  }
  const compensationMode = profile.audience === "private_invited" ? values.compensationMode : "usdc";
  if (!(compensationMode === "unpaid" || compensationMode === "usdc")) {
    throw new SetupValidationError(messages.invalidCompensation());
  }
  const bountyPerSeatAtomic =
    compensationMode === "unpaid"
      ? null
      : usdcDecimalToAtomic(values.usdcPerReviewer, profile.panelSize ?? 0, messages);
  const feedbackBonusEnabled = values.feedbackBonusEnabled ?? false;
  const feedbackBonusAwarderKind = values.feedbackBonusAwarderKind ?? "requester";
  const feedbackBonusAwarderAccount = (values.feedbackBonusAwarderAccount ?? "").trim();
  if (!(feedbackBonusAwarderKind === "requester" || feedbackBonusAwarderKind === "designated")) {
    throw new SetupValidationError(messages.invalidBonusAwarder());
  }
  if (feedbackBonusAwarderKind === "designated" && !feedbackBonusAwarderAccount) {
    throw new SetupValidationError(messages.bonusAwarderAccountRequired());
  }
  const feedbackBonusPoolAtomic = feedbackBonusEnabled
    ? usdcDecimalToAtomic(values.feedbackBonusUsdc ?? "", 1, messages)
    : null;
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
