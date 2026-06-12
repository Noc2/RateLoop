import { type Page, expect, test } from "../fixtures/wallet";
import { continueToBountyStep, selectAskCategory, selectAskSubcategory } from "../helpers/ask-form";

async function fillRequiredQuestionFields(page: Page, contextUrl?: string): Promise<void> {
  await selectAskCategory(page);

  const uniqueId = Date.now();
  await page.getByPlaceholder("Write a subjective question voters can rate").fill(`Validation test ${uniqueId}`);

  await selectAskSubcategory(page);

  if (contextUrl !== undefined) {
    await page.locator("input[type='url']").first().fill(contextUrl);
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

    await expect(page.getByText("Add a website, image, or YouTube video before submitting.")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("private context hides the public context source field", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });

    const form = page.locator("form").first();
    const contextInput = form.getByPlaceholder("Paste a source link, or add media context below");
    await expect(contextInput).toBeVisible({ timeout: 5_000 });
    await contextInput.fill("https://example.com/private-toggle");

    const privateContextToggle = form.getByLabel("Private context");
    await privateContextToggle.check();

    await expect(form.getByText("Context Source")).toHaveCount(0);
    await expect(form.getByPlaceholder("Paste a source link, or add media context below")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Images" })).toBeVisible();
    await expect(form.getByRole("button", { name: "YouTube" })).toHaveCount(0);

    await privateContextToggle.uncheck();
    await expect(contextInput).toBeVisible({ timeout: 5_000 });
    await expect(contextInput).toHaveValue("");
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

    const urlInput = page.locator("input[type='url']").first();
    await urlInput.press("Tab");
    await continueToBountyStep(page);

    await expect(page.getByText(/Please enter a valid HTTPS URL/i)).toBeVisible({ timeout: 5_000 });
  });
});
