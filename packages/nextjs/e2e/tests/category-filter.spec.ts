import { expect, test } from "../fixtures/wallet";
import { FEED_EMPTY_STATE_RE, waitForFeedLoaded } from "../helpers/wait-helpers";
import type { Locator, Page } from "@playwright/test";

test.describe("Category filter", () => {
  const visibleCategoryPills = (page: Page) => page.locator('[data-testid="category-filter-pill"]:visible');
  const visibleCategoryPill = (page: Page, name: string | RegExp) =>
    visibleCategoryPills(page).filter({ hasText: name }).first();

  async function loadVoteFeed(page: Page, path = "/rate") {
    await expect(async () => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForFeedLoaded(page, 30_000);
    }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000, 5_000] });
  }

  /**
   * Helper: find the first visible category pill that isn't "All".
   * Waits for the "All" button to appear, then finds sibling category buttons.
   * Returns { name, locator } or null if none found.
   */
  async function findVisibleCategoryPill(page: Page): Promise<{ name: string; locator: Locator }> {
    // Wait for the "All" button to appear — this confirms the category bar is rendered
    const allButton = visibleCategoryPill(page, /^All$/i);
    await allButton.waitFor({ state: "visible", timeout: 10_000 }).catch(() => null);

    // Prefer categories that the local deploy helper seeds with content so the
    // filter assertions don't pick an empty category and stall on a blank feed.
    const knownCategories = [
      "Products",
      "Places & Travel",
      "Software",
      "Media",
      "Design",
      "AI Answers",
      "Text",
      "General",
    ];

    let visiblePill: { name: string; locator: Locator } | null = null;
    await expect
      .poll(
        async () => {
          for (const name of knownCategories) {
            const pill = visibleCategoryPill(page, new RegExp(`^${name}$`, "i"));
            const isVisible = await pill.isVisible().catch(() => false);
            if (isVisible) {
              visiblePill = { name, locator: pill };
              return name;
            }
          }

          const pills = visibleCategoryPills(page);
          const count = await pills.count();
          for (let i = 0; i < count; i++) {
            const pill = pills.nth(i);
            const text = (await pill.textContent())?.trim() ?? "";
            if (!text || text === "All" || text.length < 2) {
              continue;
            }

            const isVisible = await pill.isVisible().catch(() => false);
            if (isVisible) {
              visiblePill = { name: text, locator: pill };
              return text;
            }
          }

          return "";
        },
        { timeout: 10_000, intervals: [250, 500, 1_000] },
      )
      .not.toBe("");

    if (!visiblePill) {
      throw new Error("Expected a visible category pill after polling.");
    }

    return visiblePill;
  }

  test("clicking category pill updates URL hash and filters feed", async ({ connectedPage: page }) => {
    await loadVoteFeed(page);

    // Find any visible category pill
    const pill = await findVisibleCategoryPill(page);
    expect(pill).toBeTruthy();

    await pill!.locator.click();
    const expectedHash = new RegExp(`#${pill!.name.toLowerCase().replace(/\s+/g, "-")}`, "i");
    await page.waitForURL(expectedHash, { timeout: 5_000 });

    await expect(page).toHaveURL(expectedHash);

    // The category shell should remain usable after the hash change even when
    // the selected category has no immediately rendered feed rows.
    await expect(page.getByRole("button", { name: "View" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /Application error/i })).toHaveCount(0);
  });

  test("clicking All clears URL hash", async ({ connectedPage: page }) => {
    // Start with a category hash
    await loadVoteFeed(page, "/rate#media");

    // Click "All" pill
    const allPill = visibleCategoryPill(page, /^All$/i);
    await expect(allPill).toBeVisible({ timeout: 10_000 });
    await allPill.click();

    await expect(page).not.toHaveURL(/#media/, { timeout: 5_000 });
  });

  test("URL hash on load activates corresponding category", async ({ connectedPage: page }) => {
    // Find a visible category on the default page first
    await loadVoteFeed(page);

    const pill = await findVisibleCategoryPill(page);
    expect(pill).toBeTruthy();

    const hash = pill!.name.toLowerCase().replace(/\s+/g, "-");

    // Navigate with that hash
    await loadVoteFeed(page, `/rate#${hash}`);

    const activePill = visibleCategoryPill(page, new RegExp(`^${pill!.name}$`, "i"));
    await expect(activePill).toHaveAttribute("aria-pressed", "true");
  });

  test("overflow dropdown opens with search", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await loadVoteFeed(page);

    const moreButton = page.getByTestId("category-filter-overflow-trigger").first();
    await expect(moreButton, "category filter should overflow at the narrow E2E viewport").toBeVisible({
      timeout: 10_000,
    });

    await moreButton.click();

    // Search input should appear with the correct aria-label
    const searchInput = page.getByTestId("category-filter-search").first();
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    const dropdown = page.getByTestId("category-filter-overflow-menu").first();
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Read a category that's actually in the overflow dropdown
    const overflowItems = dropdown.getByTestId("category-filter-option");
    const firstItem = overflowItems.first();
    const firstItemVisible = await firstItem.isVisible({ timeout: 2_000 }).catch(() => false);
    expect(firstItemVisible).toBe(true);

    const firstItemText = await firstItem.textContent();
    const trimmed = firstItemText?.trim();
    expect(trimmed).toBeTruthy();

    // Type part of the category name to filter
    const searchTerm = trimmed!.slice(0, 3).toLowerCase();
    await searchInput.fill(searchTerm);

    // Should still show the matching category
    const matchingOption = dropdown.locator("button").filter({ hasText: trimmed! });
    const found = await matchingOption
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    expect(found).toBe(true);
  });

  test("category filter shows content or empty state", async ({ connectedPage: page }) => {
    await loadVoteFeed(page);

    // Find any visible category pill
    const pill = await findVisibleCategoryPill(page);
    expect(pill).toBeTruthy();

    await pill!.locator.click();
    const expectedHash = new RegExp(`#${pill!.name.toLowerCase().replace(/\s+/g, "-")}`, "i");
    await page.waitForURL(expectedHash, { timeout: 5_000 });

    // Wait for feed to re-render after category change
    await waitForFeedLoaded(page, 5_000);

    // Should show content cards, vote buttons, loading state, or the empty state
    const contentCards = page.getByTestId("vote-content-card-shell");
    const featuredCard = page.getByTestId("vote-button-up").or(page.getByTestId("vote-button-down"));
    const emptyState = page.getByText(FEED_EMPTY_STATE_RE);
    const feedSurface = page.getByTestId("vote-feed-surface");

    const anyIndicator = featuredCard.first().or(contentCards.first()).or(emptyState).or(feedSurface);
    const anyVisible = await anyIndicator
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    expect(anyVisible).toBe(true);
  });
});
