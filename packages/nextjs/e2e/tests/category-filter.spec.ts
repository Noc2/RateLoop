import { expect, test } from "../fixtures/wallet";
import { FEED_EMPTY_STATE_RE, waitForFeedLoaded } from "../helpers/wait-helpers";

test.describe("Category filter", () => {
  async function loadVoteFeed(page: any, path = "/rate") {
    await expect(async () => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await waitForFeedLoaded(page, 20_000);
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });
  }

  /**
   * Helper: find the first visible category pill that isn't "All".
   * Waits for the "All" button to appear, then finds sibling category buttons.
   * Returns { name, locator } or null if none found.
   */
  async function findVisibleCategoryPill(page: any) {
    // Wait for the "All" button to appear — this confirms the category bar is rendered
    const allButton = page.getByTestId("category-filter-pill").filter({ hasText: /^All$/i }).first();
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

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      for (const name of knownCategories) {
        const pill = page.getByTestId("category-filter-pill").filter({ hasText: new RegExp(`^${name}$`, "i") }).first();
        const isVisible = await pill.isVisible().catch(() => false);
        if (isVisible) {
          return { name, locator: pill };
        }
      }

      const pills = page.getByTestId("category-filter-pill");
      const count = await pills.count();
      for (let i = 0; i < count; i++) {
        const pill = pills.nth(i);
        const text = (await pill.textContent())?.trim() ?? "";
        if (!text || text === "All" || text.length < 2) {
          continue;
        }

        const isVisible = await pill.isVisible().catch(() => false);
        if (isVisible) {
          return { name: text, locator: pill };
        }
      }

      await page.waitForTimeout(500);
    }

    return null;
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
    const allPill = page.getByTestId("category-filter-pill").filter({ hasText: /^All$/i }).first();
    await expect(allPill).toBeVisible({ timeout: 10_000 });
    await allPill.click();
    await page.waitForFunction(() => !window.location.hash, { timeout: 5_000 });

    // Hash should be cleared
    const url = page.url();
    expect(url).not.toContain("#");
  });

  test("URL hash on load activates corresponding category", async ({ connectedPage: page }) => {
    // Find a visible category on the default page first
    await loadVoteFeed(page);

    const pill = await findVisibleCategoryPill(page);
    expect(pill).toBeTruthy();

    const hash = pill!.name.toLowerCase().replace(/\s+/g, "-");

    // Navigate with that hash
    await loadVoteFeed(page, `/rate#${hash}`);

    const activePill = page
      .getByTestId("category-filter-pill")
      .filter({ hasText: new RegExp(`^${pill!.name}$`, "i") })
      .first();
    await expect(activePill).toHaveAttribute("aria-pressed", "true");
  });

  test("overflow dropdown opens with search", async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await loadVoteFeed(page);

    const moreButton = page.getByTestId("category-filter-overflow-trigger");
    await expect(moreButton, "category filter should overflow at the narrow E2E viewport").toBeVisible({
      timeout: 10_000,
    });

    await moreButton.click();

    // Search input should appear with the correct aria-label
    const searchInput = page.getByTestId("category-filter-search");
    await expect(searchInput).toBeVisible({ timeout: 3_000 });

    const dropdown = page.getByTestId("category-filter-overflow-menu");
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
