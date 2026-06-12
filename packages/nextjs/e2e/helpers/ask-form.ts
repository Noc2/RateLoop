import { type Page, expect } from "@playwright/test";

const SEEDED_CATEGORY_NAMES = ["Media", "General", "Products", "Software"];
const SEEDED_SUBCATEGORY_NAMES = ["Images", "YouTube", "Education", "Entertainment", "Photography", "Culture"];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function selectAskCategory(page: Page, categoryNames = SEEDED_CATEGORY_NAMES): Promise<void> {
  const form = page.locator("form").first();
  const categoryTrigger = form.getByText("Select a category...");
  const noCategories = form.getByText("No categories available");

  await expect(categoryTrigger.or(noCategories)).toBeVisible({ timeout: 10_000 });
  await expect(categoryTrigger, "ask categories should load from Ponder or the RPC fallback").toBeVisible();

  await categoryTrigger.click();

  for (const categoryName of categoryNames) {
    const option = form.getByRole("button", { name: new RegExp(`^${escapeRegExp(categoryName)}$`, "i") }).first();
    if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await option.click();
      return;
    }
  }

  await expect(
    form.getByRole("button", { name: new RegExp(categoryNames.map(escapeRegExp).join("|"), "i") }).first(),
    `expected one of the seeded ask categories to be selectable: ${categoryNames.join(", ")}`,
  ).toBeVisible();
}

export async function selectAskSubcategory(page: Page, subcategoryNames = SEEDED_SUBCATEGORY_NAMES): Promise<void> {
  const form = page.locator("form").first();
  const subcategoryList = form
    .locator("label", { hasText: /^Select Categories/ })
    .locator("xpath=following-sibling::div[1]");

  await expect(subcategoryList).toBeVisible({ timeout: 5_000 });

  for (const subcategoryName of subcategoryNames) {
    const button = subcategoryList
      .getByRole("button", { name: new RegExp(`^${escapeRegExp(subcategoryName)}$`, "i") })
      .first();
    if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await button.click();
      await expect(button).toHaveClass(/pill-active/, { timeout: 2_000 });
      return;
    }
  }

  await expect(
    subcategoryList
      .getByRole("button", { name: new RegExp(subcategoryNames.map(escapeRegExp).join("|"), "i") })
      .first(),
    `expected one of the seeded ask subcategories to be selectable: ${subcategoryNames.join(", ")}`,
  ).toBeVisible();
}

export async function openAdvancedQuestionSettings(page: Page): Promise<void> {
  const form = page.locator("form").first();
  const trigger = form.getByRole("button", { name: /Advanced question settings/i });
  await expect(trigger).toBeVisible({ timeout: 5_000 });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

export async function fillAskContextSource(page: Page, contextUrl: string): Promise<void> {
  await openAdvancedQuestionSettings(page);

  const form = page.locator("form").first();
  const contextInput = form.getByPlaceholder("Paste a source link, or add media context below");
  await expect(contextInput).toBeVisible({ timeout: 5_000 });
  await contextInput.fill(contextUrl);
}

export async function continueToBountyStep(page: Page): Promise<void> {
  const continueButton = page.getByRole("button", { name: /^Continue to bounty$/i });
  await expect(continueButton).toBeVisible({ timeout: 5_000 });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

export async function continueToFeedbackBonusStep(page: Page): Promise<void> {
  const continueButton = page.getByRole("button", { name: /^Continue$/i });
  await expect(continueButton).toBeVisible({ timeout: 5_000 });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

export async function selectBountyRewardAsset(page: Page, asset: "lrep" | "usdc"): Promise<void> {
  const buttonLabel = asset === "lrep" ? "LREP" : "USDC";
  const assetButton = page
    .getByTestId(`bounty-asset-${asset}`)
    .or(page.getByRole("button", { name: new RegExp(`^${escapeRegExp(buttonLabel)}$`, "i") }))
    .first();

  await expect(assetButton).toBeVisible({ timeout: 5_000 });
  await assetButton.click();
  await expect(assetButton).toHaveAttribute("aria-pressed", "true");
}
