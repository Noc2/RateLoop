import {
  CONTENT_NOT_ACTIVE_ERROR_SELECTOR,
  SELF_VOTE_ERROR_SELECTOR,
  normalizeRoundVoteError,
} from "./roundVoteErrors";
import assert from "node:assert/strict";
import test from "node:test";

test("normalizeRoundVoteError translates self-vote selectors into a user-facing message", () => {
  assert.equal(
    normalizeRoundVoteError(`commitVote reverted with selector ${SELF_VOTE_ERROR_SELECTOR}`),
    "You cannot vote on your own content.",
  );
});

test("normalizeRoundVoteError keeps existing named protocol errors readable", () => {
  assert.equal(
    normalizeRoundVoteError("CooldownActive"),
    "You already voted on this content within the last 24 hours. Try again after the cooldown ends.",
  );
});

test("normalizeRoundVoteError translates content inactive selectors", () => {
  assert.equal(
    normalizeRoundVoteError(`commitVote reverted with selector ${CONTENT_NOT_ACTIVE_ERROR_SELECTOR}`),
    "This content is no longer active for voting.",
  );
});

test("normalizeRoundVoteError translates token balance and allowance errors", () => {
  assert.equal(
    normalizeRoundVoteError("ERC20InsufficientBalance(address,uint256,uint256)"),
    "You do not have enough liquid LREP to stake that amount.",
  );
  assert.equal(
    normalizeRoundVoteError("ERC20InsufficientAllowance(address,uint256,uint256)"),
    "LREP approval was not high enough for this vote. Please submit again.",
  );
});

test("normalizeRoundVoteError translates invalid stake errors", () => {
  assert.equal(
    normalizeRoundVoteError("InvalidStake"),
    "Choose a stake between 1 and 10 LREP, or choose 0 for advisory voting.",
  );
});

test("normalizeRoundVoteError hides internal drand target derivation errors", () => {
  assert.equal(
    normalizeRoundVoteError("No shared drand target round for commit windows"),
    "Preparing private vote timing. Please try again in a moment.",
  );
});
