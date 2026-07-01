import { type Page, expect } from "@playwright/test";

const SEEDED_CATEGORY_NAMES = ["Media", "General", "Products", "Software"];
const SEEDED_SUBCATEGORY_NAMES = ["Images", "YouTube", "Education", "Entertainment", "Photography", "Culture"];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function selectAskCategory(page: Page, categoryNames = SEEDED_CATEGORY_NAMES): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Submit Question" })).toBeVisible({ timeout: 15_000 });
    }

    const form = page.locator("form").first();
    const categoryTrigger = form.getByText("Select a category...");

    const triggerVisible = await categoryTrigger
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!triggerVisible) {
      continue;
    }

    await categoryTrigger.click();

    let clickedCategoryOption = false;
    for (const categoryName of categoryNames) {
      const option = form.getByRole("button", { name: new RegExp(`^${escapeRegExp(categoryName)}$`, "i") }).first();
      if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
        clickedCategoryOption = true;
        await option.click();
        if (
          await form
            .locator("label", { hasText: /^Select Categories/ })
            .isVisible({ timeout: 5_000 })
            .catch(() => false)
        ) {
          return;
        }
        break;
      }
    }

    if (clickedCategoryOption) {
      continue;
    }

    await expect(
      form.getByRole("button", { name: new RegExp(categoryNames.map(escapeRegExp).join("|"), "i") }).first(),
      `expected one of the seeded ask categories to be selectable: ${categoryNames.join(", ")}`,
    ).toBeVisible();
  }

  throw new Error("Ask categories did not become selectable.");
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
  const contextInput = form.getByPlaceholder("Paste a source link, or add media context below");
  await expect(trigger).toBeVisible({ timeout: 5_000 });

  await expect
    .poll(
      async () => {
        const contextVisible = await contextInput.isVisible({ timeout: 250 }).catch(() => false);
        if (contextVisible) return true;

        const isOpen = (await trigger.getAttribute("aria-expanded").catch(() => null)) === "true";
        if (isOpen) return false;

        await trigger.scrollIntoViewIfNeeded().catch(() => undefined);
        await trigger
          .click({ timeout: 1_000 })
          .catch(() => trigger.evaluate(element => (element as HTMLButtonElement).click()).catch(() => undefined));

        const expandedAfterClick = (await trigger.getAttribute("aria-expanded").catch(() => null)) === "true";
        if (!expandedAfterClick && !(await contextInput.isVisible({ timeout: 500 }).catch(() => false))) {
          await trigger.evaluate(element => (element as HTMLButtonElement).click()).catch(() => undefined);
        }

        return contextInput.isVisible({ timeout: 500 }).catch(() => false);
      },
      {
        intervals: [500, 1_000, 1_500],
        timeout: 30_000,
      },
    )
    .toBe(true);

  if (await contextInput.isVisible({ timeout: 500 }).catch(() => false)) {
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    return;
  }

  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(contextInput).toBeVisible({ timeout: 5_000 });
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
  const noBonusButton = page.getByRole("button", { name: /^No bonus$/i }).first();
  if (await noBonusButton.isVisible({ timeout: 500 }).catch(() => false)) {
    return;
  }

  const bountyStepButton = page.getByRole("button", { name: /^Go to bounty details$/i });
  if ((await bountyStepButton.getAttribute("aria-current").catch(() => null)) === "step") {
    return;
  }

  const continueButton = page.getByRole("button", { name: /^Continue$/i });
  await expect(continueButton).toBeVisible({ timeout: 5_000 });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
}

export async function expectNoFeedbackBonusSelectedIfVisible(page: Page): Promise<void> {
  const noBonusButton = page.getByRole("button", { name: /^No bonus$/i }).first();
  if (await noBonusButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await expect(noBonusButton).toHaveAttribute("aria-pressed", "true");
  }
}

export async function selectBountyRewardAsset(page: Page, asset: "lrep" | "usdc"): Promise<void> {
  const assetSelect = page.getByTestId("bounty-asset-select").or(page.locator("#submission-bounty-asset")).first();

  await expect(assetSelect).toBeVisible({ timeout: 5_000 });
  await assetSelect.selectOption(asset);
  await expect(assetSelect).toHaveValue(asset);
}
