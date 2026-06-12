import { expect, test } from "../fixtures/wallet";
import { getContentById } from "../helpers/ponder-api";
import { FEED_EMPTY_STATE_RE, VOTE_UP_BUTTON_NAME, gotoWithRetry, waitForFeedLoaded } from "../helpers/wait-helpers";

test.describe("Content feed", () => {
  test("displays content items at /rate", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    // The feed should show vote UI or an empty state — one of these must be visible
    const anyState = page
      .getByRole("button", { name: VOTE_UP_BUTTON_NAME })
      .or(page.getByText(/Voted(?: hidden| Up| Down)?/i))
      .or(page.getByText("Your question"))
      .or(page.getByText("Round full"))
      .or(page.getByText(/Cooldown/))
      .or(page.getByText(FEED_EMPTY_STATE_RE))
      .or(page.getByRole("feed", { name: "Content feed" }).getByRole("article"));
    await expect(anyState.first()).toBeVisible({ timeout: 15_000 });
  });

  test("category filter pills are visible", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    // "All" category pill should always be present — use .first() because the
    // CategoryFilter renders a hidden measurement row with duplicate buttons
    const allPill = page.getByRole("button", { name: /^All$/i }).first();
    await expect(allPill).toBeVisible({ timeout: 10_000 });
  });

  test("connected users see the feed scope filter pill", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const filterPill = page.getByRole("button", { name: /^View(?:: .+)?$/i }).first();
    await expect(filterPill).toBeVisible({ timeout: 10_000 });
  });

  test("requested content deep links open the requested item", async ({ connectedPage: page }) => {
    const { content } = await getContentById(1);

    await gotoWithRetry(page, "/rate?content=1", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const activeCard = page.locator('article[aria-current="true"]').first();
    await expect(activeCard.getByRole("heading", { name: content.title }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("unavailable requested content does not fall back to the first feed item", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate?content=999999999", { ensureWalletConnected: true, timeout: 45_000 });

    await expect(page.getByText("This content could not be shown.").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('article[aria-current="true"]')).toHaveCount(0);
  });

  test("clicking a video preview stays with the player", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate?q=short%20video", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    await expect(page.getByRole("heading", { name: /agent share this short video/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    const activeSurface = page.locator('[aria-current="true"] [data-testid="vote-content-surface"]').first();
    await expect(activeSurface).toBeVisible({ timeout: 10_000 });

    const popupPromise = page
      .context()
      .waitForEvent("page", { timeout: 1_000 })
      .catch(() => null);
    await activeSurface.click();

    const popup = await popupPromise;
    expect(popup).toBeNull();
  });

  test("explicit source links still open externally", async ({ connectedPage: page }) => {
    await gotoWithRetry(page, "/rate?q=workspace", { ensureWalletConnected: true, timeout: 45_000 });
    await waitForFeedLoaded(page, 30_000);

    const activeCard = page.locator('article[aria-current="true"]').first();
    const sourceLink = activeCard.getByTestId("content-source-link").first();
    await expect(sourceLink).toBeVisible({ timeout: 10_000 });
    const href = await sourceLink.getAttribute("href");
    expect(href).toBeTruthy();

    const popupPromise = page.context().waitForEvent("page");
    await sourceLink.click();

    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(href!);
  });
});
