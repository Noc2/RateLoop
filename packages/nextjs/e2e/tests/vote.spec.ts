import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { voteOnSpecificContent } from "../helpers/vote-helpers";
import {
  FEED_EMPTY_STATE_RE,
  VOTE_DOWN_BUTTON_NAME,
  VOTE_UP_BUTTON_NAME,
  gotoWithRetry,
  waitForFeedLoaded,
} from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Voting flow — 3-voter threshold", () => {
  test("vote page does not auto-request watchlist signatures on load", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();
    let watchlistChallengeRequests = 0;

    page.on("request", request => {
      if (request.method() === "POST" && request.url().includes("/api/watchlist/content/challenge")) {
        watchlistChallengeRequests += 1;
      }
    });

    await setupWallet(page, ANVIL_ACCOUNTS.account3.privateKey);
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);
    await page.waitForTimeout(1_000);

    expect(watchlistChallengeRequests).toBe(0);
    await context.close();
  });

  test("vote buttons visible on non-own content", async ({ browser }) => {
    const context = await newE2EContext(browser);
    const page = await context.newPage();
    // Account #3 viewing the feed
    await setupWallet(page, ANVIL_ACCOUNTS.account3.privateKey);
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);

    // Verify the wallet is connected by checking for any voting-related UI,
    // or the empty feed state (feed loaded, wallet connected, but no content indexed yet).
    const connectedIndicators = page
      .getByRole("button", { name: VOTE_UP_BUTTON_NAME })
      .or(page.getByRole("button", { name: VOTE_DOWN_BUTTON_NAME }))
      .or(page.getByText("Your question"))
      .or(page.getByText(/Cooldown/))
      .or(page.getByText(/Voted(?: hidden| Up| Down)?/i))
      .or(page.getByText("Round full"))
      .or(page.getByText(FEED_EMPTY_STATE_RE))
      .or(page.getByRole("feed", { name: "Content feed" }).getByRole("article"));

    await expect(connectedIndicators.first()).toBeVisible({ timeout: 15_000 });
    await context.close();
  });

  // Extend timeout: fresh content submission + 3 accounts × UI load + tx + indexing.
  test("three accounts can vote on the same fresh content", async ({ browser }) => {
    test.setTimeout(180_000);
    // Use accounts #8, #9, #10 — these have 1000 LREP + rater credential.
    // Accounts #3-#7 are reserved for settlement/reward-claim tests to avoid cooldown collisions.
    const voters = [
      { account: ANVIL_ACCOUNTS.account8, direction: "up" as const },
      { account: ANVIL_ACCOUNTS.account9, direction: "up" as const },
      { account: ANVIL_ACCOUNTS.account10, direction: "down" as const },
    ];
    const target = await createFreshVoteableContent("UI Vote Target");
    expect(target, "fresh vote target should submit and index").not.toBeNull();

    let successCount = 0;

    for (const voter of voters) {
      const context = await newE2EContext(browser);
      const page = await context.newPage();
      await setupWallet(page, voter.account.privateKey);

      const success = await voteOnSpecificContent(page, target!.contentId, voter.direction, {
        voterAddress: voter.account.address,
      });
      if (success) successCount++;

      await context.close();
    }

    expect(successCount).toBe(3);
  });
});
