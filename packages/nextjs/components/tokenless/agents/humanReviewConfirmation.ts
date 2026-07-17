import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

type HumanReviewConfirmationInput = {
  authority: "check_only" | "prepare_for_approval" | "ask_automatically";
  bountyPerSeatAtomic: string | null;
  feedbackBonusPoolAtomic: string | null;
  panelSize: number | null;
};

function nonNegativeAtomic(value: string | null) {
  return value && /^\d+$/u.test(value) ? BigInt(value) : 0n;
}

export function humanReviewConfirmationMessage(input: HumanReviewConfirmationInput) {
  const panelSize =
    Number.isSafeInteger(input.panelSize) && Number(input.panelSize) > 0 ? BigInt(input.panelSize!) : 0n;
  const maximumReviewerPayment =
    nonNegativeAtomic(input.bountyPerSeatAtomic) * panelSize + nonNegativeAtomic(input.feedbackBonusPoolAtomic);
  const consequences: string[] = [];

  if (input.authority === "ask_automatically") {
    consequences.push(
      "The agent will be able to send review requests automatically, without another approval. Material already sent cannot be recalled.",
    );
  }
  if (maximumReviewerPayment > 0n) {
    consequences.push(
      `Reviewer payments can total up to ${formatUsdcAtomic(maximumReviewerPayment)} per request, plus the base-review fee and attempt reserve.`,
    );
  }

  return consequences.length ? `${consequences.join("\n\n")}\n\nSave this configuration?` : null;
}
