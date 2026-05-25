import { VOTE_COOLDOWN_SECONDS } from "~~/lib/vote/cooldown";

export const SELF_VOTE_ERROR_SELECTOR = "0x2f4015a5";
export const CONTENT_NOT_ACTIVE_ERROR_SELECTOR = "0x74e73b6d";
const TARGET_ROUND_OUT_OF_WINDOW_ERROR_SELECTOR = "0xe56a7aca";

/**
 * Match either the symbolic revert name (case-sensitive PascalCase from viem) or, when
 * provided, the raw 4-byte selector that the EVM emits when no ABI is available. Both
 * forms can reach this normalizer depending on whether the contract ABI was reachable
 * at decode time, so every branch with a known selector checks both forms uniformly.
 */
function matchesContractError(message: string, normalizedMessage: string, name: string, selector?: string) {
  if (message.includes(name)) return true;
  if (selector && normalizedMessage.includes(selector)) return true;
  return false;
}

export function normalizeRoundVoteError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("free transactions used up")) {
    return "Free transactions used up. Add ETH to continue.";
  }
  if (matchesContractError(message, normalizedMessage, "CooldownActive")) {
    return `You already voted on this content within the last ${Math.round(VOTE_COOLDOWN_SECONDS / 3600)} hours. Try again after the cooldown ends.`;
  }
  if (matchesContractError(message, normalizedMessage, "AlreadyCommitted")) {
    return "You already have a vote committed on this content in the current round.";
  }
  if (matchesContractError(message, normalizedMessage, "MaxVotersReached")) {
    return "This round is full. Wait for the next round to vote again.";
  }
  if (
    matchesContractError(message, normalizedMessage, "ERC20InsufficientBalance") ||
    normalizedMessage.includes("insufficient balance")
  ) {
    return "You do not have enough liquid LREP to stake that amount.";
  }
  if (
    matchesContractError(message, normalizedMessage, "ERC20InsufficientAllowance") ||
    normalizedMessage.includes("insufficient allowance")
  ) {
    return "LREP approval was not high enough for this vote. Please submit again.";
  }
  if (matchesContractError(message, normalizedMessage, "InvalidStake")) {
    return "Choose a stake between 1 and 10 LREP, or choose 0 for advisory voting.";
  }
  if (matchesContractError(message, normalizedMessage, "SelfVote", SELF_VOTE_ERROR_SELECTOR)) {
    return "You cannot vote on your own content.";
  }
  if (matchesContractError(message, normalizedMessage, "ContentNotActive", CONTENT_NOT_ACTIVE_ERROR_SELECTOR)) {
    return "This content is no longer active for voting.";
  }
  if (
    matchesContractError(
      message,
      normalizedMessage,
      "TargetRoundOutOfWindow",
      TARGET_ROUND_OUT_OF_WINDOW_ERROR_SELECTOR,
    )
  ) {
    return "The voting window moved while your vote was being prepared. Please try again.";
  }
  if (
    normalizedMessage.includes("no shared drand target round") ||
    normalizedMessage.includes("no valid drand target round")
  ) {
    return "Preparing private vote timing. Please try again in a moment.";
  }
  if (
    matchesContractError(message, normalizedMessage, "RoundNotAccepting") ||
    matchesContractError(message, normalizedMessage, "RoundNotOpen")
  ) {
    return "This round is not accepting votes right now.";
  }
  return message;
}
