import { expect, test } from "../fixtures/wallet";
import { waitForPonderIndexed } from "../helpers/admin-helpers";
import {
  continueToBountyStep,
  continueToFeedbackBonusStep,
  selectAskCategory,
  selectAskSubcategory,
  selectBountyRewardAsset,
} from "../helpers/ask-form";
import { getContentList } from "../helpers/ponder-api";
import { gotoWithRetry } from "../helpers/wait-helpers";
import type { Page } from "@playwright/test";

async function fillBasicQuestionFields(page: Page, uniqueId: number) {
  const urlInput = page.locator("input[type='url']").first();
  await expect(urlInput).toBeVisible({ timeout: 5_000 });
  await urlInput.fill(`https://example.com/e2etest-${uniqueId}`);

  const title = `E2E Test Title ${uniqueId}`;
  const titleInput = page.getByPlaceholder("Write a subjective question voters can rate");
  await expect(titleInput).toBeVisible({ timeout: 3_000 });
  await titleInput.fill(title);
  await page.getByPlaceholder("Add context voters should consider").fill(`E2E test description ${uniqueId}`);

  return title;
}

async function expectSuccessfulSubmission(page: Page) {
  const submitBtn = page.getByRole("button", { name: /^Submit/i });
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  const successDialog = page.getByRole("dialog", { name: /Question submitted/i });
  await successDialog.waitFor({ state: "visible", timeout: 60_000 });
  await expect(successDialog.getByText(/Question submitted/i)).toBeVisible();
  const shareOnXLink = successDialog.getByRole("link", { name: /Share on X/i });
  const viewContentLink = successDialog.getByRole("link", { name: /View Content/i });
  const submitAnotherButton = successDialog.getByRole("button", { name: /Submit Another/i });
  await expect(shareOnXLink).toHaveClass(/btn-outline/);
  await expect(viewContentLink).toBeVisible();
  await expect(viewContentLink).toHaveClass(/btn-outline/);
  await expect(viewContentLink).toHaveClass(/w-full/);
  await expect(viewContentLink).toHaveClass(/gap-2/);
  await expect(submitAnotherButton).toHaveClass(/btn-outline/);
  await expect(submitAnotherButton).toHaveClass(/w-full/);
  await expect(submitAnotherButton).toHaveClass(/gap-2/);
  await page.waitForTimeout(1_500);
  await expect(successDialog).toBeVisible();
}

test.describe("Ask page", () => {
  test("ask page shows form when connected with rater credential", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });
    // Account #2 has a rater credential — the form should render with "Submit Question" heading.
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });
  });

  test("ask page shows submissions overview tab", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/ask?tab=submissions", { ensureWalletConnected: true });

    await expect(page.getByTestId("ask-tab-submissions")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Your Submissions" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Submit Question" })).toHaveCount(0);
  });

  test("can ask a question", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });

    // Wait for the form to appear.
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    // 1. Select category — click the category dropdown trigger
    // Categories load from Ponder (or RPC fallback). If neither is ready yet,
    // the test fails instead of hiding a broken ask form behind a skip.
    await selectAskCategory(page);

    // 2. Enter a unique context URL. Images are upload-only, so the basic ask flow uses link context.
    const uniqueId = Date.now();
    await fillBasicQuestionFields(page, uniqueId);

    // 4. Select at least one subcategory tag
    await selectAskSubcategory(page);

    // 5. Continue to bounty details, skip the optional Feedback Bonus, then ask
    await continueToBountyStep(page);
    await expect(page.getByRole("heading", { name: "Bounty" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByPlaceholder("Write a subjective question voters can rate")).toBeHidden();
    await selectBountyRewardAsset(page, "lrep");
    await continueToFeedbackBonusStep(page);
    await expect(page.getByRole("heading", { name: "Feedback Bonus" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Submitting content")).toBeHidden();
    await expect(page.getByRole("button", { name: /^Submitting/i })).toBeHidden();
    await expect(page.getByRole("button", { name: /^No bonus$/i })).toHaveAttribute("aria-pressed", "true");

    // 6. Wait for the share modal to confirm success
    await expectSuccessfulSubmission(page);
  });

  test("can ask a question with the default USDC bounty and see it indexed", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    await selectAskCategory(page);

    const uniqueId = Date.now();
    const title = await fillBasicQuestionFields(page, uniqueId);

    await selectAskSubcategory(page);

    await continueToBountyStep(page);
    const usdcAssetButton = page.getByTestId("bounty-asset-usdc");
    await expect(usdcAssetButton).toBeVisible({ timeout: 5_000 });
    await expect(usdcAssetButton).toHaveAttribute("aria-pressed", "true");

    await continueToFeedbackBonusStep(page);
    await expect(page.getByRole("heading", { name: "Feedback Bonus" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /^No bonus$/i })).toHaveAttribute("aria-pressed", "true");

    await expectSuccessfulSubmission(page);

    const indexedAsUsdc = await waitForPonderIndexed(
      async () => {
        const { items } = await getContentList({ search: title, limit: 5 });
        const submittedQuestion = items.find(item => item.title === title);
        return (
          submittedQuestion?.rewardPoolSummary?.currency === "USDC" &&
          submittedQuestion.rewardPoolSummary.asset === 1 &&
          submittedQuestion.rewardPoolSummary.activeRewardPoolCount > 0 &&
          BigInt(submittedQuestion.rewardPoolSummary.currentRewardPoolAmount) > 0n
        );
      },
      90_000,
      2_000,
      "waitForSubmittedUsdcBounty",
    );
    expect(indexedAsUsdc, "submitted question should index with an active USDC bounty").toBe(true);
  });
});
