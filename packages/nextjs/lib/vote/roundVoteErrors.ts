import { VOTE_COOLDOWN_SECONDS } from "~~/lib/vote/cooldown";

export const SELF_VOTE_ERROR_SELECTOR = "0x2f4015a5";
export const CONTENT_NOT_ACTIVE_ERROR_SELECTOR = "0x74e73b6d";

export function normalizeRoundVoteError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("free transactions used up")) {
    return "Free transactions used up. Add ETH to continue.";
  }
  if (message.includes("CooldownActive")) {
    return `You already voted on this content within the last ${Math.round(VOTE_COOLDOWN_SECONDS / 3600)} hours. Try again after the cooldown ends.`;
  }
  if (message.includes("AlreadyCommitted")) {
    return "You already have a vote committed on this content in the current round.";
  }
  if (message.includes("MaxVotersReached")) {
    return "This round is full. Wait for the next round to vote again.";
  }
  if (message.includes("ERC20InsufficientBalance") || normalizedMessage.includes("insufficient balance")) {
    return "You do not have enough liquid LREP to stake that amount.";
  }
  if (message.includes("ERC20InsufficientAllowance") || normalizedMessage.includes("insufficient allowance")) {
    return "LREP approval was not high enough for this vote. Please submit again.";
  }
  if (message.includes("InvalidStake")) {
    return "Choose a stake between 1 and 10 LREP, or choose 0 for advisory voting.";
  }
  if (message.includes("SelfVote") || normalizedMessage.includes(SELF_VOTE_ERROR_SELECTOR)) {
    return "You cannot vote on your own content.";
  }
  if (message.includes("ContentNotActive") || normalizedMessage.includes(CONTENT_NOT_ACTIVE_ERROR_SELECTOR)) {
    return "This content is no longer active for voting.";
  }
  if (message.includes("TargetRoundOutOfWindow") || message.includes("0xe56a7aca")) {
    return "The voting window moved while your vote was being prepared. Please try again.";
  }
  if (
    normalizedMessage.includes("no shared drand target round") ||
    normalizedMessage.includes("no valid drand target round")
  ) {
    return "Preparing private vote timing. Please try again in a moment.";
  }
  if (message.includes("RoundNotAccepting") || message.includes("RoundNotOpen")) {
    return "This round is not accepting votes right now.";
  }
  return message;
}
