import {
  CONFIDENTIALITY_BOND_REQUIRED_ERROR_SELECTOR,
  CONFIDENTIALITY_CREDENTIAL_REQUIRED_ERROR_SELECTOR,
  CONTENT_NOT_ACTIVE_ERROR_SELECTOR,
  IDENTITY_BANNED_ERROR_SELECTOR,
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

test("normalizeRoundVoteError hides raw wallet bundle failures", () => {
  assert.equal(
    normalizeRoundVoteError("Call bundle failed with status: 500"),
    "Wallet could not submit this vote bundle. Please retry in a moment.",
  );
});

test("normalizeRoundVoteError translates content inactive selectors", () => {
  assert.equal(
    normalizeRoundVoteError(`commitVote reverted with selector ${CONTENT_NOT_ACTIVE_ERROR_SELECTOR}`),
    "This content is no longer active for voting.",
  );
});

test("normalizeRoundVoteError translates confidentiality gate selectors", () => {
  assert.equal(
    normalizeRoundVoteError(`Encoded error signature "${CONFIDENTIALITY_CREDENTIAL_REQUIRED_ERROR_SELECTOR}"`),
    "Private-context questions require an active human credential before voting.",
  );
  assert.equal(
    normalizeRoundVoteError(`commitVote reverted with selector ${CONFIDENTIALITY_BOND_REQUIRED_ERROR_SELECTOR}`),
    "Post the required confidentiality bond before voting.",
  );
  assert.equal(
    normalizeRoundVoteError(`commitVote reverted with selector ${IDENTITY_BANNED_ERROR_SELECTOR}`),
    "This rater identity is not allowed to vote.",
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

test("normalizeRoundVoteError translates advisory recorder errors", () => {
  assert.equal(
    normalizeRoundVoteError("UnverifiedAdvisoryCapReached"),
    "This round has reached the zero-LREP limit for unverified wallets. Verify a human credential or try another round.",
  );
  assert.equal(
    normalizeRoundVoteError("ConfidentialityGated"),
    "Zero-LREP advisory voting is not available for private-context questions.",
  );
});

test("normalizeRoundVoteError hides internal drand target derivation errors", () => {
  assert.equal(
    normalizeRoundVoteError("No shared drand target round for commit windows"),
    "Preparing private vote timing. Please try again in a moment.",
  );
});
