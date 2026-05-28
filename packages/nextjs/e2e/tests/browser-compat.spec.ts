import { expect, test } from "../fixtures/wallet";
import { expectNoHorizontalOverflow, expectNoNextErrorOverlay } from "../helpers/layout";
import {
  FEED_EMPTY_STATE_RE,
  VOTE_DOWN_BUTTON_NAME,
  VOTE_UP_BUTTON_NAME,
  waitForFeedLoaded,
} from "../helpers/wait-helpers";

const PUBLIC_ROUTES = [
  { path: "/", content: /Level Up Your\s+Agent|Rate|Vote/i },
  { path: "/docs", content: /Introduction/i },
  { path: "/legal", content: /^Legal$/i },
  { path: "/legal/terms", content: /Terms of Service/i },
];

test.describe("Browser compatibility smoke", () => {
  for (const { path, content } of PUBLIC_ROUTES) {
    test(`${path} renders primary content`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expectNoNextErrorOverlay(page);

      const main = page.locator("main");
      await expect(main, `${path} should expose visible main content`).toBeVisible({ timeout: 15_000 });
      await expect(
        main
          .getByText(content)
          .or(main.getByRole("heading", { name: content }))
          .first(),
      ).toBeVisible({
        timeout: 15_000,
      });
      await expectNoHorizontalOverflow(page, `${path} browser compat`);
    });
  }

  test("/rate loads the feed in a connected browser session", async ({ connectedPage: page }) => {
    await page.goto("/rate", { waitUntil: "domcontentloaded" });
    await expectNoNextErrorOverlay(page);
    await waitForFeedLoaded(page, 30_000);

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .getByRole("button", { name: VOTE_UP_BUTTON_NAME })
        .or(page.getByRole("button", { name: VOTE_DOWN_BUTTON_NAME }))
        .or(page.getByText(FEED_EMPTY_STATE_RE))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, "/rate browser compat");
  });

  test("/ask keeps the URL field usable in a connected browser session", async ({ connectedPage: page }) => {
    await page.goto("/ask", { waitUntil: "domcontentloaded" });
    await expectNoNextErrorOverlay(page);

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    const urlInput = page.getByPlaceholder(/paste/i).or(page.getByRole("textbox").first()).first();
    await expect(urlInput).toBeVisible({ timeout: 15_000 });
    await urlInput.focus();
    await expect(urlInput).toBeFocused();
    await expectNoHorizontalOverflow(page, "/ask browser compat");
  });
});
