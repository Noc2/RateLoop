import { expect, test } from "../fixtures/wallet";
import { openAdvancedQuestionSettings } from "../helpers/ask-form";
import { waitForFeedLoaded } from "../helpers/wait-helpers";

test.describe("Android mobile viewport", () => {
  test("uses mobile navigation on the vote page", async ({ connectedPage: page }) => {
    await page.goto("/rate");
    await waitForFeedLoaded(page);

    const sidebar = page.locator("aside.fixed").filter({ hasText: "Level Up Your Agent" });
    await expect(sidebar).toBeHidden({ timeout: 5_000 });

    const hamburger = page.getByLabel("Open menu");
    await expect(hamburger).toBeVisible({ timeout: 5_000 });

    await hamburger.click();
    const dropdown = page.locator(".dropdown-content");
    await expect(dropdown.getByRole("link", { name: /Discover/i })).toBeVisible({ timeout: 5_000 });
    await expect(dropdown.getByRole("link", { name: /Submit/i })).toBeVisible({ timeout: 5_000 });
  });

  test("renders the vote feed without horizontal overflow", async ({ connectedPage: page }) => {
    await page.goto("/rate");
    await waitForFeedLoaded(page);

    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("vote-content-card-shell").first()).toBeVisible({ timeout: 10_000 });

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("keeps the ask form usable", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    await openAdvancedQuestionSettings(page);
    const contextInput = page.getByPlaceholder("Paste a source link, or add media context below");
    await expect(contextInput).toBeVisible({ timeout: 10_000 });
    await contextInput.focus();
    await expect(contextInput).toBeFocused();
  });
});
