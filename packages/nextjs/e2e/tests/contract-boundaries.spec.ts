import { approveLREP, commitVoteDirect } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { expect, test } from "@playwright/test";

/**
 * Contract boundary tests — verifies on-chain reverts for invalid operations.
 *
 * Uses direct contract calls (no browser/UI) to test edge cases with commitVote:
 * 1. Commit with fractional stake below 1 LREP → InvalidStake
 * 2. Commit with stake above MAX_STAKE (10 LREP) → InvalidStake
 * 3. Self-vote (submitter commits on own content) → SelfVote
 * 4. Double commit in same round → AlreadyCommitted
 *
 * Account allocation:
 * - Account #2 — submitter of seeded content #1 (self-vote test)
 * - Account #3 — voter for boundary tests
 * - Account #4 — voter for double-commit test
 */
test.describe("Contract boundary conditions", () => {
  const VOTING_ENGINE = CONTRACT_ADDRESSES.RoundVotingEngine;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  test("commit with fractional stake below 1 LREP reverts", async () => {
    const voter = ANVIL_ACCOUNTS.account3;
    const fractionalStake = BigInt(500_000); // 0.5 LREP

    await approveLREP(VOTING_ENGINE, fractionalStake, voter.address, LREP_TOKEN);

    // Use seeded content #1 (submitted by account #2)
    const result = await commitVoteDirect(BigInt(1), true, fractionalStake, ZERO_ADDRESS, voter.address, VOTING_ENGINE);
    expect(result.success, "Commit below MIN_STAKE should revert").toBe(false);
  });

  test("commit with stake above MAX_STAKE (10 LREP) reverts", async () => {
    const voter = ANVIL_ACCOUNTS.account3;
    const aboveMaxStake = BigInt(11e6); // 11 LREP (MAX_STAKE = 10 LREP)

    // Approve the large amount
    await approveLREP(VOTING_ENGINE, aboveMaxStake, voter.address, LREP_TOKEN);

    // Use seeded content #1
    const result = await commitVoteDirect(BigInt(1), true, aboveMaxStake, ZERO_ADDRESS, voter.address, VOTING_ENGINE);
    expect(result.success, "Commit with above-MAX_STAKE should revert").toBe(false);
  });

  test("self-vote (submitter commits on own content) reverts", async () => {
    // Content #1 was submitted by account #2
    const submitter = ANVIL_ACCOUNTS.account2;
    const stake = BigInt(1e6); // 1 LREP

    await approveLREP(VOTING_ENGINE, stake, submitter.address, LREP_TOKEN);

    const result = await commitVoteDirect(BigInt(1), true, stake, ZERO_ADDRESS, submitter.address, VOTING_ENGINE);
    expect(result.success, "Self-vote should revert with SelfVote").toBe(false);
  });

  test("double commit in same round reverts", async () => {
    test.setTimeout(180_000);

    const target = await createFreshVoteableContent("Boundary Double Commit", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh double-commit target should submit and index").not.toBeNull();

    const contentId = BigInt(target!.contentId);
    const voter = ANVIL_ACCOUNTS.account4;
    const stake = BigInt(1e6); // 1 LREP
    await approveLREP(VOTING_ENGINE, stake * 2n, voter.address, LREP_TOKEN);

    const firstCommit = await commitVoteDirect(contentId, true, stake, ZERO_ADDRESS, voter.address, VOTING_ENGINE);
    expect(firstCommit.success, "First commit should succeed").toBe(true);

    // Second commit on same content in same round should revert
    const secondCommit = await commitVoteDirect(contentId, false, stake, ZERO_ADDRESS, voter.address, VOTING_ENGINE);
    expect(secondCommit.success, "Double commit should revert with AlreadyCommitted").toBe(false);
  });
});
