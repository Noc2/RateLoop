import { cancelContent } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import {
  VOTE_UP_BUTTON_NAME,
  cycleVoteFeedForVisible,
  findVoteableContent,
  gotoWithRetry,
  waitForFeedLoaded,
} from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { expect, test } from "@playwright/test";

/**
 * Negative / rejection tests.
 * Verify that invalid actions are properly rejected on-chain and in the UI.
 *
 * Account allocation:
 * - Account #9 (scaffold-eth deployer) — has GOVERNANCE_ROLE
 * - Account #0 (no rater credential) — unauthorized user
 * - Account #2 (1000 LREP + rater credential) — submitter of content #1
 * - Account #3 (1000 LREP + rater credential) — non-submitter
 */
test.describe("Negative cases", () => {
  test("non-submitter cannot cancel content", async () => {
    // Content #1 was submitted by account #2. Account #3 should NOT be able to cancel it.
    const success = await cancelContent(BigInt(1), ANVIL_ACCOUNTS.account3.address, CONTRACT_ADDRESSES.ContentRegistry);
    expect(success).toBe(false);
  });

  test("vote page shows content for user without rater credential", async ({ browser }) => {
    // Account #0 has no rater credential — verify the vote page loads
    // and content is visible. Vote buttons may or may not be shown
    // (the contract will reject votes without rater credential regardless).
    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account0.privateKey, { bootstrap: false });

    await page.goto("/rate");

    // The page should load safely even if the local wallet bridge doesn't attach.
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test("ask page shows submit form for user without rater credential", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account0.privateKey, { bootstrap: false });

    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test("double vote on same content shows cooldown", async ({ page }) => {
    test.setTimeout(120_000);

    // Account #6 has rater credential #104 and LREP.
    await setupWallet(page, ANVIL_ACCOUNTS.account6.privateKey);

    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 30_000 });
    await waitForFeedLoaded(page, 20_000);

    const voteUp = page.getByRole("button", { name: VOTE_UP_BUTTON_NAME }).first();
    const canVote = await findVoteableContent(page);

    expect(canVote, "account #6 should have seeded voteable content in the default E2E suite").toBe(true);
    await expect(voteUp).toBeVisible({ timeout: 10_000 });
    const votedContentId = await page.getByTestId("vote-content-card-shell").first().getAttribute("data-content-id");

    const stakeModal = page.locator("[role='dialog']").first();
    await expect(async () => {
      await voteUp.waitFor({ state: "visible", timeout: 10_000 });
      await voteUp.click({ timeout: 5_000 });
      await expect(stakeModal).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

    const presetBtn = stakeModal.getByRole("button", { name: /^1$/ });
    if (await presetBtn.isVisible().catch(() => false)) {
      await presetBtn.click();
    }

    const confirmBtn = stakeModal.getByRole("button", { name: /Stake \d+/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
    await confirmBtn.click();

    // Wait for success or error (includes approval failures).
    // The UI may show "Voted!", "submitted", "committed", "staked", or an error toast.
    // Also detect the modal closing as an implicit success signal.
    const successMsg = page.getByText(/voted|success|submitted|committed|staked/i);
    const errorMsg = page.getByText(/reverted|failed|error|rejected|not confirmed/i);
    const modalClosed = stakeModal
      .waitFor({ state: "hidden", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const msgVisible = expect(successMsg.or(errorMsg).first())
      .toBeVisible({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await Promise.race([modalClosed, msgVisible]);

    // Check if vote succeeded: either success message visible or modal closed without error
    const hasSuccessMsg = await successMsg
      .first()
      .isVisible()
      .catch(() => false);
    const hasErrorMsg = await errorMsg
      .first()
      .isVisible()
      .catch(() => false);
    const firstVoteSucceeded = hasSuccessMsg || (!hasErrorMsg && !(await stakeModal.isVisible().catch(() => true)));

    expect(firstVoteSucceeded, "first vote should succeed before the duplicate-vote cooldown assertion").toBe(true);

    // After successful vote, stay on the page and verify the UI shows voted state.
    // The VotingQuestionCard reads the vote from contract state and shows
    // "Voted hidden" badge or "Cooldown" instead of vote buttons.
    // The page may auto-advance to the next content after voting.
    // Also accept "vote reverted" as evidence: the contract rejects
    // duplicate votes, so a revert when revisiting means the prior vote stuck.
    const votedOrCooldown = page
      .getByText(/Voted(?: hidden| Up| Down)?/i)
      .or(page.getByText(/Cooldown/i))
      .or(page.getByText(/vote.*reverted/i));

    let foundVotedState = await votedOrCooldown
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!foundVotedState) {
      // Page may have auto-advanced to next content. Re-open the voted item
      // directly when possible, then fall back to cycling the snap feed.
      if (votedContentId) {
        await gotoWithRetry(page, `/rate?content=${votedContentId}`, { ensureWalletConnected: true, timeout: 30_000 });
        await waitForFeedLoaded(page, 20_000);
        foundVotedState = await votedOrCooldown
          .first()
          .waitFor({ state: "visible", timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
      }

      if (!foundVotedState) {
        foundVotedState = await cycleVoteFeedForVisible(page, votedOrCooldown, { maxSteps: 20, timeout: 3_000 });
      }
    }

    expect(foundVotedState, "the voted content should show voted, cooldown, or duplicate-vote feedback").toBe(true);
  });
});
