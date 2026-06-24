import { expect, test } from "../fixtures/wallet";
import { openAdvancedQuestionSettings } from "../helpers/ask-form";
import { findVoteableContent, gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";
import type { Page } from "@playwright/test";

// Device profile comes from Playwright project config (iPhone / Android).
// No manual setViewportSize() needed — the project device descriptor handles
// viewport, UA, touch emulation, and browser engine.

const BETA_NOTICE_DISMISSED_STORAGE_KEY = "rateloop:beta-notice-dismissed";
const E2E_OPEN_STAKE_SELECTOR_EVENT = "rateloop:e2e-open-stake-selector";

async function dismissBetaNotice(page: Page): Promise<void> {
  await page.addInitScript(key => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // localStorage may be unavailable in some test contexts.
    }
  }, BETA_NOTICE_DISMISSED_STORAGE_KEY);

  await page.evaluate(key => {
    try {
      window.localStorage.setItem(key, "true");
    } catch {
      // localStorage may be unavailable in some test contexts.
    }
  }, BETA_NOTICE_DISMISSED_STORAGE_KEY);

  const dismissButton = page.getByRole("button", { name: "Dismiss beta notice" });
  if (await dismissButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await dismissButton.click();
  }
}

async function getReadyRateMobileMenuButton(page: Page) {
  const scrollSource = page.locator('[data-mobile-header-scroll-source="true"]').first();
  if (await scrollSource.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await scrollSource.evaluate(element => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  } else {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.scrollingElement?.scrollTo(0, 0);
    });
  }

  const mobileHeader = page.locator('[data-mobile-header="true"]');
  await expect(mobileHeader).toHaveAttribute("data-visible", "true", { timeout: 5_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const header = document.querySelector<HTMLElement>('[data-mobile-header="true"]');
          const button = header?.querySelector<HTMLElement>('[aria-label="Open menu"]');
          if (!header || !button) {
            return false;
          }

          const headerRect = header.getBoundingClientRect();
          const buttonRect = button.getBoundingClientRect();
          if (headerRect.height <= 0 || buttonRect.width <= 0 || buttonRect.height <= 0) {
            return false;
          }

          const hitTarget = document.elementFromPoint(
            buttonRect.left + buttonRect.width / 2,
            buttonRect.top + buttonRect.height / 2,
          );
          return Boolean(
            hitTarget instanceof Element &&
              (hitTarget === button ||
                button.contains(hitTarget) ||
                hitTarget.closest('[aria-label="Open menu"]') === button),
          );
        }),
      { timeout: 5_000 },
    )
    .toBe(true);

  return mobileHeader.getByLabel("Open menu");
}

async function openReadyRateMobileMenu(page: Page) {
  const button = await getReadyRateMobileMenuButton(page);
  await button.evaluate(element => (element as HTMLElement).click());
  await expect(page.locator('[data-mobile-header="true"] details.dropdown').first()).toHaveAttribute("open", "", {
    timeout: 3_000,
  });
}

test.describe("Mobile viewport (phone)", () => {
  test.beforeEach(async ({ connectedPage: page }) => {
    await dismissBetaNotice(page);
  });

  test("sidebar hidden and hamburger visible", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const sidebar = page.locator("aside.fixed.left-0.top-0");
    await expect(sidebar).toBeHidden();

    const hamburger = await getReadyRateMobileMenuButton(page);
    await expect(hamburger).toBeVisible({ timeout: 5_000 });
  });

  test("hamburger opens mobile menu with nav links", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    await openReadyRateMobileMenu(page);

    const dropdown = page.locator('[data-mobile-header="true"] .dropdown-content').first();
    await expect(dropdown.getByRole("link", { name: /Discover/i })).toBeVisible({ timeout: 5_000 });
    await expect(dropdown.getByRole("link", { name: /Submit/i })).toBeVisible({ timeout: 3_000 });
    await expect(dropdown.getByRole("link", { name: /Reputation/i })).toBeVisible({ timeout: 3_000 });
    const voteTopChrome = page.locator('[data-vote-mobile-top-chrome="true"]');
    await expect(voteTopChrome).toHaveAttribute("data-visible", "false");
    await expect(voteTopChrome).toHaveAttribute("inert", "");
  });

  test("vote page mobile chrome collapses with feed scroll and reclaims space", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);

    const mobileHeader = page.locator('[data-mobile-header="true"]');
    const voteTopChrome = page.locator('[data-vote-mobile-top-chrome="true"]');
    const categoryButton = voteTopChrome.getByRole("button", { name: /^Category:/ }).first();
    const viewButton = voteTopChrome.getByRole("button", { name: /^View(?:$|:)/ }).first();
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");
    await expect(categoryButton).toBeVisible();
    await expect(viewButton).toBeVisible();

    await viewButton.click();
    const viewDialog = page.getByRole("dialog", { name: "View options" });
    await expect(viewDialog).toBeVisible({ timeout: 5_000 });
    await viewDialog.getByRole("button", { name: "Latest" }).click();
    await expect(voteTopChrome.getByRole("button", { name: /^View: Latest$/ }).first()).toBeVisible({
      timeout: 5_000,
    });
    await waitForFeedLoaded(page, 30_000);
    await expect
      .poll(() => page.locator("article[data-feed-card-index]").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    const readCanScroll = () =>
      page.evaluate(() => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        const scrollSource = explicitScrollSource ?? document.scrollingElement;
        if (!scrollSource) return false;
        return scrollSource.scrollHeight > scrollSource.clientHeight + 200;
      });
    await expect.poll(readCanScroll, { timeout: 15_000 }).toBe(true);

    const readLayout = () =>
      page.evaluate(() => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        const topChrome = document.querySelector<HTMLElement>('[data-vote-mobile-top-chrome="true"]');
        const mobileHeader = document.querySelector<HTMLElement>('[data-mobile-header="true"]');
        const mobileHeaderNavbar = document.querySelector<HTMLElement>('[data-mobile-header-navbar="true"]');
        const feedSurface = document.querySelector<HTMLElement>('[data-testid="vote-feed-surface"]');
        const mobileScrollContainer = document.querySelector<HTMLElement>(
          '[data-testid="vote-mobile-scroll-container"]',
        );
        const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
        const activeTitle = document.querySelector<HTMLElement>('article[aria-current="true"] h2');
        const activeContentCardShell = activeArticle?.querySelector<HTMLElement>(
          '[data-testid="vote-content-card-shell"]',
        );
        const activeContentHeader = activeArticle?.querySelector<HTMLElement>('[data-testid="vote-content-header"]');
        const activeContentSurface = activeArticle?.querySelector<HTMLElement>('[data-testid="vote-content-surface"]');
        const activeContentMeta = activeContentSurface?.nextElementSibling as HTMLElement | null | undefined;
        const activeMoreButton = activeArticle?.querySelector<HTMLElement>(
          'button[aria-label="Expand details"], button[aria-label="Collapse details"]',
        );
        const categoryButton = topChrome?.querySelector<HTMLElement>('button[aria-label^="Category:"]');
        const viewButton = topChrome?.querySelector<HTMLElement>(
          'button[aria-label="View"], button[aria-label^="View:"]',
        );

        const scrollerRect = explicitScrollSource?.getBoundingClientRect() ?? null;
        const mobileHeaderRect = mobileHeader?.getBoundingClientRect() ?? null;
        const mobileHeaderNavbarRect = mobileHeaderNavbar?.getBoundingClientRect() ?? null;
        const topChromeRect = topChrome?.getBoundingClientRect() ?? null;
        const mobileScrollContainerRect = mobileScrollContainer?.getBoundingClientRect() ?? null;
        const activeArticleRect = activeArticle?.getBoundingClientRect() ?? null;
        const activeTitleRect = activeTitle?.getBoundingClientRect() ?? null;
        const activeContentHeaderRect = activeContentHeader?.getBoundingClientRect() ?? null;
        const activeContentSurfaceRect = activeContentSurface?.getBoundingClientRect() ?? null;
        const activeContentMetaRect = activeContentMeta?.getBoundingClientRect() ?? null;
        const activeMoreButtonRect = activeMoreButton?.getBoundingClientRect() ?? null;
        const categoryButtonRect = categoryButton?.getBoundingClientRect() ?? null;
        const viewButtonRect = viewButton?.getBoundingClientRect() ?? null;
        const activeContentHeaderStyle = activeContentHeader ? getComputedStyle(activeContentHeader) : null;
        const leftGutterWidth =
          activeArticleRect && mobileScrollContainerRect ? activeArticleRect.left - mobileScrollContainerRect.left : 0;
        const rightGutterWidth =
          activeArticleRect && mobileScrollContainerRect
            ? mobileScrollContainerRect.right - activeArticleRect.right
            : 0;

        return {
          activeMoreControlFits:
            !activeArticleRect || !activeMoreButtonRect
              ? true
              : activeMoreButtonRect.left >= activeArticleRect.left - 1 &&
                activeMoreButtonRect.right <= activeArticleRect.right + 1,
          activeMoreControlVisible:
            !activeMoreButtonRect || (activeMoreButtonRect.width > 0 && activeMoreButtonRect.height > 0),
          activeContentCardShellBackground: activeContentCardShell
            ? getComputedStyle(activeContentCardShell).backgroundColor
            : "",
          activeContentHeaderBackground: activeContentHeader
            ? getComputedStyle(activeContentHeader).backgroundColor
            : "",
          activeContentHeaderBorderBottomLeftRadius: activeContentHeaderStyle?.borderBottomLeftRadius ?? "",
          activeContentHeaderBorderBottomRightRadius: activeContentHeaderStyle?.borderBottomRightRadius ?? "",
          activeContentHeaderToSurfaceGap:
            activeContentHeaderRect && activeContentSurfaceRect
              ? activeContentSurfaceRect.top - activeContentHeaderRect.bottom
              : 0,
          activeContentSurfaceToMetaGap:
            activeContentSurfaceRect && activeContentMetaRect
              ? activeContentMetaRect.top - activeContentSurfaceRect.bottom
              : 0,
          activeIndex: Number(activeArticle?.getAttribute("data-feed-card-index") ?? -1),
          activeScrollSnapAlign: activeArticle ? getComputedStyle(activeArticle).scrollSnapAlign : "",
          activeScrollSnapStop: activeArticle ? getComputedStyle(activeArticle).scrollSnapStop : "",
          activeTop: activeArticleRect?.top ?? 0,
          activeBottom: activeArticleRect?.bottom ?? 0,
          activeTitleBottom: activeTitleRect?.bottom ?? 0,
          activeTitleTop: activeTitleRect?.top ?? 0,
          categoryButtonHeight: categoryButtonRect?.height ?? 0,
          categoryButtonTop: categoryButtonRect?.top ?? 0,
          documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
          bodyOverflowY: getComputedStyle(document.body).overflowY,
          feedSurfaceBackground: feedSurface ? getComputedStyle(feedSurface).backgroundColor : "",
          feedSurfacePaddingTop: feedSurface ? getComputedStyle(feedSurface).paddingTop : "",
          feedSurfaceTop: feedSurface?.getBoundingClientRect().top ?? 0,
          rootOverflowY: getComputedStyle(document.documentElement).overflowY,
          rootScrollLocked:
            document.documentElement.classList.contains("rateloop-vote-root-scroll-lock") &&
            document.body.classList.contains("rateloop-vote-root-scroll-lock"),
          scrollContainerBackground: mobileScrollContainer
            ? getComputedStyle(mobileScrollContainer).backgroundColor
            : "",
          scrollContainerSnapType: mobileScrollContainer ? getComputedStyle(mobileScrollContainer).scrollSnapType : "",
          scrollContainerTouchAction: mobileScrollContainer ? getComputedStyle(mobileScrollContainer).touchAction : "",
          scrollWheelX: activeArticleRect
            ? activeArticleRect.left + Math.min(24, activeArticleRect.width / 2)
            : scrollerRect
              ? scrollerRect.left + 16
              : 0,
          scrollWheelY: scrollerRect
            ? Math.min(
                Math.max(scrollerRect.top + 80, 80),
                Math.min(scrollerRect.bottom - 80, window.innerHeight - 160),
              )
            : 0,
          leftGutterWidth,
          mobileHeaderBottom: mobileHeaderRect?.bottom ?? 0,
          mobileHeaderHeight: mobileHeaderRect?.height ?? 0,
          mobileHeaderNavbarBottom: mobileHeaderNavbarRect?.bottom ?? 0,
          rightGutterWidth,
          scrollerBottom: scrollerRect?.bottom ?? 0,
          scrollerTop: scrollerRect?.top ?? 0,
          topChromeBottom: topChromeRect?.bottom ?? 0,
          topChromeHeight: topChromeRect?.height ?? 0,
          topChromeTop: topChromeRect?.top ?? 0,
          viewButtonHeight: viewButtonRect?.height ?? 0,
          voteScrollTop: explicitScrollSource?.scrollTop ?? 0,
        };
      });
    const setFeedScrollTop = (targetScrollTop: number, options?: { suppressHeaderChange?: boolean }) =>
      page.evaluate(async ({ scrollTop, suppressHeaderChange }) => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        if (!explicitScrollSource) {
          window.scrollTo(0, scrollTop);
          return;
        }

        const previousScrollBehavior = explicitScrollSource.style.scrollBehavior;
        const previousScrollSnapType = explicitScrollSource.style.scrollSnapType;
        if (suppressHeaderChange) {
          explicitScrollSource.setAttribute("data-mobile-header-scroll-sync", "test");
          explicitScrollSource.setAttribute("data-mobile-header-scroll-sync-offset", String(scrollTop));
        }
        if (scrollTop <= 0) {
          explicitScrollSource.removeAttribute("data-mobile-header-scroll-intent");
          explicitScrollSource.style.scrollSnapType = "none";
        }
        explicitScrollSource.style.scrollBehavior = "auto";
        explicitScrollSource.scrollTop = scrollTop;
        explicitScrollSource.dispatchEvent(new Event("scroll", { bubbles: true }));
        if (scrollTop <= 0) {
          await new Promise<void>(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
          explicitScrollSource.style.scrollSnapType = previousScrollSnapType;
        }
        explicitScrollSource.style.scrollBehavior = previousScrollBehavior;
      }, { scrollTop: targetScrollTop, suppressHeaderChange: options?.suppressHeaderChange === true });
    const userScrollSameCard = (targetScrollTop: number) =>
      page.evaluate(scrollTop => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        if (!explicitScrollSource) {
          throw new Error("Missing mobile feed scroller");
        }

        const previousScrollBehavior = explicitScrollSource.style.scrollBehavior;
        explicitScrollSource.dispatchEvent(new Event("touchmove", { bubbles: true }));
        explicitScrollSource.setAttribute("data-mobile-header-scroll-intent", "true");
        explicitScrollSource.style.scrollBehavior = "auto";
        explicitScrollSource.scrollTop = scrollTop;
        explicitScrollSource.dispatchEvent(new Event("scroll", { bubbles: true }));
        explicitScrollSource.style.scrollBehavior = previousScrollBehavior;
      }, targetScrollTop);
    const browserScrollWithinActiveCard = (deltaY: number) =>
      page.evaluate(async delta => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
        if (!explicitScrollSource || !activeArticle) {
          throw new Error("Missing mobile feed scroller or active article");
        }

        const activeIndex = Number(activeArticle.getAttribute("data-feed-card-index") ?? -1);
        const startingScrollTop = explicitScrollSource.scrollTop;

        explicitScrollSource.dispatchEvent(new Event("touchmove", { bubbles: true }));
        explicitScrollSource.scrollBy({ top: delta, behavior: "smooth" });
        await new Promise(resolve => window.setTimeout(resolve, 480));

        return {
          activeIndex,
          endingScrollTop: explicitScrollSource.scrollTop,
          startingScrollTop,
        };
      }, deltaY);
    const browserSnapScrollOneCard = async (direction: "down" | "up") => {
      const scrollIntent = await page.evaluate(direction => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
        if (!explicitScrollSource || !activeArticle) {
          throw new Error("Missing mobile feed scroller or active article");
        }

        const currentIndex = Number(activeArticle.getAttribute("data-feed-card-index") ?? -1);
        const targetIndex = currentIndex + (direction === "down" ? 1 : -1);
        const targetArticle = document.querySelector<HTMLElement>(`article[data-feed-card-index="${targetIndex}"]`);
        if (!targetArticle) {
          throw new Error(`Missing target article ${targetIndex}`);
        }

        const activeRect = activeArticle.getBoundingClientRect();
        const targetRect = targetArticle.getBoundingClientRect();

        return {
          currentIndex,
          targetIndex,
          deltaY: targetRect.top - activeRect.top + (direction === "down" ? 24 : -24),
        };
      }, direction);

      await page.evaluate(({ deltaY }) => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        if (!explicitScrollSource) {
          throw new Error("Missing mobile feed scroller");
        }

        explicitScrollSource.dispatchEvent(new Event("touchmove", { bubbles: true }));
        explicitScrollSource.scrollBy({ top: deltaY, behavior: "smooth" });
      }, scrollIntent);
      await expect
        .poll(async () => (await readLayout()).activeIndex, { timeout: 3_000 })
        .toBe(scrollIntent.targetIndex);

      return scrollIntent;
    };
    const resetToFirstFeedCard = async () => {
      await page.locator('article[aria-current="true"]').first().focus({ timeout: 1_000 }).catch(() => undefined);
      await page.keyboard.press("Home");
      await expect.poll(async () => (await readLayout()).activeIndex, { timeout: 3_000 }).toBe(0);
      await expect.poll(async () => (await readLayout()).voteScrollTop, { timeout: 3_000 }).toBeLessThan(2);
    };
    const forceDocumentScrollLeak = (targetScrollTop: number) =>
      page.evaluate(scrollTop => {
        document.querySelector('[data-root-scroll-recovery-spacer="true"]')?.remove();

        const spacer = document.createElement("div");
        spacer.setAttribute("data-root-scroll-recovery-spacer", "true");
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.height = "1200px";
        spacer.style.width = "1px";
        spacer.style.opacity = "0";
        spacer.style.pointerEvents = "none";
        document.body.appendChild(spacer);

        window.scrollTo(0, scrollTop);
        window.dispatchEvent(new Event("scroll"));
      }, targetScrollTop);
    const removeDocumentScrollLeakSpacer = () =>
      page.evaluate(() => {
        document.querySelector('[data-root-scroll-recovery-spacer="true"]')?.remove();
        window.scrollTo(0, 0);
      });
    const waitForMobileHeaderScrollSyncIdle = () =>
      page.waitForFunction(() => {
        const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
        return !explicitScrollSource?.hasAttribute("data-mobile-header-scroll-sync");
      });
    const startMobileChromeChangeCapture = () =>
      page.evaluate(() => {
        type ChromeChange = { target: "header" | "tabs"; visible: string; at: number };
        type ChromeCaptureWindow = Window & {
          __rateloopMobileChromeChanges?: ChromeChange[];
          __rateloopMobileChromeObservers?: MutationObserver[];
        };
        const captureWindow = window as ChromeCaptureWindow;
        captureWindow.__rateloopMobileChromeObservers?.forEach(observer => observer.disconnect());
        captureWindow.__rateloopMobileChromeChanges = [];

        const observeVisibility = (target: "header" | "tabs", node: HTMLElement | null) => {
          if (!node) return null;

          const observer = new MutationObserver(() => {
            captureWindow.__rateloopMobileChromeChanges?.push({
              target,
              visible: node.getAttribute("data-visible") ?? "",
              at: Math.round(performance.now()),
            });
          });
          observer.observe(node, { attributeFilter: ["data-visible"] });
          return observer;
        };

        captureWindow.__rateloopMobileChromeObservers = [
          observeVisibility("header", document.querySelector<HTMLElement>('[data-mobile-header="true"]')),
          observeVisibility("tabs", document.querySelector<HTMLElement>('[data-vote-mobile-top-chrome="true"]')),
        ].filter((observer): observer is MutationObserver => observer !== null);
      });
    const stopMobileChromeChangeCapture = () =>
      page.evaluate(() => {
        type ChromeChange = { target: "header" | "tabs"; visible: string; at: number };
        type ChromeCaptureWindow = Window & {
          __rateloopMobileChromeChanges?: ChromeChange[];
          __rateloopMobileChromeObservers?: MutationObserver[];
        };
        const captureWindow = window as ChromeCaptureWindow;
        const changes = captureWindow.__rateloopMobileChromeChanges ?? [];
        captureWindow.__rateloopMobileChromeObservers?.forEach(observer => observer.disconnect());
        captureWindow.__rateloopMobileChromeObservers = [];
        captureWindow.__rateloopMobileChromeChanges = [];
        return changes;
      });

    await resetToFirstFeedCard();

    const initialLayout = await readLayout();
    expect(initialLayout.leftGutterWidth).toBeLessThanOrEqual(1);
    expect(initialLayout.rightGutterWidth).toBeLessThanOrEqual(1);
    expect(initialLayout.feedSurfaceBackground).toBe("rgb(0, 0, 0)");
    expect(initialLayout.feedSurfacePaddingTop).toBe("6px");
    expect(initialLayout.rootScrollLocked).toBe(true);
    expect(initialLayout.rootOverflowY).toBe("hidden");
    expect(initialLayout.bodyOverflowY).toBe("hidden");
    expect(initialLayout.scrollContainerBackground).toBe("rgb(0, 0, 0)");
    expect(initialLayout.scrollContainerSnapType).toContain("y");
    expect(initialLayout.scrollContainerSnapType).toContain("mandatory");
    expect(initialLayout.activeScrollSnapAlign).toContain("start");
    expect(initialLayout.activeScrollSnapStop).toBe("normal");
    expect(initialLayout.scrollContainerTouchAction).toContain("pan-y");
    expect(initialLayout.scrollContainerTouchAction).toContain("pinch-zoom");
    expect(["rgb(18, 18, 18)", "rgb(23, 22, 26)"]).toContain(initialLayout.activeContentCardShellBackground);
    expect(initialLayout.activeContentHeaderBackground).toBe(initialLayout.activeContentCardShellBackground);
    expect(Math.abs(initialLayout.activeContentHeaderToSurfaceGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialLayout.activeContentSurfaceToMetaGap)).toBeLessThanOrEqual(1);
    expect(initialLayout.activeContentHeaderBorderBottomLeftRadius).toBe("0px");
    expect(initialLayout.activeContentHeaderBorderBottomRightRadius).toBe("0px");
    expect(initialLayout.activeMoreControlVisible).toBe(true);
    expect(initialLayout.activeMoreControlFits).toBe(true);

    const tallActiveCardStyle = await page.addStyleTag({
      content: `
        @media (max-width: 1279px) {
          [data-testid="vote-mobile-scroll-container"] article[aria-current="true"] {
            min-height: calc(100vh + 360px) !important;
          }
        }
      `,
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const scroller = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
            const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
            if (!scroller || !activeArticle) return false;
            return activeArticle.getBoundingClientRect().height > scroller.clientHeight + 240;
          }),
        { timeout: 5_000 },
      )
      .toBe(true);

    const sameCardScrollStart = await readLayout();
    await startMobileChromeChangeCapture();
    await setFeedScrollTop(sameCardScrollStart.voteScrollTop + 96, { suppressHeaderChange: true });
    await expect.poll(async () => (await readLayout()).activeIndex).toBe(sameCardScrollStart.activeIndex);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const sameCardScrolledLayout = await readLayout();
    const sameCardChromeChanges = await stopMobileChromeChangeCapture();
    expect(sameCardScrolledLayout.activeIndex).toBe(sameCardScrollStart.activeIndex);
    expect(sameCardScrolledLayout.voteScrollTop).toBeGreaterThanOrEqual(sameCardScrollStart.voteScrollTop);
    expect(sameCardChromeChanges.filter(change => change.target === "header").map(change => change.visible)).toEqual(
      [],
    );
    expect(sameCardChromeChanges.filter(change => change.target === "tabs").map(change => change.visible)).toEqual([]);

    await setFeedScrollTop(0);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const userSameCardScrollStart = await readLayout();
    await startMobileChromeChangeCapture();
    await userScrollSameCard(userSameCardScrollStart.voteScrollTop + 180);
    await expect.poll(async () => (await readLayout()).activeIndex).toBe(userSameCardScrollStart.activeIndex);
    await expect(mobileHeader).toHaveAttribute("data-visible", "false");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "false");
    const userSameCardChromeChanges = await stopMobileChromeChangeCapture();
    expect(userSameCardChromeChanges.filter(change => change.target === "header").map(change => change.visible)).toEqual(
      ["false"],
    );
    expect(userSameCardChromeChanges.filter(change => change.target === "tabs").map(change => change.visible)).toEqual([
      "false",
    ]);

    await setFeedScrollTop(0);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const settledSameCardScrollStart = await readLayout();
    await startMobileChromeChangeCapture();
    const settledSameCardScroll = await browserScrollWithinActiveCard(180);
    await expect.poll(async () => (await readLayout()).activeIndex).toBe(settledSameCardScrollStart.activeIndex);
    await expect
      .poll(async () => (await readLayout()).voteScrollTop)
      .toBeGreaterThan(settledSameCardScroll.startingScrollTop + 48);
    await expect(mobileHeader).toHaveAttribute("data-visible", "false");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "false");
    expect(settledSameCardScroll.activeIndex).toBe(settledSameCardScrollStart.activeIndex);
    expect(settledSameCardScroll.endingScrollTop).toBeGreaterThan(settledSameCardScroll.startingScrollTop + 48);
    const settledSameCardChromeChanges = await stopMobileChromeChangeCapture();
    expect(settledSameCardChromeChanges.filter(change => change.target === "header").map(change => change.visible)).toEqual(
      ["false"],
    );
    expect(settledSameCardChromeChanges.filter(change => change.target === "tabs").map(change => change.visible)).toEqual(
      ["false"],
    );

    await setFeedScrollTop(0);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");
    await tallActiveCardStyle.evaluate(styleElement => (styleElement as HTMLElement).remove());
    await setFeedScrollTop(0);
    await expect.poll(async () => (await readLayout()).voteScrollTop).toBeLessThan(2);

    const beforeAutoScroll = await readLayout();
    await page.evaluate(() => {
      const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
      explicitScrollSource?.scrollBy({ top: 900, behavior: "auto" });
    });
    await expect.poll(async () => (await readLayout()).voteScrollTop).toBeGreaterThan(beforeAutoScroll.voteScrollTop);
    const afterScrollWheel = await readLayout();
    expect(afterScrollWheel.documentScrollTop).toBe(0);

    await setFeedScrollTop(0);
    await expect.poll(async () => (await readLayout()).voteScrollTop).toBeLessThan(2);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const beforeRootScrollLeak = await readLayout();
    expect(beforeRootScrollLeak.voteScrollTop).toBeLessThan(2);
    await forceDocumentScrollLeak(64);
    await expect.poll(async () => (await readLayout()).documentScrollTop).toBe(0);
    await expect
      .poll(async () => {
        const layout = await readLayout();
        return Math.abs(layout.voteScrollTop - beforeRootScrollLeak.voteScrollTop) <= 2;
      })
      .toBe(true);

    const afterRootScrollLeak = await readLayout();
    expect(afterRootScrollLeak.rootScrollLocked).toBe(true);
    expect(afterRootScrollLeak.topChromeTop).toBeGreaterThanOrEqual(afterRootScrollLeak.mobileHeaderNavbarBottom - 1);
    expect(afterRootScrollLeak.activeTitleTop).toBeGreaterThanOrEqual(afterRootScrollLeak.topChromeBottom - 1);
    await removeDocumentScrollLeakSpacer();
    await setFeedScrollTop(0);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const expandedLayout = await readLayout();
    expect(expandedLayout.topChromeTop).toBeGreaterThanOrEqual(expandedLayout.mobileHeaderNavbarBottom - 1);
    expect(expandedLayout.activeTitleTop).toBeGreaterThanOrEqual(expandedLayout.topChromeBottom - 1);
    await waitForMobileHeaderScrollSyncIdle();

    const beforeFirstNativeScroll = await readLayout();
    await startMobileChromeChangeCapture();
    await browserSnapScrollOneCard("down");
    await expect(mobileHeader).toHaveAttribute("data-visible", "false");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "false");
    await page.waitForFunction(() => {
      const mobileHeader = document.querySelector<HTMLElement>('[data-mobile-header="true"]');
      return mobileHeader !== null && mobileHeader.getBoundingClientRect().height < 4;
    });

    const collapsedLayout = await readLayout();
    const collapseChromeChanges = await stopMobileChromeChangeCapture();
    expect(collapseChromeChanges.filter(change => change.target === "header").map(change => change.visible)).toEqual([
      "false",
    ]);
    expect(collapseChromeChanges.filter(change => change.target === "tabs").map(change => change.visible)).toEqual([
      "false",
    ]);
    expect(collapsedLayout.documentScrollTop).toBe(0);
    expect(collapsedLayout.activeIndex).toBe(beforeFirstNativeScroll.activeIndex + 1);
    expect(collapsedLayout.feedSurfaceTop).toBeLessThan(expandedLayout.feedSurfaceTop - 24);
    expect(collapsedLayout.mobileHeaderHeight).toBeLessThan(4);
    expect(collapsedLayout.voteScrollTop).toBeGreaterThan(0);
    expect(collapsedLayout.voteScrollTop).toBeGreaterThan(beforeFirstNativeScroll.voteScrollTop);
    expect(collapsedLayout.activeTop).toBeGreaterThanOrEqual(collapsedLayout.scrollerTop - 1);
    expect(collapsedLayout.activeTop - collapsedLayout.scrollerTop).toBeLessThanOrEqual(64);
    expect(collapsedLayout.activeTitleTop).toBeGreaterThanOrEqual(collapsedLayout.scrollerTop - 1);
    expect(collapsedLayout.activeTitleBottom).toBeLessThanOrEqual(collapsedLayout.scrollerBottom + 1);

    const beforeNativeScrollUp = await readLayout();
    await startMobileChromeChangeCapture();
    await browserSnapScrollOneCard("up");
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");
    await expect(categoryButton).toBeVisible();
    await expect(viewButton).toBeVisible();
    await page.waitForFunction(() => {
      const topChrome = document.querySelector<HTMLElement>('[data-vote-mobile-top-chrome="true"]');
      return topChrome !== null && topChrome.getBoundingClientRect().height > 24;
    });
    await expect
      .poll(async () => {
        const layout = await readLayout();
        return layout.activeTitleTop >= layout.topChromeBottom - 1;
      })
      .toBe(true);

    const restoredLayout = await readLayout();
    const restoreChromeChanges = await stopMobileChromeChangeCapture();
    expect(restoreChromeChanges.filter(change => change.target === "header").map(change => change.visible)).toEqual([
      "true",
    ]);
    expect(restoreChromeChanges.filter(change => change.target === "tabs").map(change => change.visible)).toEqual([
      "true",
    ]);
    expect(restoredLayout.activeIndex).toBe(beforeNativeScrollUp.activeIndex - 1);
    expect(restoredLayout.feedSurfaceTop).toBeGreaterThan(collapsedLayout.feedSurfaceTop + 8);
    expect(restoredLayout.topChromeTop).toBeGreaterThanOrEqual(restoredLayout.mobileHeaderNavbarBottom - 1);
    expect(restoredLayout.categoryButtonTop).toBeGreaterThanOrEqual(restoredLayout.mobileHeaderNavbarBottom - 1);
    expect(restoredLayout.categoryButtonHeight).toBeGreaterThan(20);
    expect(restoredLayout.viewButtonHeight).toBeGreaterThan(20);
    expect(restoredLayout.activeTitleTop).toBeGreaterThanOrEqual(restoredLayout.topChromeBottom - 1);
    expect(restoredLayout.activeTitleTop).toBeGreaterThanOrEqual(restoredLayout.scrollerTop - 1);
    expect(restoredLayout.activeTitleBottom).toBeLessThanOrEqual(restoredLayout.scrollerBottom + 1);
  });

  test("last feed card snaps above the mobile dock and shows context", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);

    await expect(page.getByRole("button", { name: /^Category: All$/ }).first()).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(() => page.locator("article[data-feed-card-index]").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const explicitScrollSource = document.querySelector<HTMLElement>(
              '[data-mobile-header-scroll-source="true"]',
            );
            return explicitScrollSource ? explicitScrollSource.scrollHeight - explicitScrollSource.clientHeight : 0;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(200);

    const lastIndex = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll<HTMLElement>("article[data-feed-card-index]"));
      if (articles.length < 2) {
        throw new Error("Expected multiple cards in the mobile feed");
      }

      return Number(articles.at(-1)?.getAttribute("data-feed-card-index") ?? -1);
    });

    await page.evaluate(() => {
      const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
      if (!explicitScrollSource) {
        throw new Error("Missing mobile feed scroller");
      }

      const previousScrollBehavior = explicitScrollSource.style.scrollBehavior;
      explicitScrollSource.style.scrollBehavior = "auto";
      explicitScrollSource.scrollTop = explicitScrollSource.scrollHeight;
      explicitScrollSource.dispatchEvent(new Event("scroll", { bubbles: true }));
      explicitScrollSource.style.scrollBehavior = previousScrollBehavior;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
          return explicitScrollSource?.scrollTop ?? 0;
        }),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
            return Number(activeArticle?.getAttribute("data-feed-card-index") ?? -1);
          }),
        { timeout: 3_000 },
      )
      .toBe(lastIndex);

    await page.waitForFunction(() => {
      const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
      return explicitScrollSource !== null && !explicitScrollSource.hasAttribute("data-mobile-header-scroll-sync");
    });
    const bottomSettleState = await page.evaluate(async () => {
      const explicitScrollSource = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
      if (!explicitScrollSource) {
        throw new Error("Missing mobile feed scroller");
      }

      const beforeScrollTop = explicitScrollSource.scrollTop;
      explicitScrollSource.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise(resolve => window.setTimeout(resolve, 220));

      return {
        scrollTopChanged: Math.abs(explicitScrollSource.scrollTop - beforeScrollTop) >= 0.5,
        syncActive: explicitScrollSource.hasAttribute("data-mobile-header-scroll-sync"),
      };
    });
    expect(bottomSettleState).toEqual({
      scrollTopChanged: false,
      syncActive: false,
    });

    const activeContextLink = page.locator('article[aria-current="true"] [data-testid="content-source-link"]').first();
    await expect(activeContextLink).toBeVisible({ timeout: 5_000 });

    const layout = await activeContextLink.evaluate(link => {
      const scroller = document.querySelector<HTMLElement>('[data-mobile-header-scroll-source="true"]');
      const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
      const mobileDock = document.querySelector<HTMLElement>('[data-testid="vote-mobile-dock"]');
      const mobileDockShell = mobileDock?.querySelector<HTMLElement>('[data-mobile-dock-shell="true"]') ?? null;

      if (!scroller || !activeArticle || !mobileDockShell) {
        throw new Error("Missing mobile feed layout elements");
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const activeArticleRect = activeArticle.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const dockShellRect = mobileDockShell.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        linkRect.left + linkRect.width / 2,
        linkRect.top + linkRect.height / 2,
      );

      return {
        activeContextBottom: linkRect.bottom,
        activeContextCenterTopmost: topElement === link || link.contains(topElement),
        activeTop: activeArticleRect.top,
        dockShellTop: dockShellRect.top,
        scrollerTop: scrollerRect.top,
      };
    });

    expect(layout.activeContextBottom).toBeLessThanOrEqual(layout.dockShellTop - 1);
    expect(layout.activeContextCenterTopmost).toBe(true);
  });

  test("mobile description preview keeps Show More above the voting dock", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);
    await expect
      .poll(() => page.locator("article[data-feed-card-index]").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);

    const scrollToNextCard = async () => {
      const targetIndex = await page.evaluate(() => {
        const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
        if (!activeArticle) {
          throw new Error("Missing active article");
        }

        const activeIndex = Number(activeArticle.getAttribute("data-feed-card-index") ?? -1);
        const targetArticle = document.querySelector<HTMLElement>(`article[data-feed-card-index="${activeIndex + 1}"]`);
        if (!targetArticle) return activeIndex;

        return activeIndex + 1;
      });

      await page.keyboard.press("PageDown");
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              Number(document.querySelector<HTMLElement>('article[aria-current="true"]')?.dataset.feedCardIndex ?? -1),
            ),
          { timeout: 3_000 },
        )
        .toBe(targetIndex);
    };

    let showMore = page.locator('article[aria-current="true"] button:has-text("Show More")').first();
    for (let attempt = 0; attempt < 6 && (await showMore.count()) === 0; attempt += 1) {
      await scrollToNextCard();
      showMore = page.locator('article[aria-current="true"] button:has-text("Show More")').first();
    }

    if ((await showMore.count()) === 0) {
      await expect(page.getByRole("feed", { name: "Content feed" }).getByRole("article").first()).toBeVisible();
      return;
    }

    await expect(showMore).toBeVisible({ timeout: 5_000 });

    const layout = await showMore.evaluate(button => {
      const activeArticle = document.querySelector<HTMLElement>('article[aria-current="true"]');
      const mobileDock = document.querySelector<HTMLElement>('[data-testid="vote-mobile-dock"]');
      if (!activeArticle || !mobileDock) {
        throw new Error("Missing active article or mobile voting dock");
      }

      const buttonRect = button.getBoundingClientRect();
      const dockRect = mobileDock.getBoundingClientRect();
      const previewRow = button.closest("div");
      const previewParagraph = previewRow?.querySelector("p");
      const previewParagraphRect = previewParagraph?.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        buttonRect.left + buttonRect.width / 2,
        buttonRect.top + buttonRect.height / 2,
      );

      return {
        buttonBottom: buttonRect.bottom,
        buttonTop: buttonRect.top,
        buttonTopmost: topElement === button || button.contains(topElement),
        dockTop: dockRect.top,
        previewParagraphBottom: previewParagraphRect?.bottom ?? 0,
        previewParagraphTop: previewParagraphRect?.top ?? 0,
      };
    });

    expect(layout.buttonBottom).toBeLessThanOrEqual(layout.dockTop - 44);
    expect(layout.buttonTop).toBeLessThanOrEqual(layout.previewParagraphBottom + 8);
    expect(layout.buttonBottom).toBeGreaterThanOrEqual(layout.previewParagraphTop - 8);
    expect(layout.buttonTopmost).toBe(true);

    await showMore.click();
    const showLess = page.locator('article[aria-current="true"] button:has-text("Show Less")').first();
    await expect(showLess).toBeVisible();
    const expandedLayout = await showLess.evaluate(button => {
      const buttonRect = button.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        buttonRect.left + buttonRect.width / 2,
        buttonRect.top + buttonRect.height / 2,
      );

      return {
        buttonTopmost: topElement === button || button.contains(topElement),
      };
    });
    expect(expandedLayout.buttonTopmost).toBe(true);
    await expect(page.getByRole("dialog", { name: /^Share / })).toBeHidden();

    await page.locator('[data-testid="vote-mobile-dock"]').getByRole("button", { name: "Share content" }).click();
    const shareDialog = page.getByRole("dialog", { name: /^Share / }).first();
    await expect(shareDialog).toBeVisible();
    await shareDialog.getByRole("button", { name: "Close share dialog" }).click();
    await expect(shareDialog).toBeHidden();
  });

  test("mobile voting dock keeps rating orb raised above equal action circles", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);

    const canVote = await findVoteableContent(page);
    expect(canVote, "Should find at least one voteable content with dock vote controls").toBeTruthy();

    const dock = page.locator('[data-testid="vote-mobile-dock"]');
    await expect(dock).toBeVisible({ timeout: 5_000 });
    await expect(dock.locator('[data-mobile-dock-rating-orb="true"]')).toBeVisible({ timeout: 5_000 });

    const layout = await dock.evaluate(node => {
      const dockElement = node as HTMLElement;
      const ratingOrb = dockElement.querySelector<HTMLElement>('[data-mobile-dock-rating-orb="true"]');
      const shell = dockElement.querySelector<HTMLElement>('[data-mobile-dock-shell="true"]');
      const actionControls = shell
        ? Array.from(shell.querySelectorAll<HTMLElement>("button")).filter(button => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
        : [];

      if (!ratingOrb || !shell || actionControls.length < 4) {
        throw new Error("Missing mobile dock rating orb, shell, or action controls");
      }

      const toRect = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      };
      const dockRect = toRect(dockElement);
      const ratingRect = toRect(ratingOrb);
      const controlRects = actionControls.slice(0, 4).map(control => toRect(control));
      const shellStyle = getComputedStyle(shell);

      return {
        controlRects,
        dockCenterX: dockRect.left + dockRect.width / 2,
        maskImage: shellStyle.maskImage,
        ratingRect,
        webkitMaskImage: shellStyle.getPropertyValue("-webkit-mask-image"),
      };
    });

    const firstControl = layout.controlRects[0];
    for (const control of layout.controlRects.slice(1)) {
      expect(Math.abs(control.width - firstControl.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(control.height - firstControl.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(control.top - firstControl.top)).toBeLessThanOrEqual(1);
    }

    const highestControlTop = Math.min(...layout.controlRects.map(rect => rect.top));
    expect(layout.ratingRect.width).toBeGreaterThan(firstControl.width + 30);
    expect(layout.ratingRect.height).toBeGreaterThan(firstControl.height + 30);
    expect(layout.ratingRect.top).toBeLessThan(highestControlTop - 8);
    expect(Math.abs(layout.ratingRect.left + layout.ratingRect.width / 2 - layout.dockCenterX)).toBeLessThanOrEqual(2);
    expect(`${layout.maskImage} ${layout.webkitMaskImage}`).toContain("radial-gradient");
  });

  test("category switches keep the mobile feed controls visible", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate#products", { ensureWalletConnected: true });
    await waitForFeedLoaded(page);

    const voteTopChrome = page.locator('[data-vote-mobile-top-chrome="true"]');
    const mobileHeader = page.locator('[data-mobile-header="true"]');
    const readHeaderTabsLayout = () =>
      page.evaluate(() => {
        const mobileHeader = document.querySelector<HTMLElement>('[data-mobile-header="true"]');
        const mobileHeaderNavbar = document.querySelector<HTMLElement>('[data-mobile-header-navbar="true"]');
        const topChrome = document.querySelector<HTMLElement>('[data-vote-mobile-top-chrome="true"]');
        const activeTitle = document.querySelector<HTMLElement>('article[aria-current="true"] h2');
        const main = document.querySelector<HTMLElement>("main");
        const mobileHeaderRect = mobileHeader?.getBoundingClientRect() ?? null;
        const mobileHeaderNavbarRect = mobileHeaderNavbar?.getBoundingClientRect() ?? null;
        const topChromeRect = topChrome?.getBoundingClientRect() ?? null;
        const activeTitleRect = activeTitle?.getBoundingClientRect() ?? null;
        const mainRect = main?.getBoundingClientRect() ?? null;

        return {
          activeTitlePresent: activeTitleRect !== null,
          activeTitleTop: activeTitleRect?.top ?? 0,
          documentScrollTop: document.scrollingElement?.scrollTop ?? 0,
          mainTop: mainRect?.top ?? 0,
          mobileHeaderBottom: mobileHeaderRect?.bottom ?? 0,
          mobileHeaderNavbarBottom: mobileHeaderNavbarRect?.bottom ?? 0,
          topChromeBottom: topChromeRect?.bottom ?? 0,
          topChromeTop: topChromeRect?.top ?? 0,
        };
      });
    const expectHeaderTabsStable = async () => {
      await expect(mobileHeader).toHaveAttribute("data-visible", "true");
      await expect(voteTopChrome).toHaveAttribute("data-visible", "true");
      await expect
        .poll(async () => {
          const layout = await readHeaderTabsLayout();
          return (
            layout.documentScrollTop === 0 &&
            layout.topChromeTop >= layout.mobileHeaderNavbarBottom - 1 &&
            layout.topChromeBottom <= layout.mobileHeaderBottom + 1 &&
            (layout.activeTitlePresent
              ? layout.activeTitleTop >= layout.mobileHeaderBottom - 1
              : layout.mainTop >= layout.topChromeBottom - 1)
          );
        })
        .toBe(true);
    };

    await expect(voteTopChrome).toHaveAttribute("data-visible", "true");

    const categoryButton = voteTopChrome.getByRole("button", { name: /^Category: Products$/ }).first();
    await expect(categoryButton).toBeVisible({ timeout: 10_000 });
    await expectHeaderTabsStable();

    await categoryButton.click();
    const categoryDialog = page.getByRole("dialog", { name: "Category options" });
    await expect(categoryDialog).toBeVisible({ timeout: 5_000 });
    await categoryDialog.getByRole("button", { name: "Media" }).click();

    await expect(page).toHaveURL(/#media$/, { timeout: 5_000 });
    await expectHeaderTabsStable();
    await expect(voteTopChrome.getByRole("button", { name: /^Category: Media$/ }).first()).toBeVisible({
      timeout: 5_000,
    });
    const viewButton = voteTopChrome.getByRole("button", { name: /^View(?:$|:)/ }).first();
    await expect(viewButton).toBeVisible();

    await viewButton.click();
    const viewDialog = page.getByRole("dialog", { name: "View options" });
    await expect(viewDialog).toBeVisible({ timeout: 5_000 });
    await viewDialog.getByRole("button", { name: "Latest" }).click();

    await expect(voteTopChrome.getByRole("button", { name: /^View: Latest$/ }).first()).toBeVisible({
      timeout: 5_000,
    });
    await expectHeaderTabsStable();
  });

  test("mobile landing header remains accessible during programmatic scroll", async ({ page }) => {
    await gotoWithRetry(page, "/?landing=1", { skipInjectedWalletConnectionCheck: true, timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /Level Up Your Agent/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    const mobileHeader = page.locator('[data-mobile-header="true"]');
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.dispatchEvent(new Event("scroll"));
    });
    await page.waitForFunction(() => window.scrollY <= 1);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");

    const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200);
    expect(canScroll).toBe(true);

    await page.evaluate(() => {
      window.history.scrollRestoration = "manual";
      window.scrollTo(0, 0);
      document.scrollingElement?.scrollTo(0, 0);
      window.dispatchEvent(new Event("scroll"));
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(mobileHeader).toHaveAttribute("data-visible", "true");

    await page.waitForTimeout(320);
    await page.evaluate(() => {
      window.scrollTo(0, 900);
      document.scrollingElement?.scrollTo(0, 900);
      for (const target of [document, document.documentElement, document.body, window]) {
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await page.waitForFunction(() => window.scrollY >= 800);
    await expect.poll(() => mobileHeader.getAttribute("data-visible")).toBe("true");

    await page.waitForTimeout(320);
    await page.evaluate(() => {
      window.scrollTo(0, 320);
      document.scrollingElement?.scrollTo(0, 320);
      for (const target of [document, document.documentElement, document.body, window]) {
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    });
    await page.waitForFunction(() => window.scrollY <= 340);
    await expect.poll(() => mobileHeader.getAttribute("data-visible")).toBe("true");
  });

  test("hamburger menu navigation works", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    await openReadyRateMobileMenu(page);
    const submitLink = page
      .locator('[data-mobile-header="true"] .dropdown-content')
      .first()
      .getByRole("link", { name: /Submit/i });
    await submitLink.waitFor({ state: "visible", timeout: 3_000 });
    await Promise.all([page.waitForURL(/\/ask/, { timeout: 15_000 }), submitLink.click({ force: true })]);
  });

  test("vote page loads and content visible without overflow", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("view filter sheet opens above the vote feed", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 60_000);

    const voteTopChrome = page.locator('[data-vote-mobile-top-chrome="true"]');
    await expect(voteTopChrome).toHaveAttribute("data-visible", "true", { timeout: 5_000 });
    const viewButton = voteTopChrome.getByRole("button", { name: /^View(?:$|:)/ }).first();
    await expect(viewButton).toBeVisible({ timeout: 10_000 });
    await viewButton.evaluate(element => (element as HTMLElement).click());

    const dialog = page.getByRole("dialog", { name: "View options" });
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const isDialogTopmost = await dialog.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = Math.min(rect.bottom - 24, rect.top + rect.height / 2);
      const topElement = document.elementFromPoint(x, y);

      return topElement === node || node.contains(topElement);
    });

    expect(isDialogTopmost).toBe(true);

    await dialog.getByRole("button", { name: "Close feed options" }).click();
    await expect(dialog).toBeHidden();
  });

  test("StakeSelector dialog opens on mobile", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 60_000);
    expect(await findVoteableContent(page)).toBe(true);

    await page.evaluate(eventName => window.dispatchEvent(new Event(eventName)), E2E_OPEN_STAKE_SELECTOR_EVENT);

    const dialog = page.locator("[role='dialog']").first();
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const confirmBtn = dialog.getByRole("button", { name: /confirm|vote|stake/i });
    const hasConfirm = await confirmBtn
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    expect(hasConfirm).toBe(true);

    await page.keyboard.press("Escape");
  });

  test("content source link opens the context externally", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 60_000);
    await expect(page.locator('article[aria-current="true"]').first()).toBeVisible({ timeout: 15_000 });

    const activeSourceLink = page.locator('[aria-current="true"] [data-testid="content-source-link"]').first();
    await expect(activeSourceLink).toBeVisible({ timeout: 10_000 });
    const expectedHref = await activeSourceLink.getAttribute("href");
    expect(expectedHref).toBeTruthy();

    const popupPromise = page.context().waitForEvent("page");
    await activeSourceLink.click();

    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    const expectedUrl = new URL(expectedHref!);
    const actualUrl = new URL(popup.url());
    expect(actualUrl.hostname.replace(/^m\./, "www.")).toBe(expectedUrl.hostname.replace(/^m\./, "www."));
    expect(actualUrl.pathname).toBe(expectedUrl.pathname);
    for (const [key, value] of expectedUrl.searchParams) {
      expect(actualUrl.searchParams.get(key)).toBe(value);
    }
  });

  test("ask page form is usable", async ({ connectedPage: page }) => {
    await page.goto("/ask");

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    await openAdvancedQuestionSettings(page);
    const contextInput = page.getByPlaceholder("Paste a source link, or add media context below");
    await expect(contextInput).toBeVisible({ timeout: 10_000 });
    await contextInput.focus();
    await expect(contextInput).toBeFocused();

    // No horizontal overflow
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test("governance page renders", async ({ page }) => {
    await gotoWithRetry(page, "/governance", { skipInjectedWalletConnectionCheck: true, timeout: 45_000 });

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    const governanceContent = main
      .getByRole("button", { name: /Profile|Leaderboard|Governance|rater credential/ })
      .or(main.getByText(/Voting performance|Staked LREP|Checking rater credential/i));
    await expect(governanceContent.first()).toBeVisible({ timeout: 15_000 });
  });

  test("docs page renders without overflow", async ({ page }) => {
    await gotoWithRetry(page, "/docs", { skipInjectedWalletConnectionCheck: true, timeout: 45_000 });

    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10_000 });

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});

test.describe("Public mobile header (phone)", () => {
  test.beforeEach(async ({ page }) => {
    await dismissBetaNotice(page);
  });

  test("mobile menu closes after navigating from a menu link", async ({ page }) => {
    await gotoWithRetry(page, "/?landing=1", { skipInjectedWalletConnectionCheck: true, timeout: 45_000 });
    await expect(page.getByRole("heading", { name: /Level Up Your Agent/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    const menu = page.locator("header details.dropdown").first();
    await page.locator('[data-mobile-header="true"]').getByLabel("Open menu").click();
    await expect(menu).toHaveAttribute("open", "");

    const docsLink = page
      .locator('[data-mobile-header="true"] .dropdown-content')
      .first()
      .getByRole("link", { name: /Docs/i });
    await expect(docsLink).toBeVisible({ timeout: 5_000 });
    await Promise.all([page.waitForURL(/\/docs/, { timeout: 15_000 }), docsLink.click()]);
    await expect(page.getByRole("heading", { name: /RateLoop\s+Introduction|Introduction/i }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(page.locator("header .dropdown-content").first()).toBeHidden();
  });
});
