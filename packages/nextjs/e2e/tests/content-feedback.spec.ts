import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { banConfidentialityIdentity, ensureHumanCredential, unbanConfidentialityIdentity } from "../helpers/confidentiality";
import { setupWallet } from "../helpers/wallet-session";
import { createFreshVoteableContent } from "../helpers/voteable-content";
import { voteOnSpecificContent } from "../helpers/vote-helpers";
import { expect, test } from "@playwright/test";

type FeedbackListResponse = {
  items: Array<{
    authorAddress: string;
    body: string;
    contentId: string;
    feedbackType: string;
    isPublic: boolean;
  }>;
  publicCount: number;
};

type FeedbackCountsResponse = {
  counts: Record<string, number>;
};

test.describe("Content feedback", () => {
  test("rater can publish feedback through the UI and counts update", async ({ browser }) => {
    test.setTimeout(180_000);

    const target = await createFreshVoteableContent("Feedback UI Target", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh feedback target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupWallet(page, ANVIL_ACCOUNTS.account4.privateKey);

    const voted = await voteOnSpecificContent(page, target!.contentId, "up", {
      indexedTimeoutMs: 90_000,
      voterAddress: ANVIL_ACCOUNTS.account4.address,
    });
    expect(voted, "rater should place a UI vote before publishing feedback").toBe(true);

    const feedbackBody = `Feedback e2e rationale ${Date.now()}`;
    const feedbackSection = page.getByRole("region", { name: "Question feedback" });
    await expect(feedbackSection).toBeVisible({ timeout: 30_000 });
    await feedbackSection.getByLabel("Feedback type").selectOption("concern");
    await feedbackSection.getByRole("textbox", { name: "Feedback" }).fill(feedbackBody);
    await feedbackSection.getByPlaceholder("Source URL, optional").fill("https://example.com/feedback-source");
    await expect(feedbackSection.getByRole("button", { name: "Add feedback" })).toBeEnabled({ timeout: 30_000 });
    await feedbackSection.getByRole("button", { name: "Add feedback" }).click();

    await expect(page.getByText("Feedback published on-chain")).toBeVisible({ timeout: 60_000 });
    await expect(feedbackSection.getByText(feedbackBody)).toBeVisible({ timeout: 30_000 });

    const listResponse = await page.request.get(`/api/feedback?contentId=${target!.contentId}`);
    expect(listResponse.ok(), await listResponse.text()).toBe(true);
    const list = (await listResponse.json()) as FeedbackListResponse;
    expect(list.publicCount).toBeGreaterThanOrEqual(1);
    expect(
      list.items.some(
        item =>
          item.body === feedbackBody &&
          item.feedbackType === "concern" &&
          item.authorAddress.toLowerCase() === ANVIL_ACCOUNTS.account4.address.toLowerCase() &&
          item.isPublic,
      ),
    ).toBe(true);

    const countsResponse = await page.request.get(`/api/feedback/counts?contentIds=${target!.contentId}`);
    expect(countsResponse.ok(), await countsResponse.text()).toBe(true);
    const counts = (await countsResponse.json()) as FeedbackCountsResponse;
    expect(counts.counts[target!.contentId]).toBeGreaterThanOrEqual(1);

    await context.close();
  });

  test("feedback challenge rejects a banned rater identity", async ({ browser, request }) => {
    test.setTimeout(120_000);

    const target = await createFreshVoteableContent("Feedback Ban Target", ANVIL_ACCOUNTS.account3.address);
    expect(target, "fresh feedback target should submit and index").not.toBeNull();

    const context = await newE2EContext(browser);
    const page = await context.newPage();

    try {
      await ensureHumanCredential(page, ANVIL_ACCOUNTS.account6);
      await unbanConfidentialityIdentity(ANVIL_ACCOUNTS.account6);
      await banConfidentialityIdentity(ANVIL_ACCOUNTS.account6, "E2E feedback identity ban");

      const response = await request.post("/api/feedback/challenge", {
        data: {
          address: ANVIL_ACCOUNTS.account6.address,
          contentId: target!.contentId,
          feedbackType: "vote_rationale",
          body: "This banned rater should not be able to save feedback.",
        },
      });

      expect(response.status()).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "Rater identity is not eligible to save feedback",
      });
    } finally {
      await unbanConfidentialityIdentity(ANVIL_ACCOUNTS.account6);
      await context.close();
    }
  });
});
