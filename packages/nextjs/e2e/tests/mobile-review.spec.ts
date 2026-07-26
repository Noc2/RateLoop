import { expect, test } from "@playwright/test";

test("the human review shell stays inside a narrow mobile viewport", async ({ page }) => {
  await page.goto("/human");
  await expect(page.locator("body")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  await expect(page).toHaveScreenshot("human-review-mobile.png", {
    animations: "disabled",
    fullPage: true,
  });
});
