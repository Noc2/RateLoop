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

    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close navigation", exact: true })).toBeVisible();

    const backgrounds = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>("header");
      const menu = header?.querySelector<HTMLElement>('nav[aria-label="Primary"]');
      const shell = document.querySelector<HTMLElement>("#main-content")?.parentElement;
      if (!header || !menu || !shell) throw new Error("The mobile themed navigation did not render.");

      return {
        header: getComputedStyle(header).backgroundColor,
        menu: getComputedStyle(menu).backgroundColor,
        shell: getComputedStyle(shell).backgroundColor,
      };
    });

    expect(backgrounds).toEqual({
      header: expected.shellBackground,
      menu: expected.shellBackground,
      shell: expected.shellBackground,
    });
  });
}
