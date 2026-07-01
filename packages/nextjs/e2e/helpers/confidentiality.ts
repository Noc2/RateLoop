import {
  DEFAULT_SUBMISSION_REWARD_ASSET_LREP,
  type SubmissionConfidentialityConfig,
  approveLREP,
  readTokenBalance,
  submitContentDirect,
  submitContentDirectWithResult,
  transferLREP,
  waitForPonderIndexed,
} from "./admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "./anvil-accounts";
import {
  continueToBountyStep,
  continueToFeedbackBonusStep,
  expectNoFeedbackBonusSelectedIfVisible,
  selectAskCategory,
  selectAskSubcategory,
  selectBountyRewardAsset,
} from "./ask-form";
import { CONTRACT_ADDRESSES } from "./contracts";
import { getNamedSetCookie } from "./cookies";
import { ponderGet } from "./ponder-api";
import { E2E_BASE_URL, E2E_RPC_URL } from "./service-urls";
import { gotoWithRetry } from "./wait-helpers";
import { setupWallet } from "./wallet-session";
import { installLocalE2EWorldIdMock, readActiveHumanCredential } from "./world-id";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ConfidentialityEscrowAbi, RaterRegistryAbi, RaterRegistryConfidentialityAbi } from "@rateloop/contracts/abis";
import { createHash } from "node:crypto";
import {
  type Hex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  maxUint64,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const CONFIDENTIALITY_BOND_ASSET_LREP = 0;
export const CONFIDENTIALITY_BOND_ASSET_USDC = 1;
export const CONFIDENTIALITY_FLAG_PRIVATE_FOREVER = 1;
const E2E_CONFIDENTIALITY_NEXUS_BOND_AMOUNT = 1_000_000n;
const LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET = "rateloop-local-e2e-confidentiality-job-secret";
const E2E_CONTENT_DEPLOYMENT_KEY = `${foundry.id}:${CONTRACT_ADDRESSES.ContentRegistry.toLowerCase()}`;
const RETRYABLE_API_REQUEST_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_CONNECTION_REFUSED/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /Target page, context or browser has been closed/i,
];

function isRetryableApiRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_API_REQUEST_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function getE2EFrontendAddress(): `0x${string}` {
  return getAddress(process.env.NEXT_PUBLIC_FRONTEND_CODE ?? DEPLOYER.address) as `0x${string}`;
}

function isLocalE2EBaseUrl(): boolean {
  try {
    const url = new URL(E2E_BASE_URL);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function getDisclosureReconcileSecret(): string | undefined {
  return (
    process.env.RATELOOP_CONFIDENTIALITY_JOB_SECRET ??
    process.env.CRON_SECRET ??
    process.env.NOTIFICATION_DELIVERY_SECRET ??
    (isLocalE2EBaseUrl() ? LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET : undefined)
  );
}

async function postJsonWithRequestRetry(
  request: APIRequestContext,
  url: string,
  data: unknown,
  attempts = 3,
): Promise<APIResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request.post(url, { data });
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableApiRequestError(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function getWithRequestRetry(
  request: APIRequestContext,
  url: string,
  options?: Parameters<APIRequestContext["get"]>[1],
  attempts = 3,
): Promise<APIResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await request.get(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableApiRequestError(error)) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

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

type UploadedGatedQuestionDetails = {
  detailsHash: Hex;
  detailsId: string;
  detailsUrl: string;
  text: string;
};

type SubmitHostedGatedQuestionDirectResult = SubmitGatedQuestionResult & {
  detailsHash: Hex;
  transactionHash: Hex;
};

type DisclosurePolicy = "after_settlement" | "private_forever";

type TermsAcceptanceInput = {
  contentHash?: string | null;
  contentId: string | bigint | number;
  detailsHash?: string | null;
  questionMetadataHash?: string | null;
};

type ResolvedConfidentialRater = {
  delegated: boolean;
  hasActiveHumanCredential: boolean;
  holder: `0x${string}`;
  humanNullifier: Hex;
  humanCredentialProvider: number;
  identityKey: Hex;
};

function indexedContentIsGated(item: any) {
  return (
    item?.contextVisibility === "gated" ||
    item?.contextAccess === "gated" ||
    item?.confidentiality?.visibility === "gated"
  );
}

function indexedConfidentialityState(item: any) {
  return JSON.stringify({
    contextAccess: item?.contextAccess,
    contextVisibility: item?.contextVisibility,
    confidentiality: item?.confidentiality,
    id: item?.id,
  });
}

const confidentialityPublicClient = createPublicClient({
  chain: foundry,
  transport: http(E2E_RPC_URL),
});
let e2eDbPool: import("pg").Pool | null = null;

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

function sha256Hex(value: string): Hex {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function gatedDetailsHash(detailsId: string, normalizedText: string): Hex {
  return sha256Hex(["rateloop.gated-question-details.v1", detailsId, normalizedText].join("\n"));
}

function createDetailsId() {
  return `det_e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function parseDetailsIdFromDetailsUrl(detailsUrl: string) {
  try {
    const parsed = new URL(detailsUrl, "http://localhost:3000");
    const detailsId = parsed.pathname.split("/").filter(Boolean).pop();
    return detailsId && detailsId.startsWith("det_") ? detailsId : null;
  } catch {
    return null;
  }
}

async function getE2EDbPool() {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL must be set for confidentiality e2e database setup").toBeTruthy();
  const { Pool } = await import("pg");
  e2eDbPool ??= new Pool({ connectionString: databaseUrl, max: 2 });
  return e2eDbPool;
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

export async function uploadGatedQuestionDetails(
  request: APIRequestContext,
  account: AnvilAccount,
  text: string,
): Promise<UploadedGatedQuestionDetails> {
  const normalizedText = text.trim();
  const detailsId = createDetailsId();
  const detailsHash = gatedDetailsHash(detailsId, normalizedText);
  const body = {
    address: account.address,
    detailsId,
    requiresGatedAccess: true,
    sha256: detailsHash.slice(2),
    sizeBytes: new TextEncoder().encode(normalizedText).byteLength,
  };

  const challengeResponse = await request.post("/api/attachments/details/challenge", { data: body });
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  expect(typeof challenge.challengeId).toBe("string");
  expect(typeof challenge.message).toBe("string");

  const signer = privateKeyToAccount(account.privateKey);
  const signature = await signer.signMessage({ message: challenge.message });
  const uploadResponse = await request.post("/api/attachments/details/upload", {
    data: {
      ...body,
      challengeId: challenge.challengeId,
      signature,
      text: normalizedText,
    },
  });
  expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);
  const uploaded = await uploadResponse.json();
  expect(uploaded.status).toBe("approved");
  expect(uploaded.detailsHash).toBe(detailsHash);
  expect(typeof uploaded.detailsUrl).toBe("string");

  return {
    detailsHash,
    detailsId,
    detailsUrl: uploaded.detailsUrl,
    text: normalizedText,
  };
}

export async function submitHostedGatedQuestionDirect(
  config: SubmitGatedQuestionDirectConfig & {
    detailsHash: Hex;
    detailsUrl: string;
  },
): Promise<SubmitHostedGatedQuestionDirectResult> {
  const submitter = config.submitter ?? ANVIL_ACCOUNTS.account2;
  const confidentiality: SubmissionConfidentialityConfig = {
    gated: true,
    bondAsset: config.bondAsset ?? CONFIDENTIALITY_BOND_ASSET_LREP,
    bondAmount: config.bondAmount ?? 0n,
    flags: config.flags ?? CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  };

  const result = await submitContentDirectWithResult(
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
        detailsHash: config.detailsHash,
        detailsUrl: "",
      },
    },
  );
  expect(
    result.success,
    `Hosted gated direct question submission should succeed${
      result.reason || result.error ? ` (${result.reason ?? result.error})` : ""
    }`,
  ).toBe(true);
  expect(result.txHash, "Hosted gated direct question submission should return a transaction hash").toBeTruthy();

  let submitted: any;
  const indexedAsGated = await waitForPonderIndexed(
    async () => {
      const data = await ponderGet(`/content?status=all&search=${encodeURIComponent(config.title)}&limit=10`);
      submitted = data.items?.find((item: { title?: string }) => item.title === config.title);
      return indexedContentIsGated(submitted);
    },
    90_000,
    2_000,
    "confidentiality:hosted-gated-question-indexed",
  );
  expect(
    indexedAsGated,
    `Ponder should index the hosted gated direct submission as gated; last indexed state: ${indexedConfidentialityState(
      submitted,
    )}`,
  ).toBe(true);
  expect(submitted?.id, "Hosted gated direct submission should have a content id").toBeTruthy();

  return {
    contentId: String(submitted.id),
    detailsHash: config.detailsHash,
    detailsUrl: config.detailsUrl,
    title: config.title,
    transactionHash: result.txHash!,
  };
}

export async function attachHostedQuestionDetails(
  request: APIRequestContext,
  submission: Pick<
    SubmitHostedGatedQuestionDirectResult,
    "contentId" | "detailsHash" | "detailsUrl" | "transactionHash"
  >,
) {
  const response = await request.post("/api/attachments/details/attach", {
    data: {
      chainId: 31337,
      transactionHashes: [submission.transactionHash],
      details: [
        {
          contentId: submission.contentId,
          detailsHash: submission.detailsHash,
          detailsUrl: submission.detailsUrl,
        },
      ],
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  expect(body.attached, "Hosted details attach route should link the submitted details").toBeGreaterThanOrEqual(1);
  return body;
}

export async function upsertQuestionConfidentialityForE2E({
  bondAmount = "0",
  bondAsset = "LREP",
  contentId,
  detailsHash,
  disclosurePolicy,
}: {
  bondAmount?: string;
  bondAsset?: "LREP" | "USDC";
  contentId: string;
  detailsHash?: Hex;
  disclosurePolicy: DisclosurePolicy;
}) {
  const pool = await getE2EDbPool();
  await pool.query(
    `
      insert into question_confidentiality (
        deployment_key,
        frontend_address,
        chain_id,
        content_registry_address,
        content_id,
        gated,
        bond_asset,
        bond_amount,
        disclosure_policy,
        published_at,
        details_hash,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, true, $6, $7, $8, null, $9, now(), now())
      on conflict (deployment_key, frontend_address, content_id) do update set
        chain_id = excluded.chain_id,
        content_registry_address = excluded.content_registry_address,
        gated = excluded.gated,
        bond_asset = excluded.bond_asset,
        bond_amount = excluded.bond_amount,
        disclosure_policy = excluded.disclosure_policy,
        published_at = null,
        details_hash = excluded.details_hash,
        updated_at = now()
    `,
    [
      E2E_CONTENT_DEPLOYMENT_KEY,
      getE2EFrontendAddress(),
      foundry.id,
      CONTRACT_ADDRESSES.ContentRegistry.toLowerCase(),
      contentId,
      bondAsset,
      bondAmount,
      disclosurePolicy,
      detailsHash ?? null,
    ],
  );
}

async function replaceGatedQuestionDetailsLinkForE2E({
  bondAmount,
  bondAsset,
  contentId,
  detailsHash,
  detailsId,
}: {
  bondAmount: string;
  bondAsset: "lrep" | "usdc";
  contentId: string;
  detailsHash: Hex;
  detailsId: string;
}) {
  const pool = await getE2EDbPool();
  await pool.query(
    `
      delete from question_details
      where content_id = $2
        and id <> $3
        and (deployment_key is null or deployment_key = $1 or chain_id = $4)
    `,
    [E2E_CONTENT_DEPLOYMENT_KEY, contentId, detailsId, foundry.id],
  );
  const linked = await pool.query(
    `
      update question_details
      set deployment_key = $1,
          chain_id = $2,
          content_registry_address = $3,
          content_id = $4,
          requires_gated_access = true,
          updated_at = now()
      where id = $5
      returning id
    `,
    [E2E_CONTENT_DEPLOYMENT_KEY, foundry.id, CONTRACT_ADDRESSES.ContentRegistry.toLowerCase(), contentId, detailsId],
  );
  expect(linked.rowCount, "current gated question details should be linked to the submitted content").toBe(1);
  await upsertQuestionConfidentialityForE2E({
    bondAmount,
    bondAsset: normalizeAssetName(bondAsset) as "LREP" | "USDC",
    contentId,
    detailsHash,
    disclosurePolicy: "private_forever",
  });
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
  await form.getByRole("checkbox", { name: "Private context" }).check();

  const titleInput = page.getByPlaceholder("Write a subjective question voters can rate");
  await expect(titleInput).toBeVisible({ timeout: 5_000 });
  await titleInput.fill(title);

  const descriptionInput = form.getByPlaceholder("Add context voters can expand before rating");
  await expect(descriptionInput).toBeVisible({ timeout: 5_000 });
  await descriptionInput.fill(description);

  await selectAskSubcategory(page);
  await continueToBountyStep(page);

  if (bondAmount !== "0") {
    const normalizedBondAsset = normalizeAssetName(bondAsset);
    const bondAssetSelect = form.locator("#submission-confidentiality-bond-asset");
    await bondAssetSelect.selectOption(normalizedBondAsset);
    await expect(bondAssetSelect).toHaveValue(normalizedBondAsset);
    await form.locator("#submission-confidentiality-bond-amount").fill(bondAmount);
  }

  await selectBountyRewardAsset(page, "lrep");
  await continueToFeedbackBonusStep(page);
  await expectNoFeedbackBonusSelectedIfVisible(page);

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
  const uploadedDetailsHash = typeof detailsUpload.detailsHash === "string" ? detailsUpload.detailsHash : null;
  expect(uploadedDetailsHash, "private browser submission should return a hosted details hash").toMatch(
    /^0x[a-fA-F0-9]{64}$/,
  );
  const uploadedDetailsId = parseDetailsIdFromDetailsUrl(uploadedDetailsUrl!);
  expect(uploadedDetailsId, "private browser submission should return a hosted details id").toBeTruthy();

  const uploadedDetailsPath = new URL(uploadedDetailsUrl!).pathname;
  const unlinkedDetails = await getWithRequestRetry(page.request, uploadedDetailsPath);
  expect(unlinkedDetails.status(), "pending gated hosted details should fail closed before content linkage").toBe(404);
  expect(unlinkedDetails.headers()["cache-control"]).toBe("private, no-store");

  await page
    .getByRole("dialog", { name: /Question submitted/i })
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);

  let submitted: any;
  const indexedAsGated = await waitForPonderIndexed(
    async () => {
      const data = await ponderGet(`/content?status=all&search=${encodeURIComponent(title)}&limit=10`);
      submitted = data.items?.find((item: { title?: string }) => item.title === title);
      return indexedContentIsGated(submitted);
    },
    90_000,
    2_000,
    "confidentiality:gated-question-indexed",
  );
  expect(
    indexedAsGated,
    `Ponder should index the gated browser submission as gated; last indexed state: ${indexedConfidentialityState(
      submitted,
    )}`,
  ).toBe(true);
  await replaceGatedQuestionDetailsLinkForE2E({
    bondAmount,
    bondAsset,
    contentId: String(submitted.id),
    detailsHash: uploadedDetailsHash as Hex,
    detailsId: uploadedDetailsId!,
  });

  const publicDetails = await getWithRequestRetry(page.request, uploadedDetailsPath);
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

  const challengeResponse = await postJsonWithRequestRetry(request, "/api/confidentiality/terms/challenge", body);
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  expect(typeof challenge.challengeId).toBe("string");
  expect(typeof challenge.message).toBe("string");

  const signer = privateKeyToAccount(account.privateKey);
  const signature = await signer.signMessage({ message: challenge.message });
  const acceptResponse = await postJsonWithRequestRetry(request, "/api/confidentiality/terms", {
    ...body,
    challengeId: challenge.challengeId,
    signature,
    termsVersion: challenge.termsVersion,
  });
  expect(acceptResponse.ok(), await acceptResponse.text()).toBe(true);

  const cookie =
    getNamedSetCookie(acceptResponse.headersArray(), "rateloop_gated_context_read_session") ??
    getNamedSetCookie(acceptResponse.headers(), "rateloop_gated_context_read_session");
  expect(cookie, "terms acceptance should return a gated context read-session cookie").toBeTruthy();
  return cookie!;
}

export async function createPrivateAccountReadSessionCookie(
  request: APIRequestContext,
  account: AnvilAccount,
): Promise<string> {
  const challengeResponse = await request.post("/api/account/private-session/challenge", {
    data: { address: account.address, scope: "owner_context" },
  });
  expect(challengeResponse.ok(), await challengeResponse.text()).toBe(true);
  const challenge = await challengeResponse.json();
  expect(typeof challenge.challengeId).toBe("string");
  expect(typeof challenge.message).toBe("string");

  const signer = privateKeyToAccount(account.privateKey);
  const signature = await signer.signMessage({ message: challenge.message });
  const sessionResponse = await request.post("/api/account/private-session", {
    data: {
      address: account.address,
      challengeId: challenge.challengeId,
      scope: "owner_context",
      signature,
    },
  });
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true);

  const cookie =
    getNamedSetCookie(sessionResponse.headersArray(), "rateloop_owner_context_read_session") ??
    getNamedSetCookie(sessionResponse.headers(), "rateloop_owner_context_read_session");
  expect(cookie, "private account session should return an owner context read-session cookie").toBeTruthy();
  return cookie!;
}

export async function postConfidentialityBond(page: Page, asset: "LREP" | "USDC" | string = "LREP") {
  const normalizedAsset = normalizeAssetName(asset);
  const button = page.getByRole("button", { name: new RegExp(`^Post ${normalizedAsset} bond$`, "i") }).first();
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
  const response = await getWithRequestRetry(request, appendAddress(url, address), {
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

export async function seedAnchoredLogRootForViewToken(viewToken: string) {
  expect(viewToken).toMatch(/^[a-f0-9]{64}$/);
  const pool = await getE2EDbPool();
  const accessResult = await pool.query<{
    chain_id: number | null;
    content_registry_address: string | null;
    deployment_key: string;
    frontend_address: string;
    viewed_at: Date | string;
  }>(
    `
      select chain_id, content_registry_address, deployment_key, frontend_address, viewed_at
        from confidential_context_access_logs
       where view_token = $1
       limit 1
    `,
    [viewToken],
  );
  expect(accessResult.rowCount, "view token should have a matching access log").toBe(1);

  const accessLog = accessResult.rows[0]!;
  const deploymentKey = accessLog.deployment_key;
  const frontendAddress = getAddress(accessLog.frontend_address);
  const viewedAt = new Date(accessLog.viewed_at);
  const epoch = viewedAt.toISOString().slice(0, 10);
  const intervalStart = new Date(`${epoch}T00:00:00.000Z`);
  const intervalEnd = new Date(intervalStart.getTime() + 24 * 60 * 60 * 1000);
  const countResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
        from confidential_context_access_logs
       where deployment_key = $1
         and frontend_address = $2
         and viewed_at >= $3
         and viewed_at < $4
    `,
    [deploymentKey, frontendAddress, intervalStart, intervalEnd],
  );
  const merkleRoot = sha256Hex(`e2e-confidentiality-log-root:${deploymentKey}:${epoch}`);
  const artifactUrl = `https://rateloop.ai/api/confidentiality/log-roots/${epoch}/artifact?deploymentKey=${encodeURIComponent(
    deploymentKey,
  )}&frontendAddress=${frontendAddress}`;
  const artifact = {
    schemaVersion: "rateloop.confidentiality-log-root.v3",
    epoch,
    deploymentKey,
    frontendAddress,
    chainId: accessLog.chain_id,
    contentRegistryAddress: accessLog.content_registry_address,
    intervalStart: intervalStart.toISOString(),
    intervalEnd: intervalEnd.toISOString(),
    merkleRoot,
    acceptanceCount: 0,
    accessCount: Number(countResult.rows[0]?.count ?? 1),
    leaves: [],
  };
  const artifactJson = JSON.stringify(artifact);
  const artifactHash = sha256Hex(artifactJson);
  const anchorTxHash = sha256Hex(`e2e-confidentiality-log-root-anchor:${deploymentKey}:${epoch}`);
  await pool.query(
    `
      insert into confidentiality_log_roots (
        deployment_key,
        frontend_address,
        chain_id,
        content_registry_address,
        epoch,
        merkle_root,
        acceptance_count,
        access_count,
        artifact_url,
        artifact_hash,
        artifact_json,
        anchor_chain_id,
        anchor_contract,
        anchor_tx_hash,
        anchor_published_at,
        published_at,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, 31337, $11, $12, now(), now(), now())
      on conflict (deployment_key, frontend_address, epoch) do update set
        anchor_chain_id = excluded.anchor_chain_id,
        anchor_contract = excluded.anchor_contract,
        anchor_tx_hash = excluded.anchor_tx_hash,
        anchor_published_at = excluded.anchor_published_at,
        artifact_hash = excluded.artifact_hash,
        artifact_json = excluded.artifact_json,
        artifact_url = excluded.artifact_url,
        merkle_root = excluded.merkle_root
    `,
    [
      deploymentKey,
      frontendAddress,
      accessLog.chain_id,
      accessLog.content_registry_address,
      epoch,
      merkleRoot,
      Number(countResult.rows[0]?.count ?? 1),
      artifactUrl,
      artifactHash,
      artifactJson,
      CONTRACT_ADDRESSES.ConfidentialityEscrow,
      anchorTxHash,
    ],
  );
  return { anchorTxHash, artifactHash, epoch, merkleRoot };
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
  const secret = getDisclosureReconcileSecret();
  expect(
    secret,
    "RATELOOP_CONFIDENTIALITY_JOB_SECRET or CRON_SECRET must be set for disclosure reconciliation e2e",
  ).toBeTruthy();

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

export async function resolveConfidentialRater(account: AnvilAccount): Promise<ResolvedConfidentialRater> {
  const resolved = await confidentialityPublicClient.readContract({
    address: CONTRACT_ADDRESSES.RaterRegistry,
    abi: RaterRegistryAbi,
    functionName: "resolveRater",
    args: [account.address],
  });
  const credential = await confidentialityPublicClient.readContract({
    address: CONTRACT_ADDRESSES.RaterRegistry,
    abi: RaterRegistryAbi,
    functionName: "getHumanCredential",
    args: [account.address],
  });

  return {
    delegated: Boolean(resolved.delegated),
    hasActiveHumanCredential: Boolean(resolved.hasActiveHumanCredential),
    holder: resolved.holder as `0x${string}`,
    humanNullifier: resolved.humanNullifier as Hex,
    humanCredentialProvider: Number(credential.provider),
    identityKey: resolved.identityKey as Hex,
  };
}

async function hasConfidentialityNexus(provider: number, nullifier: Hex) {
  return confidentialityPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ConfidentialityEscrow,
    abi: ConfidentialityEscrowAbi,
    functionName: "hasConfidentialityNexus",
    args: [provider, nullifier],
  });
}

async function ensureConfidentialityNexus(account: AnvilAccount, resolved: ResolvedConfidentialRater) {
  if (await hasConfidentialityNexus(resolved.humanCredentialProvider, resolved.humanNullifier)) return;

  const uniqueId = Date.now();
  const title = `E2E confidentiality ban nexus ${uniqueId}`;
  const submitted = await submitGatedQuestionDirect({
    bondAmount: E2E_CONFIDENTIALITY_NEXUS_BOND_AMOUNT,
    description: `Private bond nexus for ${account.address} ${uniqueId}`,
    submitter: ANVIL_ACCOUNTS.account2,
    title,
  });
  expect(submitted, "E2E ban nexus question submission should succeed").toBe(true);

  let contentId: string | null = null;
  const indexed = await waitForPonderIndexed(
    async () => {
      const data = await ponderGet(`/content?status=all&search=${encodeURIComponent(title)}&limit=10`);
      const match = data.items?.find((item: { title?: string }) => item.title === title);
      contentId = match?.id ? String(match.id) : null;
      return Boolean(contentId);
    },
    90_000,
    2_000,
    "confidentiality:ban-nexus-question-indexed",
  );
  expect(indexed, "E2E ban nexus question should be indexed").toBe(true);
  expect(contentId, "E2E ban nexus question should have a content id").toBeTruthy();

  const balance = await readTokenBalance(account.address, CONTRACT_ADDRESSES.LoopReputation);
  if (balance < E2E_CONFIDENTIALITY_NEXUS_BOND_AMOUNT) {
    const funded = await transferLREP(
      account.address,
      E2E_CONFIDENTIALITY_NEXUS_BOND_AMOUNT - balance,
      DEPLOYER.address,
      CONTRACT_ADDRESSES.LoopReputation,
    );
    expect(funded, "E2E ban nexus account funding should succeed").toBe(true);
  }

  const approved = await approveConfidentialityBondSpender(account, E2E_CONFIDENTIALITY_NEXUS_BOND_AMOUNT);
  expect(approved, "E2E ban nexus bond approval should succeed").toBe(true);
  await postConfidentialityBondDirect(account, contentId!);
  await expect
    .poll(() => hasConfidentialityNexus(resolved.humanCredentialProvider, resolved.humanNullifier), {
      intervals: [500, 1_000, 2_000],
      timeout: 30_000,
    })
    .toBe(true);
}

export async function postConfidentialityBondDirect(account: AnvilAccount, contentId: string | number | bigint) {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(account.privateKey),
    chain: foundry,
    transport: http(E2E_RPC_URL),
  });
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.ConfidentialityEscrow,
    abi: ConfidentialityEscrowAbi,
    functionName: "postBond",
    args: [BigInt(contentId)],
  });
  const receipt = await confidentialityPublicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status, `Confidentiality bond post failed for ${account.address}`).toBe("success");
}

export async function banConfidentialityIdentity(account: AnvilAccount, reason = "E2E confidentiality breach") {
  const resolved = await resolveConfidentialRater(account);
  expect(resolved.hasActiveHumanCredential, "Viewer must have an active credential before ban").toBe(true);
  expect(resolved.humanNullifier).not.toBe(`0x${"0".repeat(64)}`);
  expect(resolved.humanCredentialProvider, "Viewer credential provider must be set before ban").not.toBe(0);
  await ensureConfidentialityNexus(account, resolved);

  const walletClient = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.account9.privateKey),
    chain: foundry,
    transport: http(E2E_RPC_URL),
  });
  const evidenceHash = keccak256(toBytes(`${reason}:${account.address}:${Date.now()}`));
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.RaterRegistry,
    abi: RaterRegistryConfidentialityAbi,
    functionName: "banIdentity",
    args: [resolved.humanCredentialProvider, resolved.humanNullifier, maxUint64, reason, evidenceHash],
  });
  const receipt = await confidentialityPublicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status, `Confidentiality identity ban failed for ${account.address}`).toBe("success");
  return resolved;
}

export async function unbanConfidentialityIdentity(account: AnvilAccount) {
  const resolved = await resolveConfidentialRater(account);
  if (resolved.humanNullifier === `0x${"0".repeat(64)}` || resolved.humanCredentialProvider === 0) return;

  const walletClient = createWalletClient({
    account: privateKeyToAccount(ANVIL_ACCOUNTS.account9.privateKey),
    chain: foundry,
    transport: http(E2E_RPC_URL),
  });
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.RaterRegistry,
    abi: RaterRegistryConfidentialityAbi,
    functionName: "unbanIdentity",
    args: [resolved.humanCredentialProvider, resolved.humanNullifier],
  });
  const receipt = await confidentialityPublicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status, `Confidentiality identity unban failed for ${account.address}`).toBe("success");
}
