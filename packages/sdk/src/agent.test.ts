import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  buildWebhookVerifier,
  createRateLoopAgentClient,
  parseAgentResult,
  type AskHumansRequest,
  type ListResultTemplatesResponse,
  type QuestionStatusResponse,
  type WebhookReplayStore,
} from "./agent";

const API_BASE_URL = "https://rateloop.example";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function signedWebhookHeaders(params: {
  body: string;
  eventId: string;
  secret?: string;
  timestamp: string;
}) {
  const signature = createHmac("sha256", params.secret ?? "shared-secret")
    .update(`v1.${params.eventId}.${params.timestamp}.${params.body}`)
    .digest("hex");
  return {
    "x-rateloop-callback-id": params.eventId,
    "x-rateloop-callback-signature": `v1=${signature}`,
    "x-rateloop-callback-timestamp": params.timestamp,
  };
}

function memoryReplayStore() {
  const claimed = new Set<string>();
  const calls: string[] = [];
  const store: WebhookReplayStore = {
    claim: async (key) => {
      calls.push(`claim:${key}`);
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    complete: async (key) => {
      calls.push(`complete:${key}`);
    },
    release: async (key) => {
      calls.push(`release:${key}`);
      claimed.delete(key);
    },
  };
  return { calls, store };
}

test("agent MCP helpers call tools/call with protocol and bearer headers", async () => {
  let requestedUrl = "";
  let requestedBody: any;
  let requestedHeaders: Headers | undefined;
  const agent = createRateLoopAgentClient({
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        id: requestedBody.id,
        jsonrpc: "2.0",
        result: {
          content: [],
          isError: false,
          structuredContent: {
            canSubmit: true,
            clientRequestId: "ask-1",
            operationKey: `0x${"11".repeat(32)}`,
            payment: { amount: "1000000", asset: "USDC", decimals: 6 },
          },
        },
      });
    },
    mcpApiUrl: "https://rateloop.example/api/mcp",
    mcpAccessToken: "agent-token",
    timeoutMs: 5_000,
  });

  const quote = await agent.quoteQuestion({
    bounty: { amount: 1_000_000n },
    chainId: 480,
    clientRequestId: "ask-1",
    question: {
      categoryId: 1n,
      contextUrl: "https://example.com/context",
      description: "Should the agent proceed?",
      tags: ["agent", "decision"],
      title: "Proceed?",
    },
  });

  assert.equal(requestedUrl, "https://rateloop.example/api/mcp");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer agent-token");
  assert.equal(requestedHeaders?.get("mcp-protocol-version"), "2025-11-25");
  assert.equal(requestedBody.method, "tools/call");
  assert.equal(requestedBody.params.name, "rateloop_quote_question");
  assert.equal(requestedBody.params.arguments.bounty.amount, "1000000");
  assert.equal(quote.canSubmit, true);
  assert.equal(quote.clientRequestId, "ask-1");
});

test("image upload SDK helpers call the MCP image tools", async () => {
  const calls: any[] = [];
  const agent = createRateLoopAgentClient({
    fetchImpl: async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.params);
      const name = body.params.name;
      const structuredContent =
        name === "rateloop_prepare_image_upload"
          ? {
              attachmentId: "att_sdkuploadimage01",
              challengeId: "challenge-1",
              message: "Sign this RateLoop image upload",
              nextTool: "rateloop_upload_image",
              signatureRequired: true,
            }
          : {
              attachmentId: "att_sdkuploadimage01",
              imageUrl:
                "https://rateloop.example/api/attachments/images/att_sdkuploadimage01.webp",
              moderationStatus: "approved",
              nextAction: "Use imageUrl in question.imageUrls.",
              status: "approved",
            };
      return jsonResponse({
        id: body.id,
        jsonrpc: "2.0",
        result: {
          content: [],
          isError: false,
          structuredContent,
        },
      });
    },
    mcpApiUrl: "https://rateloop.example/api/mcp/public",
  });

  const prepared = await agent.prepareImageUpload({
    attachmentId: "att_sdkuploadimage01",
    filename: "generated-mockup.png",
    mimeType: "image/png",
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  const uploaded = await agent.uploadImage({
    attachmentId: prepared.attachmentId,
    challengeId: prepared.challengeId ?? undefined,
    filename: "generated-mockup.png",
    imageBase64: "iVBORw0KGgo=",
    mimeType: "image/png",
    signature: `0x${"1".repeat(130)}`,
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  const status = await agent.getImageUploadStatus({
    attachmentId: prepared.attachmentId,
  });

  assert.deepEqual(
    calls.map(call => call.name),
    [
      "rateloop_prepare_image_upload",
      "rateloop_upload_image",
      "rateloop_get_image_upload_status",
    ],
  );
  assert.equal(calls[0].arguments.filename, "generated-mockup.png");
  assert.equal(calls[1].arguments.imageBase64, "iVBORw0KGgo=");
  assert.equal(calls[2].arguments.attachmentId, "att_sdkuploadimage01");
  assert.equal(prepared.nextTool, "rateloop_upload_image");
  assert.equal(uploaded.status, "approved");
  assert.equal(status.imageUrl, "https://rateloop.example/api/attachments/images/att_sdkuploadimage01.webp");
});

test("rating SDK helpers call the MCP rating tools", async () => {
  const calls: any[] = [];
  const agent = createRateLoopAgentClient({
    fetchImpl: async (_input: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.params);
      const name = body.params.name;
      const structuredContent =
        name === "rateloop_get_rating_context"
          ? {
              contentId: "42",
              ratingInputMode: "local_encrypted_commit",
              status: "ready",
            }
          : name === "rateloop_prepare_rating_transactions"
            ? {
                status: "awaiting_wallet_signature",
                transactionPlan: { calls: [], requiresOrderedExecution: true },
              }
            : {
                contentId: "42",
                confirmed: name === "rateloop_confirm_rating_transactions",
                status:
                  name === "rateloop_confirm_rating_transactions"
                    ? "committed"
                    : "not_found",
              };
      return jsonResponse({
        id: body.id,
        jsonrpc: "2.0",
        result: {
          content: [],
          isError: false,
          structuredContent,
        },
      });
    },
    mcpApiUrl: "https://rateloop.example/api/mcp/public",
  });

  await agent.getRatingContext({
    chainId: 31337,
    contentId: 42n,
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  await agent.prepareRatingTransactions({
    chainId: 31337,
    ciphertext: `0x${"ab".repeat(4)}`,
    commitHash: `0x${"11".repeat(32)}`,
    contentId: 42n,
    drandChainHash: `0x${"22".repeat(32)}`,
    frontend: "0x00000000000000000000000000000000000000bb",
    roundId: 7n,
    roundReferenceRatingBps: 5000,
    stakeWei: 1_000_000n,
    targetRound: 100n,
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  await agent.confirmRatingTransactions({
    commitHash: `0x${"11".repeat(32)}`,
    contentId: "42",
    roundId: "7",
    transactionHashes: [`0x${"33".repeat(32)}`],
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  await agent.getRatingStatus({
    contentId: "42",
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });

  assert.deepEqual(
    calls.map((call) => call.name),
    [
      "rateloop_get_rating_context",
      "rateloop_prepare_rating_transactions",
      "rateloop_confirm_rating_transactions",
      "rateloop_get_rating_status",
    ],
  );
  assert.equal(calls[0].arguments.contentId, "42");
  assert.equal(calls[1].arguments.stakeWei, "1000000");
  assert.equal(calls[1].arguments.commitHash, `0x${"11".repeat(32)}`);
  assert.equal(calls[1].arguments.isUp, undefined);
  assert.deepEqual(calls[2].arguments.transactionHashes, [
    `0x${"33".repeat(32)}`,
  ]);
});

test("prepareRatingTransactions rejects plaintext rating fields before MCP", async () => {
  const agent = createRateLoopAgentClient({
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
    mcpApiUrl: "https://rateloop.example/api/mcp/public",
  });

  await assert.rejects(
    agent.prepareRatingTransactions({
      chainId: 31337,
      ciphertext: `0x${"ab".repeat(4)}`,
      commitHash: `0x${"11".repeat(32)}`,
      contentId: 42,
      drandChainHash: `0x${"22".repeat(32)}`,
      frontend: "0x00000000000000000000000000000000000000bb",
      isUp: true,
      roundId: 7,
      roundReferenceRatingBps: 5000,
      stakeWei: "1000000",
      targetRound: 100,
      walletAddress: "0x00000000000000000000000000000000000000aa",
    } as any),
    /Do not send plaintext rating fields/,
  );
});

test("quoteQuestion uses direct authenticated agent HTTP when apiBaseUrl and token are configured", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        canSubmit: true,
        clientRequestId: "ask-direct",
        fastLane: {
          conservativeStartingBountyAtomic: "999999",
          pricingConfidence: "medium",
          recommendedAction: "start_small",
        },
        operationKey: `0x${"55".repeat(32)}`,
        payment: { amount: "1000000", asset: "USDC", decimals: 6 },
      });
    },
    mcpAccessToken: "agent-token",
  });

  const response = await agent.quoteQuestion({
    bounty: { amount: 1_000_000n },
    chainId: 480,
    clientRequestId: "ask-direct",
    question: {
      categoryId: 5n,
      contextUrl: "https://example.com/context",
      description: "Would this make you want to learn more?",
      tags: ["agent", "pitch"],
      title: "Pitch interest",
    },
  });

  assert.equal(requestedUrl, "https://rateloop.example/api/agent/quote");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer agent-token");
  assert.equal(requestedBody.clientRequestId, "ask-direct");
  assert.equal(response.operationKey, `0x${"55".repeat(32)}`);
  assert.equal(response.fastLane?.recommendedAction, "start_small");
  assert.equal(response.fastLane?.pricingConfidence, "medium");
});

test("quoteQuestion supports tokenless direct agent HTTP with a wallet address", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        canSubmit: true,
        clientRequestId: "ask-tokenless-quote",
        operationKey: `0x${"56".repeat(32)}`,
        payment: { amount: "1000000", asset: "USDC", decimals: 6 },
        walletPolicyRequired: false,
      });
    },
  });

  const response = await agent.quoteQuestion({
    bounty: { amount: 1_000_000n, requiredVoters: 3n },
    chainId: 480,
    clientRequestId: "ask-tokenless-quote",
    question: {
      categoryId: 7n,
      contextUrl: "https://example.com/context",
      description: "Does this look ready for launch?",
      tags: ["launch", "agent"],
      title: "Launch readiness?",
    },
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });

  assert.equal(requestedUrl, "https://rateloop.example/api/agent/quote");
  assert.equal(requestedHeaders?.get("authorization"), null);
  assert.equal(requestedBody.bounty.amount, "1000000");
  assert.equal(
    requestedBody.walletAddress,
    "0x00000000000000000000000000000000000000aa",
  );
  assert.equal(response.walletPolicyRequired, false);
  assert.equal(response.operationKey, `0x${"56".repeat(32)}`);
});

test("askHumans supports tokenless direct agent HTTP with a wallet address", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        clientRequestId: "ask-2",
        operationKey: `0x${"57".repeat(32)}`,
        status: "awaiting_wallet_signature",
        walletPolicyRequired: false,
      });
    },
  });

  const request: AskHumansRequest = {
    bounty: { amount: 1_000_000n, requiredVoters: 3n },
    chainId: 480,
    clientRequestId: "ask-2",
    maxPaymentAmount: 1_250_000n,
    question: {
      categoryId: 7n,
      contextUrl: "https://example.com/context",
      description: "Does this look ready for launch?",
      tags: "launch,agent",
      title: "Launch readiness?",
    },
    walletAddress: "0x00000000000000000000000000000000000000aa",
  };

  const response = await agent.askHumans(request);

  assert.equal(requestedUrl, "https://rateloop.example/api/agent/asks");
  assert.equal(requestedHeaders?.get("authorization"), null);
  assert.equal(requestedBody.maxPaymentAmount, "1250000");
  assert.equal(
    requestedBody.walletAddress,
    "0x00000000000000000000000000000000000000aa",
  );
  assert.equal(response.walletPolicyRequired, false);
  assert.equal(response.status, "awaiting_wallet_signature");
});

test("signing intent helpers use direct browser-handoff routes", async () => {
  const requestedUrls: string[] = [];
  const requestedBodies: any[] = [];
  const requestedHeaders: Headers[] = [];
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrls.push(String(input));
      requestedBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      requestedHeaders.push(new Headers(init?.headers));
      const url = String(input);
      if (url.endsWith("/api/agent/signing-intents")) {
        return jsonResponse({
          expiresAt: "2026-04-30T12:00:00.000Z",
          id: "asi_test",
          signingUrl:
            "https://rateloop.example/agent/sign/asi_test?token=secret",
          status: "pending",
        });
      }
      if (url.includes("/prepare")) {
        return jsonResponse({
          expiresAt: "2026-04-30T12:00:00.000Z",
          id: "asi_test",
          operationKey: `0x${"67".repeat(32)}`,
          status: "awaiting_wallet_signature",
        });
      }
      if (url.includes("/complete")) {
        return jsonResponse({
          expiresAt: "2026-04-30T12:00:00.000Z",
          id: "asi_test",
          status: "submitted",
          transactionHashes: [`0x${"68".repeat(32)}`],
        });
      }
      return jsonResponse({
        expiresAt: "2026-04-30T12:00:00.000Z",
        id: "asi_test",
        status: "pending",
      });
    },
  });

  const createResponse = await agent.createSigningIntent({
    request: {
      bounty: { amount: 1_000_000n },
      chainId: 480,
      clientRequestId: "browser-signing",
      maxPaymentAmount: 1_000_000n,
      question: {
        categoryId: 7n,
        contextUrl: "https://example.com/context",
        tags: ["agent", "browser-signing"],
        title: "Browser sign?",
      },
      signatureMode: "browser_link",
    },
    ttlMs: 300_000,
  });
  const readResponse = await agent.getSigningIntent({
    intentId: "asi_test",
    token: "secret",
  });
  const prepareResponse = await agent.prepareSigningIntent({
    intentId: "asi_test",
    token: "secret",
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });
  const completeResponse = await agent.completeSigningIntent({
    intentId: "asi_test",
    token: "secret",
    transactionHashes: [`0x${"68".repeat(32)}`],
  });

  assert.equal(
    requestedUrls[0],
    "https://rateloop.example/api/agent/signing-intents",
  );
  assert.equal(
    requestedUrls[1],
    "https://rateloop.example/api/agent/signing-intents/asi_test",
  );
  assert.equal(requestedHeaders[1].get("x-rateloop-signing-intent-token"), "secret");
  assert.equal(
    requestedUrls[2],
    "https://rateloop.example/api/agent/signing-intents/asi_test/prepare",
  );
  assert.equal(
    requestedUrls[3],
    "https://rateloop.example/api/agent/signing-intents/asi_test/complete",
  );
  assert.equal(requestedBodies[0].request.bounty.amount, "1000000");
  assert.equal(requestedBodies[0].request.signatureMode, "browser_link");
  assert.equal(
    requestedBodies[2].walletAddress,
    "0x00000000000000000000000000000000000000aa",
  );
  assert.deepEqual(requestedBodies[3].transactionHashes, [
    `0x${"68".repeat(32)}`,
  ]);
  assert.equal(
    createResponse.signingUrl,
    "https://rateloop.example/agent/sign/asi_test?token=secret",
  );
  assert.equal(readResponse.id, "asi_test");
  assert.equal(prepareResponse.operationKey, `0x${"67".repeat(32)}`);
  assert.equal(completeResponse.status, "submitted");
});

test("askHumans prefers direct authenticated agent HTTP before MCP framing", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        clientRequestId: "ask-http",
        operationKey: `0x${"66".repeat(32)}`,
        status: "submitted",
      });
    },
    mcpAccessToken: "agent-token",
  });

  await agent.askHumans({
    bounty: { amount: 1_000_000n },
    chainId: 480,
    clientRequestId: "ask-http",
    maxPaymentAmount: 1_250_000n,
    question: {
      categoryId: 5n,
      contextUrl: "https://example.com/context",
      description: "Would this pitch make you want to learn more?",
      tags: ["agent", "pitch"],
      title: "Pitch interest",
    },
  });

  assert.equal(requestedUrl, "https://rateloop.example/api/agent/asks");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer agent-token");
  assert.equal(requestedBody.maxPaymentAmount, "1250000");
});

test("askHumans routes feedback bonus asks through MCP", async () => {
  let requestedUrl = "";
  let requestedBody: any;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        result: {
          structuredContent: {
            feedbackBonus: {
              amount: "2000000",
              status: "pending_question_confirmation",
            },
            operationKey: `0x${"69".repeat(32)}`,
            payment: {
              amount: "3000000",
              bountyAmount: "1000000",
              feedbackBonusAmount: "2000000",
              totalAmount: "3000000",
            },
            status: "awaiting_wallet_signature",
          },
        },
      });
    },
    mcpAccessToken: "agent-token",
  });

  const response = await agent.askHumans({
    bounty: { amount: 1_000_000n, rewardPoolExpiresAt: 1_762_000_000n },
    chainId: 480,
    clientRequestId: "ask-feedback-bonus",
    feedbackBonus: { amount: 2_000_000n },
    maxPaymentAmount: 3_000_000n,
    question: {
      categoryId: 5n,
      contextUrl: "https://example.com/context",
      description: "Would this answer be useful?",
      tags: ["agent", "feedback"],
      title: "Answer usefulness",
    },
  });

  assert.equal(requestedUrl, "https://rateloop.example/api/mcp");
  assert.equal(requestedBody.params.name, "rateloop_ask_humans");
  assert.equal(requestedBody.params.arguments.feedbackBonus.amount, "2000000");
  assert.equal(requestedBody.params.arguments.maxPaymentAmount, "3000000");
  assert.equal(response.feedbackBonus?.status, "pending_question_confirmation");
  assert.equal(response.payment?.totalAmount, "3000000");
});

test("confirmAskTransactions uses direct authenticated agent HTTP", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody: any;
  const operationKey = `0x${"77".repeat(32)}`;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        contentId: "42",
        operationKey,
        status: "submitted",
      });
    },
    mcpAccessToken: "agent-token",
  });

  const response = await agent.confirmAskTransactions({
    operationKey,
    transactionHashes: [`0x${"88".repeat(32)}`],
  });

  assert.equal(
    requestedUrl,
    `https://rateloop.example/api/agent/asks/${operationKey}/confirm`,
  );
  assert.equal(requestedHeaders?.get("authorization"), "Bearer agent-token");
  assert.deepEqual(requestedBody.transactionHashes, [`0x${"88".repeat(32)}`]);
  assert.equal(response.contentId, "42");
});

test("confirmAskTransactions can use MCP framing", async () => {
  let requestedBody: any;
  const operationKey = `0x${"99".repeat(32)}`;
  const agent = createRateLoopAgentClient({
    mcpApiUrl: "https://rateloop.example/api/mcp",
    fetchImpl: async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        result: {
          structuredContent: { operationKey, status: "submitted" },
        },
      });
    },
    mcpAccessToken: "agent-token",
  });

  const response = await agent.confirmAskTransactions({
    operationKey,
    transactionHashes: [`0x${"aa".repeat(32)}`],
  });

  assert.equal(requestedBody.params.name, "rateloop_confirm_ask_transactions");
  assert.equal(requestedBody.params.arguments.operationKey, operationKey);
  assert.deepEqual(requestedBody.params.arguments.transactionHashes, [
    `0x${"aa".repeat(32)}`,
  ]);
  assert.equal(response.status, "submitted");
});

test("confirmFeedbackBonusTransactions uses MCP framing", async () => {
  let requestedBody: any;
  const operationKey = `0x${"89".repeat(32)}`;
  const agent = createRateLoopAgentClient({
    mcpApiUrl: "https://rateloop.example/api/mcp",
    fetchImpl: async (_input: URL | RequestInfo, init?: RequestInit) => {
      requestedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        result: {
          structuredContent: {
            feedbackBonus: { poolId: "7", status: "funded" },
            operationKey,
            status: "submitted",
          },
        },
      });
    },
    mcpAccessToken: "agent-token",
  });

  const response = await agent.confirmFeedbackBonusTransactions({
    operationKey,
    transactionHashes: [`0x${"ab".repeat(32)}`],
  });

  assert.equal(
    requestedBody.params.name,
    "rateloop_confirm_feedback_bonus_transactions",
  );
  assert.equal(requestedBody.params.arguments.operationKey, operationKey);
  assert.deepEqual(requestedBody.params.arguments.transactionHashes, [
    `0x${"ab".repeat(32)}`,
  ]);
  assert.equal(response.feedbackBonus?.status, "funded");
  assert.equal(response.feedbackBonus?.poolId, "7");
});

test("getQuestionStatus supports tokenless direct operation and wallet client lookups", async () => {
  const requestedUrls: string[] = [];
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrls.push(String(input));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), null);
      return jsonResponse({
        operationKey: `0x${"33".repeat(32)}`,
        ready: false,
        status: "awaiting_wallet_signature",
        terminal: false,
      });
    },
  });

  const byOperation = await agent.getQuestionStatus({
    operationKey: `0x${"33".repeat(32)}`,
  });
  const byClient = await agent.getQuestionStatus({
    chainId: 480,
    clientRequestId: "ask-3",
    walletAddress: "0x00000000000000000000000000000000000000aa",
  });

  assert.deepEqual(requestedUrls, [
    `https://rateloop.example/api/agent/asks/0x${"33".repeat(32)}`,
    "https://rateloop.example/api/agent/asks/by-client-request?chainId=480&clientRequestId=ask-3&walletAddress=0x00000000000000000000000000000000000000aa",
  ]);
  assert.equal(byOperation.status, "awaiting_wallet_signature");
  assert.equal(byClient.terminal, false);
});

test("authenticated status, result, and templates use direct agent HTTP endpoints", async () => {
  const requestedUrls: string[] = [];
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrls.push(String(input));
      if (String(input).includes("/templates")) {
        return jsonResponse({
          templates: [
            {
              bundleStrategy: "independent",
              id: "generic_rating",
              submissionPattern: "single_question",
              templateInputsSchema: { type: "object" },
              version: 1,
            },
          ],
        });
      }
      if (String(input).includes("/results/")) {
        return jsonResponse({ answer: "pending", ready: false });
      }
      return jsonResponse({
        callbackDeliveries: [
          {
            attemptCount: 1,
            callbackUrl: "https://agent.example/rateloop",
            eventId: "event-1",
            eventType: "question.submitted",
            nextAttemptAt: "2026-04-23T12:00:03.000Z",
            status: "retrying",
            subscriptionId: "sub-1",
          },
        ],
        ready: false,
        resultTool: "rateloop_get_result",
        status: "submitted",
        terminal: false,
      });
    },
    mcpAccessToken: "agent-token",
  });

  const status = await agent.getQuestionStatus({
    operationKey: `0x${"77".repeat(32)}`,
  });
  await agent.getResult({ chainId: 480, clientRequestId: "ask-http" });
  await agent.getResult({ contentId: "123" });
  const templates = await agent.listResultTemplates();

  const callbackStatus:
    | NonNullable<
        QuestionStatusResponse["callbackDeliveries"]
      >[number]["status"]
    | undefined = status.callbackDeliveries?.[0]?.status;
  const templateMode:
    | NonNullable<
        ListResultTemplatesResponse["templates"]
      >[number]["submissionPattern"]
    | undefined = templates.templates[0]?.submissionPattern;

  assert.equal(
    requestedUrls[0],
    `https://rateloop.example/api/agent/asks/0x${"77".repeat(32)}`,
  );
  assert.equal(
    requestedUrls[1],
    "https://rateloop.example/api/agent/results/by-client-request?chainId=480&clientRequestId=ask-http",
  );
  assert.equal(
    requestedUrls[2],
    "https://rateloop.example/api/agent/results/by-content/123",
  );
  assert.equal(
    requestedUrls[3],
    "https://rateloop.example/api/agent/templates",
  );
  assert.equal(callbackStatus, "retrying");
  assert.equal(status.resultTool, "rateloop_get_result");
  assert.equal(status.terminal, false);
  assert.equal(templateMode, "single_question");
  assert.equal(templates.templates[0]?.bundleStrategy, "independent");
});

test("getResult uses tokenless public result packages when contentId is known", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        answer: "proceed",
        answerScopes: {
          allAnswers: {
            distribution: {
              up: { share: 0.7 },
            },
          },
        },
        methodology: { templateId: "generic_rating" },
        publicUrl: "https://rateloop.example/rate?content=42",
        ready: true,
        recommendedNextAction: "proceed",
      });
    },
  });

  const result = await agent.getResult({ contentId: "42" });

  assert.equal(
    requestedUrl,
    "https://rateloop.example/api/agent/results/by-content/42",
  );
  assert.equal(requestedHeaders?.get("authorization"), null);
  assert.equal(result.ready, true);
  assert.equal(result.answer, "proceed");
  assert.equal(result.methodology?.templateId, "generic_rating");
  assert.equal(
    (result.answerScopes as any).allAnswers.distribution.up.share,
    0.7,
  );
});

test("getResult supports tokenless direct operation lookups", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const agent = createRateLoopAgentClient({
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse({
        answer: "pending",
        operation: { operationKey: `0x${"99".repeat(32)}` },
        ready: false,
        recommendedNextAction: "wait_for_settlement",
      });
    },
  });

  const result = await agent.getResult({
    operationKey: `0x${"99".repeat(32)}`,
  });

  assert.equal(
    requestedUrl,
    `https://rateloop.example/api/agent/results/0x${"99".repeat(32)}`,
  );
  assert.equal(requestedHeaders?.get("authorization"), null);
  assert.equal(result.ready, false);
  assert.equal(result.answer, "pending");
});

test("parseAgentResult unwraps MCP tool content and preserves top-level fields", () => {
  const parsed = parseAgentResult({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          answer: "proceed",
          ready: true,
          extra: { kept: true },
        }),
      },
    ],
  });

  assert.equal(parsed.ready, true);
  assert.equal(parsed.answer, "proceed");
  assert.deepEqual(parsed.extra, { kept: true });
});

test("buildWebhookVerifier validates timestamped HMAC signatures", async () => {
  const body = JSON.stringify({
    operationKey: `0x${"44".repeat(32)}`,
    ready: true,
  });
  const eventId = "event-1";
  const timestamp = "2026-04-23T12:00:00.000Z";
  const signature = createHmac("sha256", "shared-secret")
    .update(`v1.${eventId}.${timestamp}.${body}`)
    .digest("hex");
  const verifier = buildWebhookVerifier({ secret: "shared-secret" });

  assert.equal(
    await verifier.verify({
      body,
      headers: {
        "x-rateloop-callback-id": eventId,
        "x-rateloop-callback-signature": `v1=${signature}`,
        "x-rateloop-callback-timestamp": timestamp,
      },
      now: new Date("2026-04-23T12:04:00.000Z"),
    }),
    true,
  );

  assert.equal(
    await verifier.verify({
      body,
      headers: {
        "x-rateloop-callback-id": eventId,
        "x-rateloop-callback-signature": `v1=${signature}`,
        "x-rateloop-callback-timestamp": timestamp,
      },
      now: new Date("2026-04-23T12:06:01.000Z"),
    }),
    false,
  );
});

test("buildWebhookVerifier handleOnce processes a signed event once", async () => {
  const body = JSON.stringify({ operationKey: `0x${"44".repeat(32)}` });
  const eventId = "event-once";
  const timestamp = "2026-04-23T12:00:00.000Z";
  const { calls, store } = memoryReplayStore();
  const verifier = buildWebhookVerifier({
    replayProtection: { keyPrefix: "test:", store, ttlSeconds: 60 },
    secret: "shared-secret",
  });
  let handled = 0;

  const first = await verifier.handleOnce(
    {
      body,
      headers: signedWebhookHeaders({ body, eventId, timestamp }),
      now: new Date("2026-04-23T12:01:00.000Z"),
    },
    async event => {
      handled += 1;
      return event.eventId;
    },
  );
  const second = await verifier.handleOnce(
    {
      body,
      headers: signedWebhookHeaders({ body, eventId, timestamp }),
      now: new Date("2026-04-23T12:01:00.000Z"),
    },
    async () => {
      handled += 1;
      return "duplicate";
    },
  );

  assert.equal(first.status, "processed");
  assert.equal(first.value, eventId);
  assert.equal(second.status, "duplicate");
  assert.equal(handled, 1);
  assert.deepEqual(calls, ["claim:test:event-once", "complete:test:event-once", "claim:test:event-once"]);
});

test("buildWebhookVerifier handleOnce does not claim invalid callbacks", async () => {
  const body = JSON.stringify({ operationKey: `0x${"44".repeat(32)}` });
  const { calls, store } = memoryReplayStore();
  const verifier = buildWebhookVerifier({
    replayProtection: { store },
    secret: "shared-secret",
  });

  await assert.rejects(
    () =>
      verifier.handleOnce(
        {
          body,
          headers: signedWebhookHeaders({
            body,
            eventId: "event-invalid",
            secret: "wrong-secret",
            timestamp: "2026-04-23T12:00:00.000Z",
          }),
          now: new Date("2026-04-23T12:01:00.000Z"),
        },
        async () => "unused",
      ),
    /Invalid RateLoop webhook signature/,
  );
  assert.deepEqual(calls, []);
});

test("buildWebhookVerifier handleOnce releases failed handler claims for retry", async () => {
  const body = JSON.stringify({ operationKey: `0x${"44".repeat(32)}` });
  const eventId = "event-retry";
  const timestamp = "2026-04-23T12:00:00.000Z";
  const { calls, store } = memoryReplayStore();
  const verifier = buildWebhookVerifier({
    replayProtection: { store },
    secret: "shared-secret",
  });

  await assert.rejects(
    () =>
      verifier.handleOnce(
        {
          body,
          headers: signedWebhookHeaders({ body, eventId, timestamp }),
          now: new Date("2026-04-23T12:01:00.000Z"),
        },
        async () => {
          throw new Error("handler failed");
        },
      ),
    /handler failed/,
  );
  const retry = await verifier.handleOnce(
    {
      body,
      headers: signedWebhookHeaders({ body, eventId, timestamp }),
      now: new Date("2026-04-23T12:01:00.000Z"),
    },
    async () => "ok",
  );

  assert.equal(retry.status, "processed");
  assert.equal(retry.value, "ok");
  assert.deepEqual(calls, [
    "claim:rateloop:webhook:event-retry",
    "release:rateloop:webhook:event-retry",
    "claim:rateloop:webhook:event-retry",
    "complete:rateloop:webhook:event-retry",
  ]);
});
