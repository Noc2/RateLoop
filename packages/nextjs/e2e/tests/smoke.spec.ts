import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import {
  FEED_EMPTY_STATE_RE,
  getVisibleAuthConnectButton,
  gotoWithRetry,
  waitForFeedLoaded,
  waitForWalletConnected,
} from "../helpers/wait-helpers";
import { setupWallet } from "../helpers/wallet-session";
import { expect, test } from "@playwright/test";

test.describe("Smoke tests", () => {
  // E2E-1 (2026-05-21 testnet-readiness audit): pre-dismiss the BetaNoticeBanner so it
  // doesn't render above the landing-page heading. The banner reads localStorage; setting the
  // dismissed flag before any page navigation removes the possibility that the banner masks the
  // "Level Up Your Agent" heading on the navigate-back-to-landing test below.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("rateloop:beta-notice-dismissed", "true");
      } catch {
        // localStorage may be unavailable in some test contexts; the test still runs.
      }
    });
  });

  test("landing page loads without wallet", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/RateLoop/i);
  });

  test("wallet auto-connects via the localhost thirdweb test wallet", async ({ page }) => {
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForWalletConnected(page);
    await waitForFeedLoaded(page, 30_000);

    // After feed loads, check for wallet connection indicators.
    // If the feed is empty ("No questions have been asked yet"), the sort dropdown still renders,
    // proving the wallet connected and the page loaded (just no content in Ponder yet).
    const voteButton = page.getByRole("button", { name: /^Vote (up|down)\b/i });
    const votedStatus = page.getByText(/Voted(?: hidden| Up| Down)?/i);
    const ownContent = page.getByText("Your question");
    const emptyFeed = page.getByText(FEED_EMPTY_STATE_RE);
    const sortDropdown = page.locator("select").first();

    const connectedIndicator = voteButton.or(votedStatus).or(ownContent).or(emptyFeed).or(sortDropdown);
    // Use .first() to avoid strict mode violation when multiple indicators match
    await connectedIndicator.first().waitFor({ state: "visible", timeout: 15_000 });

    await expect(getVisibleAuthConnectButton(page)).toHaveCount(0);
  });

  test("brand link can reopen landing page without redirecting connected users back to rate", async ({ page }) => {
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForWalletConnected(page);
    await waitForFeedLoaded(page, 30_000);

    await page.locator('a[href="/?landing=1"]:visible').first().click();

    await expect(page.getByRole("heading", { name: /Level Up Your Agent/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/(?:\?landing=1)?$/);
  });

  test("navigation to ask page works", async ({ page }) => {
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });

    await expect(page).toHaveURL(/\/ask/);
    // Verify the ask page rendered (form or connect wallet prompt)
    const heading = page.getByRole("heading", { name: /^Submit$|Submit Question/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });
});
