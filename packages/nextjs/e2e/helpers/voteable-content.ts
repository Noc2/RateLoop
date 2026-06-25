import { approveLREP, submitContentDirect, waitForPonderIndexed, waitForPonderIndexedAfterSync } from "./admin-helpers";
import { ANVIL_ACCOUNTS } from "./anvil-accounts";
import { CONTRACT_ADDRESSES } from "./contracts";
import { getContentList } from "./ponder-api";
import type { ContentListParams } from "./ponder-api";
import { findVoteableContent, gotoWithRetry, waitForFeedLoaded } from "./wait-helpers";
import type { Page } from "@playwright/test";

const SUBMIT_STAKE = BigInt(10e6);
const FALLBACK_CONTENT_ATTEMPTS = 3;
export const FRESH_VOTEABLE_ROUND_CONFIG = {
  epochDuration: 2 * 60 * 60,
  maxDuration: 2 * 60 * 60,
  minVoters: 3,
  maxVoters: 100,
};

type ContentListItem = {
  id: string;
  title: string;
  submitter: string;
};

type EnsureVoteableContentDeps = {
  approveLREP: typeof approveLREP;
  submitContentDirect: typeof submitContentDirect;
  waitForPonderIndexed: typeof waitForPonderIndexed;
  getContentList: (params: ContentListParams) => Promise<{ items: ContentListItem[] }>;
  findVoteableContent: typeof findVoteableContent;
  gotoWithRetry: typeof gotoWithRetry;
  waitForFeedLoaded: typeof waitForFeedLoaded;
  now: () => number;
};

const defaultDeps: EnsureVoteableContentDeps = {
  approveLREP,
  submitContentDirect,
  waitForPonderIndexed,
  getContentList,
  findVoteableContent,
  gotoWithRetry,
  waitForFeedLoaded,
  now: () => Date.now(),
};

function createFallbackContentUrl(uniqueId: string, attempt: number): string {
  return `https://example.com/rateloop-responsive-vote-${uniqueId}-${attempt}`;
}

export async function createFreshVoteableContent(
  label: string,
  submitter = ANVIL_ACCOUNTS.account3.address,
): Promise<{ contentId: string; title: string } | null> {
  const uniqueId = Date.now().toString(36);
  const title = `${label} ${uniqueId}`;
  const approved = await approveLREP(
    CONTRACT_ADDRESSES.ContentRegistry,
    SUBMIT_STAKE,
    submitter,
    CONTRACT_ADDRESSES.LoopReputation,
  );
  if (!approved) return null;

  const submitted = await submitContentDirect(
    `https://example.com/rateloop-vote-${uniqueId}`,
    title,
    "Fresh deterministic content for UI vote transaction coverage.",
    "Technology,Testing,Video",
    1,
    submitter,
    CONTRACT_ADDRESSES.ContentRegistry,
    undefined,
    undefined,
    FRESH_VOTEABLE_ROUND_CONFIG,
  );
  if (!submitted) return null;

  let contentId: string | null = null;
  const indexed = await waitForPonderIndexedAfterSync(
    async () => {
      const { items } = await getContentList({ search: title, status: "all", limit: 5 });
      const match = items.find(
        item => item.title === title && item.submitter.toLowerCase() === submitter.toLowerCase(),
      );
      contentId = match?.id ?? null;
      return Boolean(contentId);
    },
    90_000,
    2_000,
    "createFreshVoteableContent",
  );

  return indexed && contentId ? { contentId, title } : null;
}

export async function ensureVoteableContentWithDeps(
  page: Page,
  deps: EnsureVoteableContentDeps = defaultDeps,
): Promise<boolean> {
  if (await deps.findVoteableContent(page)) {
    return true;
  }

  const submitter = ANVIL_ACCOUNTS.account3.address;
  const approved = await deps.approveLREP(
    CONTRACT_ADDRESSES.ContentRegistry,
    SUBMIT_STAKE,
    submitter,
    CONTRACT_ADDRESSES.LoopReputation,
  );
  if (!approved) {
    return false;
  }

  const uniqueId = deps.now().toString(36);
  for (let index = 0; index < FALLBACK_CONTENT_ATTEMPTS; index += 1) {
    const attempt = index + 1;
    const title = `Responsive Vote Layout ${uniqueId}-${attempt}`;
    const submitted = await deps.submitContentDirect(
      createFallbackContentUrl(uniqueId, attempt),
      title,
      "Deterministic content for responsive stake selector layout checks.",
      "Technology,Testing,Video",
      1,
      submitter,
      CONTRACT_ADDRESSES.ContentRegistry,
      undefined,
      undefined,
      FRESH_VOTEABLE_ROUND_CONFIG,
    );
    if (!submitted) {
      continue;
    }

    let indexedContentId: string | null = null;
    const indexed = await waitForPonderIndexedAfterSync(
      async () => {
        const { items } = await deps.getContentList({ status: "all", limit: 100 });
        const match = items.find(
          item => item.title === title && item.submitter.toLowerCase() === submitter.toLowerCase(),
        );
        indexedContentId = match?.id ?? null;
        return Boolean(indexedContentId);
      },
      90_000,
      2_000,
      "ensureVoteableContent",
    );
    if (!indexed || !indexedContentId) {
      continue;
    }
    const contentId = indexedContentId;

    const requestedContentReady = await waitForPonderIndexedAfterSync(
      async () => {
        const { items } = await deps.getContentList({
          contentIds: [contentId],
          status: "all",
          limit: 1,
          voteable: true,
        });
        return items.some(item => item.id === contentId && item.submitter.toLowerCase() === submitter.toLowerCase());
      },
      60_000,
      2_000,
      "ensureVoteableContent:requested-content",
    );
    if (!requestedContentReady) {
      continue;
    }

    await deps.gotoWithRetry(page, `/rate?content=${contentId}`, {
      ensureWalletConnected: true,
      timeout: 45_000,
    });
    await deps.waitForFeedLoaded(page, 30_000);
    await page
      .getByRole("heading", { name: title })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => undefined);

    if (await deps.findVoteableContent(page)) {
      return true;
    }
  }

  return false;
}

export async function ensureVoteableContent(page: Page): Promise<boolean> {
  return ensureVoteableContentWithDeps(page);
}
