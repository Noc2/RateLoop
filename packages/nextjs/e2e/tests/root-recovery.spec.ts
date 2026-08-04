import { expect, test } from "@playwright/test";

test("file-like missing routes render the root recovery shell", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  const response = await page.goto("/definitely-missing-root-recovery.xyz", { waitUntil: "networkidle" });

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator("[data-rateloop-rail]")).toBeVisible();
  await expect(page.locator("#main-content")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
