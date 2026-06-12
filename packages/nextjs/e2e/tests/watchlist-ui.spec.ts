import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Watchlist UI", () => {
  test("adds and removes a watched question from the vote card", async ({ browser }) => {
    test.setTimeout(120_000);

    const target = await createFreshVoteableContent("Watchlist UI Target", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh watchlist target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupWallet(page, ANVIL_ACCOUNTS.account5.privateKey);
    await gotoWithRetry(page, `/rate?content=${target!.contentId}`, { ensureWalletConnected: true });
    await waitForFeedLoaded(page);
    await expect(page.getByRole("heading", { name: target!.title }).first()).toBeVisible({ timeout: 30_000 });

    const watchButton = page.getByRole("button", { name: "Watch" }).first();
    await expect(watchButton).toBeVisible({ timeout: 15_000 });
    await watchButton.click();
    await expect(page.getByText("Added to your watchlist")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Watching" }).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Watching" }).first().click();
    await expect(page.getByText("Removed from your watchlist")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Watch" }).first()).toBeVisible({ timeout: 30_000 });

    await context.close();
  });
});
