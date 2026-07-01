import { waitForPonderIndexed } from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { getContentList } from "../helpers/ponder-api";
import { setupWallet } from "../helpers/wallet-session";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

type HandoffCreateResponse = {
  handoffId: string;
  handoffUrl: string;
  warnings?: string[];
};

type SigningIntentCreateResponse = {
  id: string;
  signingUrl: string;
};

type AgentQuestionRequest = {
  bounty: {
    amount: string;
    asset: "LREP" | "USDC";
    requiredVoters?: string;
  };
  chainId: number;
  clientRequestId: string;
  feedbackBonus?: {
    amount: string;
    asset: "LREP" | "USDC";
  };
  maxPaymentAmount: string;
  paymentMode: "wallet_calls" | "x402_authorization";
  question: {
    categoryId: string;
    confidentiality?: {
      bond: {
        amount: string;
        asset: "LREP" | "USDC";
      };
      disclosurePolicy: "private_forever";
      visibility: "gated";
    };
    contextUrl?: string;
    description: string;
    detailsHash?: `0x${string}`;
    detailsUrl?: string;
    tags: string[];
    templateId?: string;
    templateInputs?: Record<string, string>;
    title: string;
  };
  roundConfig?: {
    maxVoters?: string;
    minVoters?: string;
    questionDurationSeconds?: string;
  };
  walletAddress: string;
};

function baseAgentQuestionRequest(clientRequestId: string, title: string): AgentQuestionRequest {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
    },
    chainId: 31337,
    clientRequestId,
    maxPaymentAmount: "1000000",
    paymentMode: "wallet_calls",
    question: {
      categoryId: "5",
      contextUrl: "https://example.com/context",
      description: "Would this handoff make the ask clearer for raters?",
      tags: ["agents", "handoff"],
      title,
    },
    walletAddress: ANVIL_ACCOUNTS.account2.address,
  };
}

function tokenFromFragment(url: string) {
  return new URLSearchParams(new URL(url).hash.replace(/^#/, "")).get("token") ?? "";
}

async function expectPrivateTokenStripped(page: Page) {
  await page.waitForFunction(() => !window.location.hash.includes("token="), undefined, { timeout: 30_000 });
}

async function expectPrivateResourceReadable(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
) {
  await expect(async () => {
    const response = await request.get(path, { headers });
    expect(response.ok(), await response.text()).toBe(true);
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });
}

type HandoffReadResponse = {
  draftRevision?: number;
  editedByUser?: boolean;
  requestBody: AgentQuestionRequest;
  status?: string;
};

async function expectSavedHandoffDraft(
  request: APIRequestContext,
  handoffId: string,
  token: string,
  assertDraft: (saved: HandoffReadResponse) => void,
) {
  let saved: HandoffReadResponse | null = null;
  await expect(async () => {
    const readResponse = await request.get(`/api/agent/handoffs/${handoffId}`, {
      headers: {
        "x-rateloop-handoff-token": token,
      },
    });
    expect(readResponse.ok(), await readResponse.text()).toBe(true);
    saved = (await readResponse.json()) as HandoffReadResponse;
    assertDraft(saved);
  }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 5_000] });

  if (!saved) throw new Error("Saved handoff draft was not readable.");
  return saved;
}

async function openPrivateTokenPage(page: Page, url: string, expectedUrl: RegExp, markerText: string, title: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expectPrivateTokenStripped(page);
  await expect(page).toHaveURL(expectedUrl, { timeout: 10_000 });
  await expect(page.getByText(markerText)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 90_000 });
}

test.describe("Agent browser handoffs", () => {
  test("agent ask handoff loads from a private token and saves a gated draft", async ({ browser, request }) => {
    test.setTimeout(120_000);

    const originalTitle = `Agent private handoff ${Date.now()}`;
    const editedTitle = `${originalTitle} edited`;
    const requestBody = baseAgentQuestionRequest(`agent-handoff-e2e-${Date.now()}`, originalTitle);
    requestBody.question = {
      categoryId: "5",
      confidentiality: {
        bond: {
          amount: "1000000",
          asset: "LREP",
        },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      description: "Private hosted context prepared by the agent for browser review.",
      detailsHash: `0x${"8".repeat(64)}`,
      detailsUrl: "https://rateloop.ai/api/attachments/details/det_agenthandoffprivate01",
      tags: ["agents", "private"],
      title: originalTitle,
    };

    const createResponse = await request.post("/api/agent/handoffs", {
      data: {
        request: requestBody,
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as HandoffCreateResponse;
    const token = tokenFromFragment(created.handoffUrl);
    expect(token).toBeTruthy();
    await expectPrivateResourceReadable(request, `/api/agent/handoffs/${created.handoffId}`, {
      "x-rateloop-handoff-token": token,
    });

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await openPrivateTokenPage(
      page,
      created.handoffUrl,
      new RegExp(`/agent/handoff/${created.handoffId}$`),
      "Agent ask handoff",
      originalTitle,
    );
    await expect(page.getByRole("checkbox", { name: "Private context" })).toBeChecked();
    await expect(page.locator("#agent-ask-confidentiality-bond-amount")).toHaveValue("1");

    await page.getByRole("textbox", { name: "Question", exact: true }).fill(editedTitle);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expectSavedHandoffDraft(request, created.handoffId, token, saved => {
      expect(saved.draftRevision).toBe(1);
      expect(saved.editedByUser).toBe(true);
      expect(saved.requestBody.question.title).toBe(editedTitle);
      expect(saved.requestBody.question.confidentiality?.visibility).toBe("gated");
      expect(saved.requestBody.question.detailsUrl).toBe(
        "https://rateloop.ai/api/attachments/details/det_agenthandoffprivate01",
      );
    });
    await expect(page.getByText("Revision 1")).toBeVisible({ timeout: 30_000 });

    await context.close();
  });

  test("agent ask handoff infers A/B mode from explicit option wording", async ({ browser, request }) => {
    test.setTimeout(120_000);

    const originalTitle = "Vote up for Option A: Hermes Agent over Option B: OpenClaw for RateLoop agent loops.";
    const requestBody = baseAgentQuestionRequest(`agent-handoff-ab-${Date.now()}`, originalTitle);
    requestBody.question = {
      ...requestBody.question,
      description:
        "Vote up for Option A, Hermes Agent, if you would choose it over OpenClaw. Vote down for Option B, OpenClaw.",
      tags: ["ai-agents", "hermes-agent", "openclaw"],
      templateId: "generic_rating",
    };

    const createResponse = await request.post("/api/agent/handoffs", {
      data: {
        request: requestBody,
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as HandoffCreateResponse & {
      originalRequestBody: AgentQuestionRequest;
      requestBody: AgentQuestionRequest;
    };
    const token = tokenFromFragment(created.handoffUrl);
    expect(token).toBeTruthy();
    expect(created.warnings?.some(warning => warning.startsWith("auto_converted_head_to_head_ab"))).toBe(true);
    expect(created.originalRequestBody.question.templateId).toBe("generic_rating");
    expect(created.requestBody.question.templateId).toBe("head_to_head_ab");
    expect(created.requestBody.question.templateInputs).toMatchObject({
      optionAKey: "A",
      optionALabel: "Hermes Agent",
      optionBKey: "B",
      optionBLabel: "OpenClaw",
    });

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await openPrivateTokenPage(
      page,
      created.handoffUrl,
      new RegExp(`/agent/handoff/${created.handoffId}$`),
      "Agent ask handoff",
      "Do you prefer A = Hermes Agent or B = OpenClaw?",
    );
    await expect(page.getByRole("button", { name: "A/B comparison" })).toHaveClass(/btn-primary/);
    await expect(page.getByRole("textbox", { name: "Option A" })).toHaveValue("Hermes Agent");
    await expect(page.getByRole("textbox", { name: "Option B" })).toHaveValue("OpenClaw");

    await context.close();
  });

  test("agent ask handoff preserves USDC Feedback Bonus and shared duration in edited drafts", async ({
    browser,
    request,
  }) => {
    test.setTimeout(240_000);

    const originalTitle = `Agent feedback bonus handoff ${Date.now()}`;
    const requestBody = baseAgentQuestionRequest(`agent-handoff-feedback-${Date.now()}`, originalTitle);
    requestBody.bounty = {
      amount: "1000000",
      asset: "USDC",
      requiredVoters: "5",
    };
    requestBody.feedbackBonus = {
      amount: "500000",
      asset: "USDC",
    };
    requestBody.maxPaymentAmount = "1500000";
    requestBody.paymentMode = "x402_authorization";
    requestBody.roundConfig = {
      maxVoters: "50",
      minVoters: "5",
      questionDurationSeconds: "1200",
    };

    const createResponse = await request.post("/api/agent/handoffs", {
      data: {
        request: requestBody,
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as HandoffCreateResponse;
    const token = tokenFromFragment(created.handoffUrl);
    expect(token).toBeTruthy();

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await openPrivateTokenPage(
      page,
      created.handoffUrl,
      new RegExp(`/agent/handoff/${created.handoffId}$`),
      "Agent ask handoff",
      originalTitle,
    );

    await expect(page.getByRole("button", { name: /^Add bonus$/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#agent-ask-feedback-bonus-amount")).toHaveValue("0.5");
    await expect(page.locator("#agent-ask-round-blind-seconds")).toHaveValue("20");
    await expect(page.getByLabel("Question duration unit")).toHaveValue("minutes");
    await expect(page.locator("#agent-ask-round-min-voters")).toHaveValue("5");
    await expect(page.locator("#agent-ask-round-max-voters")).toHaveValue("50");

    const handoffSummary = page
      .locator("section")
      .filter({ hasText: "Funding wallet" })
      .filter({ hasText: "Feedback Bonus" })
      .first();
    await expect(handoffSummary.getByText("0.5 USDC")).toBeVisible();
    await page.getByRole("button", { name: /^No bonus$/i }).click();
    await expect(handoffSummary.getByText("No bonus")).toBeVisible();
    await expect(handoffSummary.getByText("0.5 USDC")).toHaveCount(0);
    await expect(page.locator("#agent-ask-feedback-bonus-amount")).toHaveCount(0);
    await page.getByRole("button", { name: /^Add bonus$/i }).click();

    await page.locator("#agent-ask-feedback-bonus-amount").fill("0.75");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expectSavedHandoffDraft(request, created.handoffId, token, saved => {
      expect(saved.requestBody.feedbackBonus).toMatchObject({
        amount: "750000",
        asset: "USDC",
      });
      expect(saved.requestBody.maxPaymentAmount).toBe("1750000");
      expect(saved.requestBody.roundConfig).toMatchObject({
        maxVoters: "50",
        minVoters: "5",
        questionDurationSeconds: "1200",
      });
      expect(saved.requestBody.bounty.requiredVoters).toBe("5");
    });
    await expect(page.getByText("Revision 1")).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole("button", { name: /^Submit$/i })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Submit$/i }).click();

    await expect(async () => {
      const statusResponse = await request.get(`/api/agent/handoffs/${created.handoffId}`, {
        headers: {
          "x-rateloop-handoff-token": token,
        },
      });
      expect(statusResponse.ok(), await statusResponse.text()).toBe(true);
      const status = (await statusResponse.json()) as {
        status?: string;
        transactionHashes?: string[];
      };
      expect(status.status).toBe("submitted");
      expect(status.transactionHashes?.length ?? 0).toBeGreaterThan(0);
    }).toPass({ timeout: 120_000, intervals: [1_000, 2_000, 5_000] });

    const indexed = await waitForPonderIndexed(
      async () => {
        const { items } = await getContentList({ search: originalTitle, status: "all", limit: 5 });
        const submittedQuestion = items.find(item => item.title === originalTitle);
        if (!submittedQuestion) return false;

        const rewardPoolSummary = submittedQuestion.rewardPoolSummary;
        const feedbackBonusSummary = submittedQuestion.feedbackBonusSummary;
        return (
          rewardPoolSummary?.fundedCurrency === "USDC" &&
          rewardPoolSummary.fundedAsset === 1 &&
          (rewardPoolSummary.rewardPoolCount ?? 0) > 0 &&
          BigInt(rewardPoolSummary.totalFundedAmount ?? "0") >= 1_000_000n &&
          rewardPoolSummary.questionDurationSeconds === 1200 &&
          submittedQuestion.openRound?.epochDuration === 1200 &&
          feedbackBonusSummary?.currency === "USDC" &&
          feedbackBonusSummary.asset === 1 &&
          feedbackBonusSummary.activePoolCount > 0 &&
          BigInt(feedbackBonusSummary.totalFundedAmount) >= 750_000n
        );
      },
      120_000,
      2_000,
      "waitForFeedbackBonusHandoffSubmission",
    );
    expect(indexed, "submitted handoff should index with the shared duration, USDC bounty, and Feedback Bonus").toBe(
      true,
    );

    await context.close();
  });

  test("agent ask handoff validates bounty against edited voter cap before submit", async ({ browser, request }) => {
    test.setTimeout(120_000);

    const title = `Agent handoff bounty validation ${Date.now()}`;
    const requestBody = baseAgentQuestionRequest(`agent-handoff-bounty-validation-${Date.now()}`, title);
    requestBody.bounty = {
      amount: "1000000",
      asset: "LREP",
      requiredVoters: "3",
    };
    requestBody.maxPaymentAmount = "1000000";
    requestBody.roundConfig = {
      maxVoters: "100",
      minVoters: "3",
      questionDurationSeconds: "1200",
    };

    const createResponse = await request.post("/api/agent/handoffs", {
      data: {
        request: requestBody,
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as HandoffCreateResponse;
    const token = tokenFromFragment(created.handoffUrl);
    expect(token).toBeTruthy();

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await openPrivateTokenPage(
      page,
      created.handoffUrl,
      new RegExp(`/agent/handoff/${created.handoffId}$`),
      "Agent ask handoff",
      title,
    );

    const bountyAmountInput = page.locator("#agent-ask-bounty-amount");
    await expect(bountyAmountInput).not.toHaveClass(/input-error/);

    await page.locator("#agent-ask-round-max-voters").fill("200");
    await expect(page.getByText("Minimum is 2 LREP for the selected voter cap.")).toBeVisible();
    await expect(bountyAmountInput).toHaveClass(/input-error/);
    await expect(page.getByRole("button", { name: /^Submit$/i })).toBeDisabled();

    await context.close();
  });

  test("browser signing intent loads from a private token", async ({ browser, request }) => {
    test.setTimeout(120_000);

    const title = `Agent signing intent ${Date.now()}`;
    const createResponse = await request.post("/api/agent/signing-intents", {
      data: {
        request: baseAgentQuestionRequest(`agent-signing-e2e-${Date.now()}`, title),
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as SigningIntentCreateResponse;
    const token = tokenFromFragment(created.signingUrl);
    expect(token).toBeTruthy();
    await expectPrivateResourceReadable(request, `/api/agent/signing-intents/${created.id}`, {
      "x-rateloop-signing-intent-token": token,
    });

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await openPrivateTokenPage(
      page,
      created.signingUrl,
      new RegExp(`/agent/sign/${created.id}$`),
      "Agent signing handoff",
      title,
    );
    await expect(page.getByText("pending")).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare" })).toBeVisible();

    await context.close();
  });
});
