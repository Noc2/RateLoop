import { expect, test } from "../fixtures/wallet";
import { FEED_EMPTY_STATE_RE, waitForFeedLoaded } from "../helpers/wait-helpers";

test.describe("Tablet viewport", () => {
  test("sidebar hidden on tablet width (xl breakpoint)", async ({ connectedPage: page }) => {
    await page.goto("/rate");
    await waitForFeedLoaded(page);

    // Sidebar uses xl:flex (1280px+). iPad Mini (768px) is below xl, so sidebar is hidden
    // and the hamburger menu is used instead.
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeHidden({ timeout: 5_000 });

    const hamburger = page.getByLabel("Open menu");
    await expect(hamburger).toBeVisible({ timeout: 5_000 });
  });

  test("vote page layout on tablet", async ({ connectedPage: page }) => {
    await page.goto("/rate");
    await waitForFeedLoaded(page);

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    // The snap feed renders content cards when seeded content exists, otherwise
    // it keeps the surface stable and shows a scoped empty state.
    const contentCard = page.getByTestId("vote-content-card-shell").first();
    const emptyState = page.getByText(FEED_EMPTY_STATE_RE);
    await expect(contentCard.or(emptyState).first()).toBeVisible({ timeout: 10_000 });
  });

  test("collapsing vote chrome does not aria-hide a focused pill", async ({ connectedPage: page }) => {
    const blockedAriaHiddenMessages: string[] = [];
    page.on("console", message => {
      const text = message.text();
      if (text.includes("Blocked aria-hidden")) {
        blockedAriaHiddenMessages.push(text);
      }
    });

    await page.goto("/rate");
    await waitForFeedLoaded(page);

    const voteTopChrome = page.locator('[data-vote-mobile-top-chrome="true"]');
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const focusedPill = voteTopChrome.getByRole("button").first();
    await focusedPill.focus();
    await expect(focusedPill).toBeFocused();
    await expect(voteTopChrome).not.toHaveAttribute("inert");

    await page.evaluate(
      async ({ targetScrollTop, stepSize }) => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        if (!explicitScrollSource) {
          window.scrollTo(0, targetScrollTop);
          return;
        }

        const previousScrollBehavior = explicitScrollSource.style.scrollBehavior;
        const direction = targetScrollTop >= explicitScrollSource.scrollTop ? 1 : -1;
        const step = Math.max(1, Math.abs(stepSize));
        let remainingSteps = 400;

        explicitScrollSource.style.scrollBehavior = "auto";

        while (remainingSteps > 0 && Math.abs(targetScrollTop - explicitScrollSource.scrollTop) > 0.5) {
          explicitScrollSource.scrollTop =
            direction > 0
              ? Math.min(explicitScrollSource.scrollTop + step, targetScrollTop)
              : Math.max(explicitScrollSource.scrollTop - step, targetScrollTop);
          explicitScrollSource.dispatchEvent(new Event("scroll", { bubbles: true }));
          remainingSteps -= 1;

          await new Promise<void>(resolve => {
            window.requestAnimationFrame(() => resolve());
          });
        }

        explicitScrollSource.style.scrollBehavior = previousScrollBehavior;
      },
      { targetScrollTop: 900, stepSize: 8 },
    );

    await expect(voteTopChrome).toHaveAttribute("data-visible", "false");
    await expect(voteTopChrome).toHaveAttribute("inert", "");
    await expect(voteTopChrome).not.toHaveAttribute("aria-hidden");

    const collapsedChromeStillHasFocus = await page.evaluate(() => {
      const topChrome = document.querySelector<HTMLElement>('[data-vote-mobile-top-chrome="true"]');
      return topChrome?.contains(document.activeElement) ?? false;
    });
    expect(collapsedChromeStillHasFocus).toBe(false);
    expect(blockedAriaHiddenMessages).toEqual([]);
  });

  test("no horizontal overflow on key pages", async ({ connectedPage: page }) => {
    const pages = ["/rate", "/ask", "/governance", "/docs"];

    for (const path of pages) {
      await page.goto(path, { waitUntil: "domcontentloaded" });

      const main = page.locator("main");
      await expect(main).toBeVisible({ timeout: 10_000 });

      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasOverflow, `Page ${path} should not have horizontal overflow on tablet`).toBe(false);
    }
  });
});
