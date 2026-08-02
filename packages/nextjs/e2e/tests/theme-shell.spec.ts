import { expect, test } from "@playwright/test";

const themeCases = [
  {
    activeBackground: "rgb(23, 23, 23)",
    activeText: "rgb(255, 255, 255)",
    cardBackground: "rgb(247, 247, 245)",
    colorScheme: "light",
    idleBackground: "rgb(247, 247, 245)",
    shellBackground: "rgb(255, 255, 255)",
  },
  {
    activeBackground: "rgb(245, 245, 245)",
    activeText: "rgb(5, 5, 5)",
    cardBackground: "rgb(18, 18, 18)",
    colorScheme: "dark",
    idleBackground: "rgba(18, 18, 18, 0.96)",
    shellBackground: "rgb(10, 10, 10)",
  },
] as const;

for (const expected of themeCases) {
  test(`initial ${expected.colorScheme} theme keeps the page controls in sync and the desktop rail dark`, async ({
    context,
    page,
  }) => {
    const hydrationErrors: string[] = [];
    page.on("console", message => {
      if (message.type() === "error" && /hydration|did not match|validateDOMNesting/iu.test(message.text())) {
        hydrationErrors.push(message.text());
      }
    });
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: expected.colorScheme });

    const response = await page.goto("/de/human/review", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected.colorScheme);

    const colors = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("#main-content");
      const shell = main?.parentElement;
      const activeTab = main?.querySelector<HTMLElement>('nav a[aria-current="page"]');
      const inactiveTab = main?.querySelector<HTMLElement>('nav a:not([aria-current="page"])');
      const rail = document.querySelector<HTMLElement>("[data-rateloop-rail]");
      if (!shell || !activeTab || !inactiveTab || !rail) {
        throw new Error("The themed shell navigation did not render.");
      }

      return {
        activeBackground: getComputedStyle(activeTab).backgroundColor,
        activeText: getComputedStyle(activeTab).color,
        idleBackground: getComputedStyle(inactiveTab).backgroundColor,
        railBackground: getComputedStyle(rail).backgroundColor,
        shellBackground: getComputedStyle(shell).backgroundColor,
      };
    });

    expect(colors).toEqual({
      activeBackground: expected.activeBackground,
      activeText: expected.activeText,
      idleBackground: expected.idleBackground,
      railBackground: "rgb(5, 5, 5)",
      shellBackground: expected.shellBackground,
    });
    expect(hydrationErrors).toEqual([]);

    await page.goto("/agents/overview", { waitUntil: "domcontentloaded" });
    const card = page.locator('section.surface-card[aria-labelledby="agents-sign-in-title"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveCSS("background-color", expected.cardBackground);
    await expect(card).not.toHaveCSS("background-color", expected.shellBackground);
  });
}

test("dark theme is parser-applied before Next.js framework chunks run", async ({ context, page }) => {
  await context.clearCookies();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/_next/**", route =>
    route.request().resourceType() === "script" ? route.abort("blockedbyclient") : route.continue(),
  );

  const response = await page.goto("/de/human/review", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("an older account preference response cannot overwrite a newer theme choice", async ({ context, page }) => {
  let releaseProfile!: () => void;
  let markProfileRequested!: () => void;
  const profileGate = new Promise<void>(resolve => (releaseProfile = resolve));
  const profileRequested = new Promise<void>(resolve => (markProfileRequested = resolve));
  const patches: unknown[] = [];

  await page.route("**/api/auth/session", route =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true }) }),
  );
  await page.route("**/api/account/profile", async route => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON());
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    markProfileRequested();
    await profileGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ preferredLocale: "de", preferredTheme: "dark" }),
    });
  });

  await context.clearCookies();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/de/human/review", { waitUntil: "domcontentloaded" });
  await profileRequested;
  await page.locator(".rateloop-theme-toggle:visible").first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const profileResponse = page.waitForResponse(
    response => response.url().endsWith("/api/account/profile") && response.request().method() === "GET",
  );
  releaseProfile();
  await profileResponse;
  await page.waitForTimeout(100);

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(patches).toContainEqual({ preferredTheme: "light" });
});
