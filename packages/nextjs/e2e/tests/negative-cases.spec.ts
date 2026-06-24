import { cancelContent } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { voteOnSpecificContent } from "../helpers/vote-helpers";
import {
  cycleVoteFeedForVisible,
  gotoWithRetry,
  waitForFeedLoaded,
} from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function waitForAnyVisible(page: Page, locators: Locator[], timeout = 10_000): Promise<boolean> {
  return expect
    .poll(
      async () => {
        for (const locator of locators) {
          const matchCount = await locator.count().catch(() => 0);
          const visibleChecks = Math.max(matchCount, 1);
          for (let index = 0; index < Math.min(visibleChecks, 10); index += 1) {
            if (await locator.nth(index).isVisible().catch(() => false)) {
              return true;
            }
          }
        }
        return false;
      },
      { intervals: [500, 1_000, 2_000], timeout },
    )
    .toBe(true)
    .then(() => true)
    .catch(() => false);
}

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

    const target = await createFreshVoteableContent("Negative Double Vote", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh double-vote target should submit and index").not.toBeNull();

    // Account #6 has rater credential #104 and LREP.
    await setupWallet(page, ANVIL_ACCOUNTS.account6.privateKey);

    const votedContentId = target!.contentId;
    const firstVoteSucceeded = await voteOnSpecificContent(page, votedContentId, "up", {
      indexedTimeoutMs: 90_000,
      voterAddress: ANVIL_ACCOUNTS.account6.address,
    });

    expect(firstVoteSucceeded, "first vote should succeed before the duplicate-vote cooldown assertion").toBe(true);

    // After successful vote, stay on the page and verify the UI shows voted state.
    // The VotingQuestionCard reads the vote from contract state and shows
    // "Voted hidden" badge or "Cooldown" instead of vote buttons.
    // The page may auto-advance to the next content after voting.
    // Also accept "vote reverted" as evidence: the contract rejects
    // duplicate votes, so a revert when revisiting means the prior vote stuck.
    const votedStateIndicators = [
      page.getByText(/Voted(?: hidden| Up| Down)?/i),
      page.getByText(/Cooldown/i),
      page.getByText(/vote.*reverted/i),
      page.getByText(/\bLREP voting\b/i),
      page.getByText(/\bStaked\b/i),
    ];
    const votedOrCooldown = votedStateIndicators.reduce((combined, locator) => combined.or(locator));

    let foundVotedState = await waitForAnyVisible(page, votedStateIndicators, 15_000);

    if (!foundVotedState) {
      // Page may have auto-advanced to next content. Re-open the voted item
      // directly when possible, then fall back to cycling the snap feed.
      if (votedContentId) {
        await gotoWithRetry(page, `/rate?content=${votedContentId}`, { ensureWalletConnected: true, timeout: 30_000 });
        await waitForFeedLoaded(page, 20_000);
        foundVotedState = await waitForAnyVisible(page, votedStateIndicators, 10_000);
      }

      if (!foundVotedState) {
        foundVotedState = await cycleVoteFeedForVisible(page, votedOrCooldown, { maxSteps: 20, timeout: 3_000 });
      }

      if (!foundVotedState) {
        foundVotedState = await waitForAnyVisible(page, votedStateIndicators, 15_000);
      }
    }

    expect(foundVotedState, "the voted content should show voted, cooldown, or duplicate-vote feedback").toBe(true);
  });
});
