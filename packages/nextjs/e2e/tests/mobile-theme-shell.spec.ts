import { expect, test } from "@playwright/test";

const themeCases = [
  { colorScheme: "light", shellBackground: "rgb(255, 255, 255)" },
  { colorScheme: "dark", shellBackground: "rgb(10, 10, 10)" },
] as const;

for (const expected of themeCases) {
  test(`mobile navigation shares the ${expected.colorScheme} page background`, async ({ context, page }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: expected.colorScheme });
    await page.goto("/human/review", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected.colorScheme);
    await expect(page.getByRole("heading", { name: "Review work", exact: true })).toBeVisible();

    const menuDetails = page.locator("header details");
    const menu = menuDetails.locator("nav.dropdown-content");
    await menuDetails.locator("summary").click();
    await expect(menuDetails).toHaveAttribute("open", "");
    await expect(menu).toBeVisible();

    const backgrounds = {
      body: await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor),
      header: await page.locator("header").evaluate(element => getComputedStyle(element).backgroundColor),
      html: await page.locator("html").evaluate(element => getComputedStyle(element).backgroundColor),
      menu: await menu.evaluate(element => getComputedStyle(element).backgroundColor),
      shell: await page
        .locator("#main-content")
        .evaluate(element => getComputedStyle(element.parentElement!).backgroundColor),
    };

    expect(backgrounds).toEqual({
      body: expected.shellBackground,
      header: expected.shellBackground,
      html: expected.shellBackground,
      menu: expected.shellBackground,
      shell: expected.shellBackground,
    });
  });
}

test("mobile header controls do not overlap the brand at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const header = page.locator("header");
  const brand = header.getByRole("link", { name: "RateLoop", exact: true });
  const actions = header.locator(":scope > div > div").last();
  await expect(brand).toBeVisible();
  await expect(actions).toBeVisible();

  const [brandBox, actionsBox] = await Promise.all([brand.boundingBox(), actions.boundingBox()]);
  expect(brandBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  expect(actionsBox!.x + actionsBox!.width).toBeLessThanOrEqual(320);

  await expect(header.getByRole("search")).toBeVisible();
  await expect(header.locator("summary")).toBeVisible();
  await expect(header.locator(".rateloop-theme-toggle")).toBeVisible();
  await expect(header.getByRole("button", { name: /Language/u })).toBeVisible();
});
