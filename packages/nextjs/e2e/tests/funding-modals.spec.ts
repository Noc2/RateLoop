import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Post-creation funding", () => {
  test("existing questions do not expose add bounty or add feedback bonus actions", async ({ browser }) => {
    test.setTimeout(120_000);

    const target = await createFreshVoteableContent("No Post Creation Funding", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh funding target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setupWallet(page, ANVIL_ACCOUNTS.account5.privateKey);
      await gotoWithRetry(page, `/rate?content=${target!.contentId}`, { ensureWalletConnected: true });
      await waitForFeedLoaded(page);
      await expect(page.getByRole("heading", { name: target!.title }).first()).toBeVisible({ timeout: 30_000 });

      await expect(page.getByRole("button", { name: "Add bounty" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add feedback bonus" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Fund a bounty" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Fund a Feedback Bonus" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
