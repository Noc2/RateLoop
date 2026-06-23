import type { ConsoleMessage, Locator, Page } from "@playwright/test";
import { waitForPonderIndexed } from "./admin-helpers";
import { getVotes } from "./ponder-api";
import {
  VOTE_DOWN_BUTTON_NAME,
  VOTE_UP_BUTTON_NAME,
  cycleVoteFeedForVisible,
  gotoWithRetry,
  waitForFeedLoaded,
} from "./wait-helpers";

type VoteSubmissionOptions = {
  voterAddress?: string;
  requireIndexed?: boolean;
  indexedTimeoutMs?: number;
};

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

async function getActiveVoteContentId(page: Page): Promise<string | null> {
  const urlContentId = new URL(page.url()).searchParams.get("content");
  if (urlContentId) return urlContentId;

  const contentId = await page
    .getByTestId("vote-content-card-shell")
    .first()
    .getAttribute("data-content-id")
    .catch(() => null);
  return contentId?.trim() || null;
}

async function waitForVoteIndexed(
  voterAddress: string | undefined,
  contentId: string | null,
  timeoutMs: number,
): Promise<boolean> {
  if (!voterAddress || !contentId) return true;

  const normalizedVoter = normalizeAddress(voterAddress);
  return waitForPonderIndexed(
    async () => {
      const { items } = await getVotes({ voter: normalizedVoter, contentId });
      return items.some(item => item.contentId === contentId && normalizeAddress(item.voter) === normalizedVoter);
    },
    timeoutMs,
    2_000,
    "waitForVoteIndexed",
  );
}

async function expectVoteButtonReady(page: Page, voteBtn: Locator): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visible = await voteBtn
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (visible) {
      return true;
    }

    if (attempt < 2) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await waitForFeedLoaded(page, 30_000).catch(() => undefined);
    }
  }

  return false;
}

/**
 * Try to vote on content. If the featured content has cooldown/own-content/round-full,
 * click through thumbnail grid items until we find voteable content.
 *
 * Returns true if the vote was successfully placed, false otherwise.
 * Handles transaction reverts gracefully by returning false instead of throwing.
 */
export async function voteOnContent(
  page: Page,
  direction: "up" | "down",
  options: VoteSubmissionOptions = {},
): Promise<boolean> {
  await gotoWithRetry(page, "/rate", { ensureWalletConnected: true });
  await waitForFeedLoaded(page);

  const voteBtn = page.getByRole("button", {
    name: direction === "up" ? VOTE_UP_BUTTON_NAME : VOTE_DOWN_BUTTON_NAME,
  });

  // Check if vote button is visible on the featured content (waitFor actually waits, unlike isVisible)
  let canVote = await voteBtn
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  // If not visible (cooldown, own content, round full), advance the snap feed.
  if (!canVote) {
    canVote = await cycleVoteFeedForVisible(page, voteBtn, { maxSteps: 6, timeout: 5_000 });
  }

  if (!canVote) {
    return false;
  }

  const contentId = await getActiveVoteContentId(page);

  // Click the vote button — retry if the element gets detached during a
  // React re-render (feed data polling can replace DOM nodes mid-click).
  let clicked = false;
  for (let retry = 0; retry < 2; retry++) {
    try {
      await voteBtn.waitFor({ state: "visible", timeout: 5_000 });
      await voteBtn.click({ timeout: 10_000 });
      clicked = true;
      break;
    } catch {
      // Element detached or not stable — retry
    }
  }
  if (!clicked) return false;

  // StakeSelector modal should appear (role="dialog")
  const stakeModal = page.locator("[role='dialog']").first();
  const modalVisible = await stakeModal
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!modalVisible) return false;

  // Click the "1" preset button (lowest stake)
  const presetBtn = stakeModal.getByRole("button", { name: /^1$/ });
  const presetVisible = await presetBtn
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (presetVisible) {
    await presetBtn.click();
  }

  // Click the confirm/stake button — text is "Stake {N} LREP"
  const confirmBtn = stakeModal.getByRole("button", { name: /Stake \d+/i });
  const confirmVisible = await confirmBtn
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!confirmVisible) return false;
  await confirmBtn.click();

  const shouldRequireIndexed = options.requireIndexed ?? Boolean(options.voterAddress);
  if (
    shouldRequireIndexed &&
    (await waitForVoteIndexed(options.voterAddress, contentId, options.indexedTimeoutMs ?? 60_000))
  ) {
    return true;
  }

  // Wait for EITHER success OR error — the contract call may revert.
  // NOTE: Do NOT match /success/i — scaffold-eth fires a generic
  // "Transaction completed successfully!" toast for the approve tx,
  // which would match before the actual vote completes.
  const successIndicator = page.getByText(/voted/i);

  const errorIndicator = page
    .getByText(/reverted/i)
    .or(page.getByText(/failed/i))
    .or(page.getByText(/rejected/i))
    .or(page.getByText(/not confirmed/i));

  const outcome = successIndicator.or(errorIndicator);

  try {
    await outcome.first().waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    // Timeout — no success or error indicator appeared
    return false;
  }

  // Check if it was a success or error
  const wasSuccess = await successIndicator
    .first()
    .isVisible()
    .catch(() => false);
  if (!wasSuccess) return false;

  if (shouldRequireIndexed) {
    return waitForVoteIndexed(options.voterAddress, contentId, options.indexedTimeoutMs ?? 60_000);
  }

  return true;
}

/**
 * Vote on a specific content item by navigating to /rate?content={contentId}.
 * Same flow as voteOnContent but targets a known content ID.
 *
 * Returns true if the vote was successfully placed, false otherwise.
 */
export async function voteOnSpecificContent(
  page: Page,
  contentId: string | number,
  direction: "up" | "down",
  options: VoteSubmissionOptions = {},
): Promise<boolean> {
  const diagnostics: string[] = [];
  const recordConsole = (message: ConsoleMessage) => {
    const type = message.type();
    const text = message.text();
    if (type === "error" || type === "warning") {
      diagnostics.push(`[${type}] ${text}`);
    }
  };
  const recordPageError = (error: Error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  };
  page.on("console", recordConsole);
  page.on("pageerror", recordPageError);
  const fail = async (reason: string) => {
    const modalText = await page
      .locator("[role='dialog']")
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    console.warn("[voteOnSpecificContent] vote failed", {
      contentId: contentId.toString(),
      diagnostics: diagnostics.slice(-8),
      direction,
      modalText,
      reason,
    });
    page.off("console", recordConsole);
    page.off("pageerror", recordPageError);
    return false;
  };

  await gotoWithRetry(page, `/rate?content=${contentId}`, { ensureWalletConnected: true });
  await waitForFeedLoaded(page, 30_000);

  const voteBtn = page.getByRole("button", {
    name: direction === "up" ? VOTE_UP_BUTTON_NAME : VOTE_DOWN_BUTTON_NAME,
  });

  const canVote = await expectVoteButtonReady(page, voteBtn);

  if (!canVote) return fail("vote button not visible");

  // Click with retry for React re-renders
  let clicked = false;
  for (let retry = 0; retry < 2; retry++) {
    try {
      await voteBtn.waitFor({ state: "visible", timeout: 5_000 });
      await voteBtn.click({ timeout: 10_000 });
      clicked = true;
      break;
    } catch {
      // Element detached — retry
    }
  }
  if (!clicked) return fail("vote button click failed");

  // StakeSelector modal
  const stakeModal = page.locator("[role='dialog']").first();
  const modalVisible = await stakeModal
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(async () => {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await waitForFeedLoaded(page, 30_000).catch(() => undefined);
      const recoveredVoteBtn = page.getByRole("button", {
        name: direction === "up" ? VOTE_UP_BUTTON_NAME : VOTE_DOWN_BUTTON_NAME,
      });
      const recoveredCanVote = await expectVoteButtonReady(page, recoveredVoteBtn);
      if (!recoveredCanVote) return false;
      await recoveredVoteBtn.click({ timeout: 10_000 }).catch(() => undefined);
      return stakeModal
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
    });
  if (!modalVisible) return fail("stake modal not visible");

  // Click "1" preset (lowest stake = 1 LREP)
  const presetBtn = stakeModal.getByRole("button", { name: /^1$/ });
  if (
    await presetBtn
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await presetBtn.click();
  }

  // Confirm
  const confirmBtn = stakeModal.getByRole("button", { name: /Stake \d+/i });
  if (
    !(await confirmBtn
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false))
  ) {
    return fail("confirm button not visible");
  }
  await confirmBtn.click();

  const shouldRequireIndexed = options.requireIndexed ?? Boolean(options.voterAddress);
  if (
    shouldRequireIndexed &&
    (await waitForVoteIndexed(options.voterAddress, contentId.toString(), options.indexedTimeoutMs ?? 60_000))
  ) {
    page.off("console", recordConsole);
    page.off("pageerror", recordPageError);
    return true;
  }

  // Wait for outcome — avoid /success/i which matches the approve tx toast
  const successIndicator = page.getByText(/voted/i);

  const errorIndicator = page
    .getByText(/reverted/i)
    .or(page.getByText(/failed/i))
    .or(page.getByText(/rejected/i))
    .or(page.getByText(/not confirmed/i));

  try {
    await successIndicator.or(errorIndicator).first().waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    return fail("timed out waiting for vote outcome");
  }

  const wasSuccess = await successIndicator
    .first()
    .isVisible()
    .catch(() => false);
  if (!wasSuccess) return fail("vote error indicator appeared");

  if (shouldRequireIndexed) {
    const indexed = await waitForVoteIndexed(
      options.voterAddress,
      contentId.toString(),
      options.indexedTimeoutMs ?? 60_000,
    );
    page.off("console", recordConsole);
    page.off("pageerror", recordPageError);
    return indexed;
  }

  page.off("console", recordConsole);
  page.off("pageerror", recordPageError);
  return true;
}
