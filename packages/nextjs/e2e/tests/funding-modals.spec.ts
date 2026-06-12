import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";
import { expect, test } from "@playwright/test";

test.describe("Funding modals", () => {
  test("vote card opens USDC bounty and feedback bonus forms", async ({ browser }) => {
    test.setTimeout(120_000);

    const target = await createFreshVoteableContent("Funding Modal Target", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh funding target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setupWallet(page, ANVIL_ACCOUNTS.account5.privateKey);
      await gotoWithRetry(page, `/rate?content=${target!.contentId}`, { ensureWalletConnected: true });
      await waitForFeedLoaded(page);
      await expect(page.getByRole("heading", { name: target!.title }).first()).toBeVisible({ timeout: 30_000 });

      const addBountyButton = page.getByRole("button", { name: "Add bounty" }).first();
      await expect(addBountyButton).toBeVisible({ timeout: 15_000 });
      await addBountyButton.click();

      const bountyDialog = page.getByRole("dialog", { name: "Fund a bounty" });
      await expect(bountyDialog).toBeVisible({ timeout: 10_000 });
      await expect(bountyDialog.getByRole("heading", { name: target!.title })).toBeVisible();
      await expect(bountyDialog.getByLabel("Bounty amount")).toHaveValue("10");
      await expect(bountyDialog.getByLabel("Required voters")).not.toHaveValue("");
      await expect(bountyDialog.getByLabel("Settled rounds")).toHaveValue("2");
      await expect(bountyDialog.getByText(/USDC claims take at least/i)).toBeVisible();
      await expect(bountyDialog.getByRole("button", { name: "Fund bounty" })).toBeVisible();
      await bountyDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(bountyDialog).toBeHidden({ timeout: 10_000 });

      const addFeedbackBonusButton = page.getByRole("button", { name: "Add feedback bonus" }).first();
      await expect(addFeedbackBonusButton).toBeVisible({ timeout: 15_000 });
      await expect(addFeedbackBonusButton).toBeEnabled({ timeout: 30_000 });
      await addFeedbackBonusButton.click();

      const feedbackDialog = page.getByRole("dialog", { name: "Fund a Feedback Bonus" });
      await expect(feedbackDialog).toBeVisible({ timeout: 10_000 });
      await expect(feedbackDialog.getByRole("heading", { name: target!.title })).toBeVisible();
      await expect(feedbackDialog.getByRole("button", { name: "USDC" })).toHaveAttribute("aria-pressed", "true");
      await expect(feedbackDialog.getByLabel("Feedback Bonus amount")).toHaveValue("2");
      await expect(feedbackDialog.getByLabel("Awarder address")).toBeVisible();
      await expect(feedbackDialog.getByText(/Feedback Bonuses reward useful written feedback/i)).toBeVisible();
      await expect(feedbackDialog.getByRole("button", { name: "Fund Feedback Bonus" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
