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
      header: await page.locator("header").evaluate(element => getComputedStyle(element).backgroundColor),
      menu: await menu.evaluate(element => getComputedStyle(element).backgroundColor),
      shell: await page
        .locator("#main-content")
        .evaluate(element => getComputedStyle(element.parentElement!).backgroundColor),
    };

    expect(backgrounds).toEqual({
      header: expected.shellBackground,
      menu: expected.shellBackground,
      shell: expected.shellBackground,
    });
  });
}
