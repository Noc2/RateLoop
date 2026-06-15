import { ANVIL_ACCOUNTS } from "../helpers/anvil-accounts";
import { newE2EContext } from "../helpers/browser-context";
import { setupWallet } from "../helpers/wallet-session";
import { expect, test } from "@playwright/test";

type HandoffCreateResponse = {
  handoffId: string;
  handoffUrl: string;
};

type SigningIntentCreateResponse = {
  id: string;
  signingUrl: string;
};

type AgentQuestionRequest = {
  bounty: {
    amount: string;
    asset: "USDC";
    bountyStartBy: string;
    bountyWindowSeconds: string;
    feedbackWindowSeconds: string;
  };
  chainId: number;
  clientRequestId: string;
  maxPaymentAmount: string;
  paymentMode: "wallet_calls";
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
    title: string;
  };
  walletAddress: string;
};

function baseAgentQuestionRequest(clientRequestId: string, title: string): AgentQuestionRequest {
  return {
    bounty: {
      amount: "1000000",
      asset: "USDC",
      bountyStartBy: "1762000000",
      bountyWindowSeconds: "1200",
      feedbackWindowSeconds: "1200",
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

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await page.goto(created.handoffUrl, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(new RegExp(`/agent/handoff/${created.handoffId}$`));
    await expect(page.getByText("Agent ask handoff")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: originalTitle })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Private context" })).toBeChecked();
    await expect(page.locator("#agent-ask-confidentiality-bond-amount")).toHaveValue("1");

    await page.getByLabel("Question").fill(editedTitle);
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved.")).toBeVisible({ timeout: 30_000 });

    const readResponse = await request.get(`/api/agent/handoffs/${created.handoffId}`, {
      headers: {
        "x-rateloop-handoff-token": token,
      },
    });
    expect(readResponse.ok(), await readResponse.text()).toBe(true);
    const saved = (await readResponse.json()) as {
      draftRevision: number;
      editedByUser: boolean;
      requestBody: AgentQuestionRequest;
    };
    expect(saved.draftRevision).toBe(1);
    expect(saved.editedByUser).toBe(true);
    expect(saved.requestBody.question.title).toBe(editedTitle);
    expect(saved.requestBody.question.confidentiality?.visibility).toBe("gated");
    expect(saved.requestBody.question.detailsUrl).toBe(
      "https://rateloop.ai/api/attachments/details/det_agenthandoffprivate01",
    );

    await context.close();
  });

  test("browser signing intent loads from a private token", async ({ browser, request }) => {
    const title = `Agent signing intent ${Date.now()}`;
    const createResponse = await request.post("/api/agent/signing-intents", {
      data: {
        request: baseAgentQuestionRequest(`agent-signing-e2e-${Date.now()}`, title),
        ttlMs: 300_000,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBe(true);
    const created = (await createResponse.json()) as SigningIntentCreateResponse;
    expect(tokenFromFragment(created.signingUrl)).toBeTruthy();

    const context = await newE2EContext(browser);
    const page = await context.newPage();
    await setupWallet(page, ANVIL_ACCOUNTS.account2.privateKey);
    await page.goto(created.signingUrl, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(new RegExp(`/agent/sign/${created.id}$`));
    await expect(page.getByText("Agent signing handoff")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByText("pending")).toBeVisible();
    await expect(page.getByRole("button", { name: "Prepare" })).toBeVisible();

    await context.close();
  });
});
