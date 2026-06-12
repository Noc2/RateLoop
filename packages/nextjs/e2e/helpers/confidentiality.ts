import {
  DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
  approveLREP,
  submitContentDirect,
  waitForPonderIndexed,
  type SubmissionConfidentialityConfig,
} from "./admin-helpers";
import { ANVIL_ACCOUNTS } from "./anvil-accounts";
import {
  continueToBountyStep,
  continueToFeedbackBonusStep,
  selectAskCategory,
  selectAskSubcategory,
  selectBountyRewardAsset,
} from "./ask-form";
import { getNamedSetCookie } from "./cookies";
import { CONTRACT_ADDRESSES } from "./contracts";
import { ponderGet } from "./ponder-api";
import { gotoWithRetry } from "./wait-helpers";
import { setupWallet } from "./wallet-session";
import { installLocalE2EWorldIdMock, readActiveHumanCredential } from "./world-id";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CONFIDENTIALITY_BOND_ASSET_LREP = 0;
export const CONFIDENTIALITY_BOND_ASSET_USDC = 1;
export const CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1;

type AnvilAccount = (typeof ANVIL_ACCOUNTS)[keyof typeof ANVIL_ACCOUNTS];

type SubmitGatedQuestionDirectConfig = {
  bondAmount?: bigint;
  bondAsset?: number;
  categoryId?: number | bigint;
  contentRegistryAddress?: string;
  contextUrl?: string;
  description: string;
  flags?: number;
  imageUrls?: readonly string[];
  rewardAmount?: bigint;
  rewardAsset?: number;
  rewardTokenAddress?: string;
  roundConfig?: { epochDuration: number; maxDuration: number; minVoters: number; maxVoters: number };
  submitter?: AnvilAccount;
  tags?: string;
  title: string;
  videoUrl?: string;
};

type SubmitGatedQuestionResult = {
  contentId: string;
  detailsUrl?: string | null;
  title: string;
};

type TermsAcceptanceInput = {
  contentHash?: string | null;
  contentId: string | bigint | number;
  detailsHash?: string | null;
  questionMetadataHash?: string | null;
};

function normalizeAssetName(asset: "LREP" | "USDC" | string) {
  return asset.trim().toUpperCase() === "USDC" ? "USDC" : "LREP";
}

function appendAddress(url: string, address?: string) {
  if (!address) return url;
  const parsed = new URL(url, "http://localhost:3000");
  parsed.searchParams.set("address", address);
  return parsed.pathname + parsed.search + parsed.hash;
}

function privateDetailsHash(description: string): Hex {
  return keccak256(toBytes(description.trim()));
}

export async function submitGatedQuestionDirect(config: SubmitGatedQuestionDirectConfig): Promise<boolean> {
  const submitter = config.submitter ?? ANVIL_ACCOUNTS.account2;
  const confidentiality: SubmissionConfidentialityConfig = {
    gated: true,
    bondAsset: config.bondAsset ?? CONFIDENTIALITY_BOND_ASSET_LREP,
    bondAmount: config.bondAmount ?? 0n,
    flags: config.flags ?? CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  };

  return submitContentDirect(
    config.contextUrl ?? "",
    config.title,
    config.description,
    config.tags ?? "test,private-context",
    config.categoryId ?? 1,
    submitter.address,
    config.contentRegistryAddress ?? CONTRACT_ADDRESSES.ContentRegistry,
    { imageUrls: config.imageUrls, videoUrl: config.videoUrl },
    config.rewardAmount,
    config.roundConfig,
    config.rewardAsset ?? DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
    config.rewardTokenAddress,
    {
      confidentiality,
      details: {
        detailsHash: privateDetailsHash(config.description),
        detailsUrl: "",
      },
    },
  );
}

export async function submitGatedQuestion(
  page: Page,
  {
    bondAmount = "0",
    bondAsset = "lrep",
    description,
    title,
  }: {
    bondAmount?: string;
    bondAsset?: "lrep" | "usdc";
    description: string;
    title: string;
  },
): Promise<SubmitGatedQuestionResult> {
  await gotoWithRetry(page, "/ask", { ensureWalletConnected: true });
  await selectAskCategory(page);

  const form = page.locator("form").first();
  await form.getByLabel("Private context").check();

  const titleInput = page.getByPlaceholder("Write a subjective question voters can rate");
  await expect(titleInput).toBeVisible({ timeout: 5_000 });
  await titleInput.fill(title);

  const descriptionInput = form.getByPlaceholder("Add context voters can expand before rating");
  await expect(descriptionInput).toBeVisible({ timeout: 5_000 });
  await descriptionInput.fill(description);

  await selectAskSubcategory(page);
  await continueToBountyStep(page);

  if (bondAmount !== "0") {
    await form.locator("#submission-confidentiality-bond-asset").selectOption(bondAsset);
    await form.locator("#submission-confidentiality-bond-amount").fill(bondAmount);
  }

  await selectBountyRewardAsset(page, "lrep");
  await continueToFeedbackBonusStep(page);
  await expect(page.getByRole("button", { name: /^No bonus$/i })).toHaveAttribute("aria-pressed", "true");

  const submitButton = page.getByRole("button", { name: /^Submit/i });
  await expect(submitButton).toBeEnabled({ timeout: 5_000 });
  const detailsUploadResponsePromise = page.waitForResponse(
    response => response.url().includes("/api/attachments/details/upload") && response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await submitButton.click();
  const detailsUploadResponse = await detailsUploadResponsePromise;
  expect(detailsUploadResponse.ok(), await detailsUploadResponse.text()).toBe(true);
  const detailsUpload = await detailsUploadResponse.json();
  const uploadedDetailsUrl = typeof detailsUpload.detailsUrl === "string" ? detailsUpload.detailsUrl : null;
  expect(uploadedDetailsUrl, "private browser submission should upload hosted details").toBeTruthy();

  const unlinkedDetails = await page.request.get(uploadedDetailsUrl!);
  expect(unlinkedDetails.status(), "pending gated hosted details should fail closed before content linkage").toBe(404);
  expect(unlinkedDetails.headers()["cache-control"]).toBe("private, no-store");

  await expect(page.getByRole("dialog", { name: /Question submitted/i })).toBeVisible({ timeout: 90_000 });

  let submitted: any;
  const indexed = await waitForPonderIndexed(
    async () => {
      const data = await ponderGet(`/content?status=all&search=${encodeURIComponent(title)}&limit=10`);
      submitted = data.items?.find((item: { title?: string }) => item.title === title);
      return Boolean(submitted);
    },
    90_000,
    2_000,
    "confidentiality:gated-question-indexed",
  );
  expect(indexed, "Ponder should index the gated browser submission").toBe(true);
  expect(submitted?.contextVisibility ?? submitted?.contextAccess).toBe("gated");

  const publicDetails = await page.request.get(uploadedDetailsUrl!);
  expect([401, 403], "linked gated details should require a signed session").toContain(publicDetails.status());
  expect(publicDetails.headers()["cache-control"]).toBe("private, no-store");

  return {
    contentId: String(submitted.id),
    detailsUrl: uploadedDetailsUrl,
    title,
  };
}

export async function acceptConfidentialityTerms(
  request: APIRequestContext,
  account: AnvilAccount,
  input: TermsAcceptanceInput,
): Promise<string> {
  const body = {
    address: account.address,
    contentHash: input.contentHash ?? undefined,
    contentId: input.contentId.toString(),
    detailsHash: input.detailsHash ?? undefined,
    questionMetadataHash: input.questionMetadataHash ?? undefined,
  };

  const challengeResponse = await request.post("/api/confidentiality/terms/challenge", {
    data: body,
  });
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  expect(typeof challenge.challengeId).toBe("string");
  expect(typeof challenge.message).toBe("string");

  const signer = privateKeyToAccount(account.privateKey);
  const signature = await signer.signMessage({ message: challenge.message });
  const acceptResponse = await request.post("/api/confidentiality/terms", {
    data: {
      ...body,
      challengeId: challenge.challengeId,
      signature,
      termsVersion: challenge.termsVersion,
    },
  });
  expect(acceptResponse.ok(), await acceptResponse.text()).toBe(true);

  const cookie = getNamedSetCookie(acceptResponse.headers(), "rateloop_gated_context_read_session");
  expect(cookie, "terms acceptance should return a gated context read-session cookie").toBeTruthy();
  return cookie!;
}

export async function postConfidentialityBond(page: Page, asset: "LREP" | "USDC" | string = "LREP") {
  const normalizedAsset = normalizeAssetName(asset);
  const button = page.getByRole("button", { name: new RegExp(`Post ${normalizedAsset} bond`, "i") });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  await expect(page.getByText("Confidentiality bond required")).toHaveCount(0, { timeout: 60_000 });
}

export async function fetchGatedAttachment(
  request: APIRequestContext,
  url: string,
  {
    address,
    cookie,
    expectedStatus = 200,
    kind = "details",
  }: {
    address?: string;
    cookie?: string;
    expectedStatus?: number;
    kind?: "details" | "image";
  } = {},
) {
  const response = await request.get(appendAddress(url, address), {
    headers: cookie ? { cookie } : undefined,
  });
  expect(response.status()).toBe(expectedStatus);
  expect(response.headers()["cache-control"]).toBe("private, no-store");

  if (expectedStatus === 200) {
    expect(response.headers()["x-rateloop-view-token"]).toMatch(/^[a-f0-9]{64}$/);
    if (kind === "image") {
      expect(response.headers()["content-type"]).toContain("image/webp");
      expect((await response.body()).byteLength).toBeGreaterThan(0);
    }
  }

  return response;
}

export async function ensureHumanCredential(page: Page, account: AnvilAccount): Promise<void> {
  if (await readActiveHumanCredential(account.address, CONTRACT_ADDRESSES.RaterRegistry)) {
    return;
  }

  await installLocalE2EWorldIdMock(page, account.address);
  await setupWallet(page, account.privateKey);
  await gotoWithRetry(page, "/settings#identity", { ensureWalletConnected: true });
  const verifyButton = page.getByRole("button", { name: "Verify with World ID" });
  await expect(verifyButton).toBeVisible({ timeout: 15_000 });
  await verifyButton.click();
  await expect(page.getByText("World ID verified")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => readActiveHumanCredential(account.address, CONTRACT_ADDRESSES.RaterRegistry)).toBe(true);
}

export async function triggerDisclosureReconcile(
  request: APIRequestContext,
  contentIds: Array<string | number | bigint>,
  settledAt?: Date,
) {
  const secret = process.env.NOTIFICATION_DELIVERY_SECRET;
  expect(secret, "NOTIFICATION_DELIVERY_SECRET must be set for disclosure reconciliation e2e").toBeTruthy();

  const response = await request.post("/api/confidentiality/disclosure/reconcile", {
    data: {
      contentIds: contentIds.map(contentId => contentId.toString()),
      settledAt: settledAt?.toISOString(),
    },
    headers: {
      authorization: `Bearer ${secret}`,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

export async function approveConfidentialityBondSpender(
  account: AnvilAccount,
  amount: bigint,
  tokenAddress = CONTRACT_ADDRESSES.LoopReputation,
) {
  return approveLREP(CONTRACT_ADDRESSES.ConfidentialityEscrow, amount, account.address, tokenAddress);
}
