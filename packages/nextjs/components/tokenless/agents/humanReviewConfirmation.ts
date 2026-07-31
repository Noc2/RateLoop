import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

type HumanReviewConfirmationInput = {
  authority: "check_only" | "prepare_for_approval" | "ask_automatically";
  bountyPerSeatAtomic: string | null;
  feedbackBonusPoolAtomic: string | null;
  panelSize: number | null;
};

type HumanReviewConfirmationCopy = {
  automatic: string;
  payment: (amount: string) => string;
  save: string;
};

const defaultCopy: HumanReviewConfirmationCopy = {
  automatic:
    "The agent will be able to send review requests automatically, without another approval. Material already sent cannot be recalled.",
  payment: amount =>
    `Reviewer payments can total up to ${amount} per request, plus the base-review fee and attempt reserve.`,
  save: "Save this configuration?",
};

function nonNegativeAtomic(value: string | null) {
  return value && /^\d+$/u.test(value) ? BigInt(value) : 0n;
}

export function humanReviewConfirmationMessage(
  input: HumanReviewConfirmationInput,
  copy: HumanReviewConfirmationCopy = defaultCopy,
) {
  const panelSize =
    Number.isSafeInteger(input.panelSize) && Number(input.panelSize) > 0 ? BigInt(input.panelSize!) : 0n;
  const maximumReviewerPayment =
    nonNegativeAtomic(input.bountyPerSeatAtomic) * panelSize + nonNegativeAtomic(input.feedbackBonusPoolAtomic);
  const consequences: string[] = [];

  if (input.authority === "ask_automatically") {
    consequences.push(copy.automatic);
  }
  if (maximumReviewerPayment > 0n) {
    consequences.push(copy.payment(formatUsdcAtomic(maximumReviewerPayment)));
  }

  return consequences.length ? `${consequences.join("\n\n")}\n\n${copy.save}` : null;
}
