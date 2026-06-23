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
      const bountyDialog = page.getByRole("dialog", { name: "Fund a bounty" });
      await expect(async () => {
        if (!(await bountyDialog.isVisible().catch(() => false))) {
          await addBountyButton.click({ timeout: 5_000 });
        }
        await expect(bountyDialog).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
      await expect(bountyDialog.getByRole("heading", { name: target!.title })).toBeVisible();
      await expect(bountyDialog.getByLabel("Bounty amount")).toHaveValue("10");
      await expect(bountyDialog.getByRole("spinbutton", { name: "Required voters" })).not.toHaveValue("");
      await expect(bountyDialog.getByRole("spinbutton", { name: "Settled rounds" })).toHaveValue("2");
      await expect(bountyDialog.getByText(/USDC claims take at least/i)).toBeVisible();
      await expect(bountyDialog.getByRole("button", { name: "Fund bounty", exact: true })).toBeVisible();
      await bountyDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(bountyDialog).toBeHidden({ timeout: 10_000 });

      const addFeedbackBonusButton = page.getByRole("button", { name: "Add feedback bonus" }).first();
      await expect(addFeedbackBonusButton).toBeVisible({ timeout: 15_000 });
      await expect(addFeedbackBonusButton).toBeEnabled({ timeout: 30_000 });
      const feedbackDialog = page.getByRole("dialog", { name: "Fund a Feedback Bonus" });
      await expect(async () => {
        if (!(await feedbackDialog.isVisible().catch(() => false))) {
          await addFeedbackBonusButton.click({ timeout: 5_000 });
        }
        await expect(feedbackDialog).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
      await expect(feedbackDialog.getByRole("heading", { name: target!.title })).toBeVisible();
      await expect(feedbackDialog.getByRole("button", { name: "USDC", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(feedbackDialog.getByLabel("Feedback Bonus amount")).toHaveValue("2");
      await expect(feedbackDialog.getByLabel("Awarder address")).toBeVisible();
      await expect(feedbackDialog.getByText(/Feedback Bonuses reward useful written feedback/i)).toBeVisible();
      await expect(feedbackDialog.getByRole("button", { name: "Fund Feedback Bonus", exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("feedback panel opens the award Feedback Bonus form", async ({ browser }) => {
    test.setTimeout(120_000);

    const target = await createFreshVoteableContent("Award Feedback Modal Target", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh award modal target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();

    try {
      const feedbackBody = `Awardable feedback rationale ${Date.now()}`;
      const feedbackHash = `0x${"7".repeat(64)}`;
      const now = new Date().toISOString();
      const awardDeadline = Math.floor(Date.now() / 1000 + 7 * 24 * 60 * 60).toString();

      await page.route("**/api/feedback?**", async route => {
        const requestUrl = new URL(route.request().url());
        if (requestUrl.searchParams.get("contentId") !== target!.contentId) {
          await route.continue();
          return;
        }

        await route.fulfill({
          contentType: "application/json",
          json: {
            items: [
              {
                id: "feedback-award-e2e",
                contentId: target!.contentId,
                roundId: "1",
                chainId: 31337,
                authorAddress: ANVIL_ACCOUNTS.account4.address,
                feedbackType: "concern",
                feedbackTypeLabel: "Concern",
                body: feedbackBody,
                sourceUrl: null,
                feedbackHash,
                clientNonce: null,
                moderationStatus: "published",
                publicationTxHash: `0x${"8".repeat(64)}`,
                publishedAt: now,
                createdAt: now,
                updatedAt: now,
                isOwn: false,
                isPublic: true,
                feedbackBonusAwards: [],
              },
            ],
            count: 1,
            publicCount: 1,
            settlementComplete: true,
            openRoundId: null,
            awardableFeedbackBonusPools: [
              {
                id: "17",
                contentId: target!.contentId,
                roundId: "1",
                awarder: ANVIL_ACCOUNTS.account5.address,
                asset: 1,
                currency: "USDC",
                displayCurrency: "USD",
                fundedAmount: "3000000",
                remainingAmount: "3000000",
                awardedAmount: "0",
                feedbackClosesAt: awardDeadline,
                awardDeadline,
                frontendFeeBps: 300,
              },
            ],
          },
        });
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await setupWallet(page, ANVIL_ACCOUNTS.account5.privateKey);
      await gotoWithRetry(page, `/rate?content=${target!.contentId}`, { ensureWalletConnected: true });
      await waitForFeedLoaded(page);
      await expect(page.getByRole("heading", { name: target!.title }).first()).toBeVisible({ timeout: 30_000 });

      const feedbackSection = page.getByRole("region", { name: "Question feedback" });
      await expect(feedbackSection.getByText(feedbackBody)).toBeVisible({ timeout: 30_000 });
      await feedbackSection.getByRole("button", { name: "Award Feedback Bonus" }).click();

      const awardDialog = page.getByRole("dialog", { name: "Award Feedback Bonus" });
      await expect(awardDialog).toBeVisible({ timeout: 10_000 });
      await expect(awardDialog.getByText(feedbackBody)).toBeVisible();
      await expect(awardDialog.getByText(/Round 1 .*3 USDC left/i)).toBeVisible();
      await expect(awardDialog.getByLabel("Award amount")).toHaveValue("1");
      await expect(awardDialog.getByText("Recipient gets")).toBeVisible();
      await expect(awardDialog.getByText("Frontend fee")).toBeVisible();
      await expect(awardDialog.getByRole("button", { name: "Award Bonus" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
