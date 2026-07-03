import {
  createRateLoopAgentClient,
  type AskHandoffResponse,
  type RateLoopAgentClient,
} from "@rateloop/sdk/agent";
import { pathToFileURL } from "node:url";

const PRODUCTION_API_BASE_URL = "https://www.rateloop.ai";
const BASE_MAINNET_CHAIN_ID = 8453;
const apiBaseUrl =
  process.env.RATELOOP_API_BASE_URL ?? PRODUCTION_API_BASE_URL;
const mcpAccessToken = process.env.RATELOOP_MCP_TOKEN;
const walletAddress = process.env.RATELOOP_AGENT_WALLET_ADDRESS;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPollAfterMs(response: { pollAfterMs?: unknown }) {
  return typeof response.pollAfterMs === "number" && response.pollAfterMs > 0
    ? response.pollAfterMs
    : 15_000;
}

function isTerminalHandoffStatus(response: AskHandoffResponse) {
  return (
    response.terminal === true ||
    response.status === "failed" ||
    response.status === "expired" ||
    response.status === "cancelled"
  );
}

function requireOperationKey(response: { operationKey?: string }) {
  if (!response.operationKey) {
    throw new Error("Ask response did not include an operationKey.");
  }
  return response.operationKey;
}

function readChainId() {
  const raw = process.env.RATELOOP_CHAIN_ID ?? String(BASE_MAINNET_CHAIN_ID);
  if (!/^\d+$/.test(raw)) {
    throw new Error("RATELOOP_CHAIN_ID must be a positive base-10 integer.");
  }
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("RATELOOP_CHAIN_ID must be a positive base-10 safe integer.");
  }
  if (chainId !== BASE_MAINNET_CHAIN_ID) {
    throw new Error(
      "The RateLoop example targets the live Base mainnet deployment; set RATELOOP_CHAIN_ID=8453.",
    );
  }
  return chainId;
}

async function waitForHandoffSubmission(
  agent: RateLoopAgentClient,
  handoff: AskHandoffResponse,
): Promise<AskHandoffResponse & { operationKey: string }> {
  const { handoffId, handoffToken } = handoff;
  if (!handoffId || !handoffToken) {
    throw new Error("Browser handoff response did not include polling credentials.");
  }

  let current = handoff;
  for (;;) {
    if (current.operationKey) {
      return current as AskHandoffResponse & { operationKey: string };
    }
    if (isTerminalHandoffStatus(current)) {
      throw new Error(
        `Browser handoff ended before submission: ${JSON.stringify(current)}`,
      );
    }

    await sleep(readPollAfterMs(current));
    current = await agent.getAskHandoffStatus({ handoffId, handoffToken });
    console.log("Handoff status:", JSON.stringify(current, null, 2));
  }
}

async function writeResultToMemory(memory: {
  clientRequestId: string;
  operationKey: string;
  publicUrl: string | null;
  answer: string;
  confidence: unknown;
}) {
  console.log(
    "Persist this record in your agent memory store:",
    JSON.stringify(memory, null, 2),
  );
}

export async function main() {
  if (process.env.RATELOOP_RAW_WALLET_CALLS === "true" && !walletAddress) {
    throw new Error(
      "Set RATELOOP_AGENT_WALLET_ADDRESS when RATELOOP_RAW_WALLET_CALLS=true.",
    );
  }

  const agent = createRateLoopAgentClient({
    apiBaseUrl,
    mcpAccessToken,
  });

  const clientRequestId = `landing-pitch-${Date.now()}`;
  const pitchUrl =
    process.env.RATELOOP_PITCH_URL ?? "https://example.com/landing-page";
  const bountyAmount = process.env.RATELOOP_BOUNTY_AMOUNT ?? "1000000";
  const questionDurationSeconds =
    process.env.RATELOOP_QUESTION_DURATION_SECONDS ?? "1200";

  const question = {
    templateId: "generic_rating",
    templateInputs: {
      audience: "first-time visitors",
      goal: "quick audience interest check for a landing-page pitch",
      successSignal: "Would this make you want to learn more?",
    },
    title: "Would this pitch make you want to learn more?",
    description:
      "Review the linked landing-page pitch. Predict a high final rating only if it is clear, credible, and interesting enough to keep reading.",
    contextUrl: pitchUrl,
    categoryId: "1",
    tags: ["agent", "landing-page", "pitch"],
  };

  const bounty = {
    amount: bountyAmount,
    requiredVoters: "3",
  };
  const chainId = readChainId();
  const roundConfig = { questionDurationSeconds };

  const quote = await agent.quoteQuestion({
    clientRequestId,
    chainId,
    bounty,
    roundConfig,
    question,
    walletAddress,
  });

  console.log("Quote guidance:", JSON.stringify(quote.fastLane, null, 2));

  const askPayload = {
    clientRequestId,
    chainId,
    maxPaymentAmount: quote.payment?.amount ?? bounty.amount,
    bounty,
    roundConfig,
    question,
    walletAddress,
  };

  if (!mcpAccessToken && process.env.RATELOOP_RAW_WALLET_CALLS !== "true") {
    const handoff = await agent.createAskHandoff({
      request: askPayload,
      ttlMs: 30 * 60 * 1000,
    });
    if (!handoff.handoffUrl) {
      throw new Error("Browser handoff response did not include a handoff URL.");
    }
    console.log(
      "Open this browser handoff link to review, fund, and submit the ask:",
      handoff.handoffUrl,
    );
    const ask = await waitForHandoffSubmission(agent, handoff);
    console.log("Submitted ask:", JSON.stringify(ask, null, 2));

    for (;;) {
      const status = await agent.getQuestionStatus({
        operationKey: ask.operationKey,
      });
      console.log("Current status:", JSON.stringify(status, null, 2));

      if (status.ready || status.terminal) {
        break;
      }

      await sleep(status.pollAfterMs ?? 15_000);
    }

    const result = await agent.getResult({ operationKey: ask.operationKey });
    console.log("Structured result:", JSON.stringify(result, null, 2));

    await writeResultToMemory({
      answer: result.answer ?? "unknown",
      clientRequestId,
      confidence: result.confidence ?? null,
      operationKey: ask.operationKey,
      publicUrl: result.publicUrl ?? ask.publicUrl ?? null,
    });
    return;
  }

  const ask = await agent.askHumans(askPayload);
  const operationKey = requireOperationKey(ask);

  console.log("Prepared ask:", JSON.stringify(ask, null, 2));

  if (ask.transactionPlan?.calls?.length) {
    const hashes = (process.env.RATELOOP_CONFIRM_TX_HASHES ?? "")
      .split(",")
      .map((hash) => hash.trim())
      .filter(Boolean);
    if (hashes.length === 0) {
      console.log(
        "Execute transactionPlan.calls from walletAddress, then rerun with RATELOOP_CONFIRM_TX_HASHES. For human wallets, prefer the browser handoff flow instead.",
      );
      return;
    }

    const confirmed = await agent.confirmAskTransactions({
      operationKey,
      transactionHashes: hashes,
    });
    console.log("Confirmed ask:", JSON.stringify(confirmed, null, 2));
  }

  for (;;) {
    const status = await agent.getQuestionStatus({
      operationKey,
    });
    console.log("Current status:", JSON.stringify(status, null, 2));

    if (status.ready || status.terminal) {
      break;
    }

    await sleep(status.pollAfterMs ?? 15_000);
  }

  const result = await agent.getResult({ operationKey });
  console.log("Structured result:", JSON.stringify(result, null, 2));

  await writeResultToMemory({
    answer: result.answer ?? "unknown",
    clientRequestId,
    confidence: result.confidence ?? null,
    operationKey,
    publicUrl: result.publicUrl ?? ask.publicUrl ?? null,
  });
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
