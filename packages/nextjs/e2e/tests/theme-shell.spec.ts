import { expect, test } from "@playwright/test";

const themeCases = [
  {
    activeBackground: "rgb(23, 23, 23)",
    activeText: "rgb(255, 255, 255)",
    colorScheme: "light",
    shellBackground: "rgb(255, 255, 255)",
  },
  {
    activeBackground: "rgb(245, 245, 245)",
    activeText: "rgb(5, 5, 5)",
    colorScheme: "dark",
    shellBackground: "rgb(10, 10, 10)",
  },
] as const;

for (const expected of themeCases) {
  test(`initial ${expected.colorScheme} theme keeps the shell and human navbar in sync`, async ({ context, page }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: expected.colorScheme });

    const response = await page.goto("/de/human/review", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected.colorScheme);

    const colors = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("#main-content");
      const shell = main?.parentElement;
      const activeTab = main?.querySelector<HTMLElement>('nav a[aria-current="page"]');
      const rail = document.querySelector<HTMLElement>("[data-rateloop-rail]");
      if (!shell || !activeTab || !rail) throw new Error("The themed shell navigation did not render.");

      return {
        activeBackground: getComputedStyle(activeTab).backgroundColor,
        activeText: getComputedStyle(activeTab).color,
        railBackground: getComputedStyle(rail).backgroundColor,
        shellBackground: getComputedStyle(shell).backgroundColor,
      };
    });

    expect(colors).toEqual({
      activeBackground: expected.activeBackground,
      activeText: expected.activeText,
      railBackground: "rgb(5, 5, 5)",
      shellBackground: expected.shellBackground,
    });
  });
}
