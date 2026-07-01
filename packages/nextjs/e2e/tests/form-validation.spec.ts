import { type Page, expect, test } from "../fixtures/wallet";
import {
  continueToBountyStep,
  fillAskContextSource,
  openAdvancedQuestionSettings,
  selectAskCategory,
  selectAskSubcategory,
} from "../helpers/ask-form";

async function fillRequiredQuestionFields(page: Page, contextUrl?: string): Promise<void> {
  await selectAskCategory(page);

  const uniqueId = Date.now();
  await page.getByPlaceholder("Write a subjective question voters can rate").fill(`Validation test ${uniqueId}`);

  await selectAskSubcategory(page);

  if (contextUrl !== undefined) {
    await fillAskContextSource(page, contextUrl);
  }
}

test.describe("Ask form validation", () => {
  test("submit shows a category validation error before submitting", async ({ connectedPage: page }) => {
    await page.goto("/ask");
    await page.waitForLoadState("domcontentloaded");

    // Wait for form to load
    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    await continueToBountyStep(page);

    await expect(page.getByText("Select a category before submitting.")).toBeVisible({ timeout: 5_000 });
  });

  test("submit requires public context media before submitting", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    await fillRequiredQuestionFields(page);

    await continueToBountyStep(page);

    await expect(
      page.getByText("Add a context source in advanced settings or upload at least one image before submitting."),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("private context hides the public context source field", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    const form = page.locator("form").first();
    await expect(form.getByRole("button", { name: /Advanced question settings/i })).toBeVisible({ timeout: 5_000 });
    await expect(form.getByText("No audience targeting selected.")).toHaveCount(0);

    await openAdvancedQuestionSettings(page);
    const contextInput = form.getByPlaceholder("Paste a source link, or add media context below");
    await expect(contextInput).toBeVisible({ timeout: 5_000 });
    await contextInput.fill("https://example.com/private-toggle");

    const privateContextToggle = form.getByRole("checkbox", { name: "Private context" });
    await privateContextToggle.click();

    const removalDialog = page.getByRole("alertdialog", {
      name: "Switching to private context removes public context",
    });
    await expect(removalDialog).toBeVisible({ timeout: 5_000 });
    await expect(removalDialog.getByText("https://example.com/private-toggle")).toBeVisible();
    await removalDialog.getByRole("button", { name: "Keep public context" }).click();
    await expect(privateContextToggle).not.toBeChecked();
    await expect(contextInput).toHaveValue("https://example.com/private-toggle");

    await privateContextToggle.click();
    await expect(removalDialog).toBeVisible({ timeout: 5_000 });
    await removalDialog.getByRole("button", { name: "Switch to private and remove" }).click();

    await expect(form.getByPlaceholder("Paste a source link, or add media context below")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "YouTube" })).toHaveCount(0);
    await expect(form.getByText("Public context was removed for private mode.")).toBeVisible();

    await privateContextToggle.uncheck();
    await expect(contextInput).toBeVisible({ timeout: 5_000 });
    await expect(contextInput).toHaveValue("https://example.com/private-toggle");
  });

  test("category dropdown shows options", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    // Click category dropdown
    const form = page.locator("form").first();
    const categoryBtn = form.getByText("Select a category...");
    await expect(categoryBtn, "ask categories should load before the dropdown options are checked").toBeVisible({
      timeout: 10_000,
    });
    await categoryBtn.click();

    const searchInput = page.getByPlaceholder("Search categories...");
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    // Just verify that at least 3 category buttons are visible in the dropdown.
    const options = form
      .locator(".absolute")
      .locator("button")
      .filter({ hasText: /Products|Media|General|Software/ });
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThanOrEqual(3);

    await page.keyboard.press("Escape");
  });

  test("invalid URL shows validation feedback", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    await fillRequiredQuestionFields(page, "not-a-valid-url");

    const urlInput = page.getByPlaceholder("Paste a source link, or add media context below");
    await urlInput.press("Tab");
    await continueToBountyStep(page);

    await expect(page.getByText(/Please enter a valid HTTPS URL/i)).toBeVisible({ timeout: 5_000 });
  });
});
