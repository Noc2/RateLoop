import { type Page, expect, test } from "../fixtures/wallet";
import { openAdvancedQuestionSettings } from "../helpers/ask-form";
import { expectNoHorizontalOverflow, expectNoNextErrorOverlay } from "../helpers/layout";
import {
  FEED_EMPTY_STATE_RE,
  VOTE_DOWN_BUTTON_NAME,
  VOTE_UP_BUTTON_NAME,
  findVoteableContent,
  gotoWithRetry,
  waitForFeedLoaded,
} from "../helpers/wait-helpers";

const VIEWPORTS = [
  { name: "small phone", width: 360, height: 640 },
  { name: "modern phone", width: 390, height: 844 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "dense laptop", width: 1280, height: 800 },
  { name: "common laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
];

const ROUTES = ["/", "/rate", "/ask", "/governance", "/docs", "/legal"];
const WALLET_ROUTES = new Set(["/rate", "/ask", "/governance"]);
const BETA_NOTICE_DISMISSED_STORAGE_KEY = "rateloop:beta-notice-dismissed";
const E2E_OPEN_STAKE_SELECTOR_EVENT = "rateloop:e2e-open-stake-selector";

async function dismissBetaNotice(page: Page): Promise<void> {
  await page.addInitScript(key => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // localStorage may be unavailable in some test contexts; the test still runs.
    }
  }, BETA_NOTICE_DISMISSED_STORAGE_KEY);

  await page.evaluate(key => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // localStorage may be unavailable in some test contexts; the test still runs.
    }
  }, BETA_NOTICE_DISMISSED_STORAGE_KEY);
}

async function expectNavigationForViewport(page: Page, width: number): Promise<void> {
  const sidebar = page.locator("aside").first();
  const hamburger = page.getByLabel("Open menu").first();

  if (width >= 1280) {
    await expect(sidebar, "Desktop sidebar should be visible at xl widths").toBeVisible({ timeout: 5_000 });
    await expect(hamburger, "Mobile hamburger should be hidden at xl widths").toBeHidden({ timeout: 5_000 });
    return;
  }

  await expect(sidebar, "Desktop sidebar should be hidden below xl widths").toBeHidden({ timeout: 5_000 });
  await expect(hamburger, "Mobile hamburger should be visible below xl widths").toBeVisible({ timeout: 5_000 });
}

async function expectRouteControls(page: Page, path: string, width: number): Promise<void> {
  const main = page.locator("main");

  if (path === "/rate") {
    await waitForFeedLoaded(page, 30_000);
    await expectNavigationForViewport(page, width);
    await expect(
      page
        .getByRole("button", { name: VOTE_UP_BUTTON_NAME })
        .or(page.getByRole("button", { name: VOTE_DOWN_BUTTON_NAME }))
        .or(page.getByText(FEED_EMPTY_STATE_RE))
        .or(page.getByRole("feed", { name: "Content feed" }).getByRole("article"))
        .first(),
      "Vote route should keep its primary feed state visible",
    ).toBeVisible({ timeout: 15_000 });
    return;
  }

  if (path === "/") {
    const heroHeading = main.getByRole("heading", { name: /Level Up Your\s+Agent/i }).first();
    await expectNavigationForViewport(page, width);
    await expect(heroHeading).toBeVisible({
      timeout: 15_000,
    });
    if (width <= 390) {
      const [headingBox, viewportHeight] = await Promise.all([
        heroHeading.boundingBox(),
        page.evaluate(() => window.innerHeight),
      ]);
      expect(headingBox, "Landing hero headline should be measurable in the initial mobile viewport").not.toBeNull();
      expect(
        Math.ceil((headingBox?.y ?? Number.POSITIVE_INFINITY) + (headingBox?.height ?? 0)),
        "Landing hero headline should fit in the initial mobile viewport",
      ).toBeLessThanOrEqual(viewportHeight);
    }
    return;
  }

  if (path === "/ask") {
    await openAdvancedQuestionSettings(page);
    const contextInput = main.getByPlaceholder("Paste a source link, or add media context below");
    await expect(contextInput, "Ask context source input should stay usable").toBeVisible({ timeout: 15_000 });
    await contextInput.focus();
    await expect(contextInput).toBeFocused();
    return;
  }

  if (path === "/governance") {
    await expect(
      main
        .getByRole("button", { name: /Profile|Leaderboard|Governance|rater credential/ })
        .or(main.getByText(/Voting performance|Staked LREP|Checking rater credential/i))
        .first(),
      "Governance claim surface should stay visible",
    ).toBeVisible({ timeout: 15_000 });
    return;
  }

  if (path === "/docs") {
    await expect(main.getByRole("heading", { name: /RateLoop\s+Introduction|Introduction/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    return;
  }

  if (path === "/legal") {
    await expect(main.getByRole("heading", { name: /^Legal$/i }).first()).toBeVisible({ timeout: 15_000 });
  }
}

test.describe("Responsive layout", () => {
  test.beforeEach(async ({ connectedPage: page }) => {
    await dismissBetaNotice(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`key routes stay usable without horizontal overflow at ${viewport.name}`, async ({ connectedPage: page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const path of ROUTES) {
        const needsWallet = WALLET_ROUTES.has(path);
        await gotoWithRetry(page, path, {
          ensureWalletConnected: needsWallet,
          skipInjectedWalletConnectionCheck: !needsWallet,
          timeout: 45_000,
        });
        await expectNoNextErrorOverlay(page);

        const main = page.locator("main");
        await expect(main, `${path} should keep visible main content at ${viewport.name}`).toBeVisible({
          timeout: 15_000,
        });
        await expectRouteControls(page, path, viewport.width);
        await expectNoHorizontalOverflow(page, `${path} at ${viewport.name} (${viewport.width}x${viewport.height})`);
      }
    });
  }

  test("stake selector dialog fits inside a phone viewport", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);
    expect(await findVoteableContent(page)).toBe(true);

    await page.evaluate(eventName => window.dispatchEvent(new Event(eventName)), E2E_OPEN_STAKE_SELECTOR_EVENT);

    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const box = await dialog.boundingBox();
    expect(box, "Stake selector dialog should have a layout box").not.toBeNull();
    if (!box) return;

    const viewport = page.viewportSize();
    expect(viewport, "Viewport should be available").not.toBeNull();
    if (!viewport) return;

    expect(box.x, "Dialog should not overflow left").toBeGreaterThanOrEqual(-1);
    expect(box.y, "Dialog should not overflow top").toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, "Dialog should not overflow right").toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, "Dialog should not overflow bottom").toBeLessThanOrEqual(viewport.height + 1);
    await expectNoHorizontalOverflow(page, "Stake selector dialog at phone width");

    await page.keyboard.press("Escape");
  });

  test("small yes/no vote buttons stay circular below xl", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/rate", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    const buttonMetrics = await page.evaluate(() => {
      const fixture = document.createElement("div");
      fixture.setAttribute("data-testid", "vote-button-shape-fixture");
      fixture.style.cssText = "position:absolute;left:-9999px;top:0;display:flex;gap:8px;";
      fixture.innerHTML = `
        <button class="vote-btn vote-btn-sm vote-yes" aria-label="Vote thumbs up"><span class="vote-bg"></span></button>
        <button class="vote-btn vote-btn-sm vote-no" aria-label="Vote thumbs down"><span class="vote-bg"></span></button>
      `;
      document.body.appendChild(fixture);

      return Array.from(fixture.querySelectorAll<HTMLElement>("button")).map(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return {
          borderRadius: style.borderRadius,
          height: rect.height,
          width: rect.width,
        };
      });
    });

    for (const metric of buttonMetrics) {
      expect(Math.abs(metric.width - metric.height)).toBeLessThanOrEqual(1);
      expect(parseFloat(metric.borderRadius)).toBeGreaterThanOrEqual(metric.height / 2 - 1);
    }
  });

  test("narrow desktop vote layout scrolls while the mobile dock is visible", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoWithRetry(page, "/rate?content=1", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    await expect(page.getByTestId("vote-mobile-dock"), "Mobile vote dock should be visible below xl").toBeVisible({
      timeout: 5_000,
    });

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="vote-mobile-scroll-container"]');
      if (!scroller) return null;

      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      const rect = scroller.getBoundingClientRect();

      return {
        canScroll: scroller.scrollHeight > scroller.clientHeight + 48,
        clientHeight: scroller.clientHeight,
        height: rect.height,
        rootLocked: document.documentElement.classList.contains("rateloop-vote-root-scroll-lock"),
        scrollHeight: scroller.scrollHeight,
        wheelX: rect.left + rect.width / 2,
        wheelY: Math.min(Math.max(rect.top + 80, 80), rect.bottom - 80),
      };
    });

    expect(metrics, "Vote feed should expose the mobile scroll container").not.toBeNull();
    if (!metrics) return;

    expect(metrics.rootLocked, "Narrow desktop vote layout should reproduce the root-locked mobile shell").toBe(true);
    expect(metrics.height, "Mobile-shell feed should receive a measurable scroll viewport").toBeGreaterThan(320);
    expect(
      metrics.canScroll,
      `Mobile-shell feed should be scrollable. ${JSON.stringify({
        clientHeight: metrics.clientHeight,
        scrollHeight: metrics.scrollHeight,
      })}`,
    ).toBe(true);

    await page.mouse.move(metrics.wheelX, metrics.wheelY);
    await page.mouse.wheel(0, 420);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            return document.querySelector<HTMLElement>('[data-testid="vote-mobile-scroll-container"]')?.scrollTop ?? 0;
          }),
        { timeout: 3_000 },
      )
      .toBeGreaterThan(0);
  });

  test("desktop vote side padding remains inside the feed scroll hit area", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="vote-desktop-scroll-container"]');
      const frame = document.querySelector<HTMLElement>('[data-testid="vote-desktop-scroll-frame"]');
      const surface = document.querySelector<HTMLElement>('[data-testid="vote-feed-surface"]');

      if (!scroller || !frame) return null;
      if (!surface) return { hasSurface: false as const };

      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));

      const frameRect = frame.getBoundingClientRect();
      const surfaceRect = surface.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const surfaceStyle = getComputedStyle(surface);
      const leftPadding = surfaceRect.left - frameRect.left;

      return {
        hasSurface: true as const,
        canScroll: scroller.scrollHeight > scroller.clientHeight + 48,
        leftPadding,
        surfaceBorderTopLeftRadius: surfaceStyle.borderTopLeftRadius,
        surfaceOverflowX: surfaceStyle.overflowX,
        surfaceOverflowY: surfaceStyle.overflowY,
        wheelX: frameRect.left + leftPadding / 2,
        wheelY: Math.min(Math.max(surfaceRect.top + 48, scrollerRect.top + 48), scrollerRect.bottom - 48),
      };
    });

    expect(metrics, "Vote desktop feed should expose the scroll frame and surface").not.toBeNull();
    if (!metrics) return;

    expect(metrics.hasSurface, "Vote feed should render a card surface to verify side padding").toBe(true);
    if (!metrics.hasSurface) return;

    expect(metrics.leftPadding, "Desktop feed should keep visible side padding around the card").toBeGreaterThanOrEqual(
      12,
    );
    expect(
      metrics.surfaceBorderTopLeftRadius,
      "Desktop feed surface should not clip the first content headline with its own radius",
    ).toBe("0px");
    expect(
      metrics.surfaceOverflowX,
      "Desktop feed surface should not clip the first content headline horizontally",
    ).toBe("visible");
    expect(metrics.surfaceOverflowY, "Desktop feed surface should not clip the first content headline vertically").toBe(
      "visible",
    );

    if (!metrics.canScroll) return;

    await page.mouse.move(metrics.wheelX, metrics.wheelY);
    await page.mouse.wheel(0, 420);

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            return document.querySelector<HTMLElement>('[data-testid="vote-desktop-scroll-container"]')?.scrollTop ?? 0;
          }),
        { timeout: 3_000 },
      )
      .toBeGreaterThan(0);
  });
});
