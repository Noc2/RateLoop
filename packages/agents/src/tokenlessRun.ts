import { writeFile } from "node:fs/promises";
import type {
  TokenlessAskRequest,
  TokenlessQuoteRequest,
  TokenlessRateLoopClient,
} from "@rateloop/sdk";
import {
  buildTokenlessX402Authorization,
  serializeTokenlessX402Authorization,
} from "@rateloop/sdk";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { splitTokenlessSignature } from "./tokenlessSigner";
import { waitUntilTokenlessReady } from "./tokenless";

export type TokenlessAutonomousRunInput = {
  quote: TokenlessQuoteRequest;
  idempotencyKey: string;
};

export type TokenlessResumeReceipt = {
  schemaVersion: "rateloop.tokenless.agent-resume.v1";
  apiBaseUrl: string;
  operationKey: string;
  idempotencyKey: string;
  deploymentKey: string;
  payerAddress: `0x${string}`;
  totalFundedAtomic: string;
  createdAt: string;
};

function assertIdempotencyKey(value: string) {
  if (!value.trim() || value.length > 200) throw new Error("idempotencyKey must be 1-200 characters.");
}

export async function runTokenlessAutonomous(input: {
  client: TokenlessRateLoopClient;
  apiBaseUrl: string;
  account: PrivateKeyAccount;
  request: TokenlessAutonomousRunInput;
  maxWaitMs?: number;
  resumePath?: string;
}) {
  assertIdempotencyKey(input.request.idempotencyKey);
  const quote = await input.client.quote(input.request.quote);
  const ask = await input.client.ask({
    idempotencyKey: input.request.idempotencyKey,
    payment: { mode: "x402", payerAddress: input.account.address },
    quoteId: quote.quoteId,
  } satisfies TokenlessAskRequest);
  const instructions = await input.client.paymentInstructions({ operationKey: ask.operationKey });
  if (instructions.funderAddress.toLowerCase() !== input.account.address.toLowerCase()) {
    throw new Error("The payment instructions are not bound to the local agent wallet.");
  }
  const typed = buildTokenlessX402Authorization(instructions);
  const eip3009Signature = await input.account.signTypedData({
    domain: typed.eip3009.domain,
    types: typed.eip3009.types,
    primaryType: typed.eip3009.primaryType,
    message: typed.eip3009.message,
  });
  const roundAuthorizationSignature = await input.account.signTypedData({
    domain: typed.roundAuthorization.domain,
    types: typed.roundAuthorization.types,
    primaryType: typed.roundAuthorization.primaryType,
    message: typed.roundAuthorization.message,
  });
  const signature = splitTokenlessSignature(eip3009Signature);
  const authorization = serializeTokenlessX402Authorization({
    validAfter: typed.eip3009.message.validAfter.toString(),
    validBefore: typed.eip3009.message.validBefore.toString(),
    nonce: typed.eip3009.message.nonce,
    v: signature.v,
    r: signature.r,
    s: signature.s,
    roundAuthorizationSignature: roundAuthorizationSignature as Hex,
  });
  const payment = await input.client.submitPayment({
    operationKey: ask.operationKey,
    authorization,
  });
  const receipt: TokenlessResumeReceipt = {
    schemaVersion: "rateloop.tokenless.agent-resume.v1",
    apiBaseUrl: input.apiBaseUrl,
    operationKey: ask.operationKey,
    idempotencyKey: input.request.idempotencyKey,
    deploymentKey: payment.deploymentKey,
    payerAddress: input.account.address,
    totalFundedAtomic: payment.totalFundedAtomic,
    createdAt: new Date().toISOString(),
  };
  if (input.resumePath) {
    await writeFile(input.resumePath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  }
  const state = await waitUntilTokenlessReady(input.client, {
    maxWaitMs: input.maxWaitMs ?? 300_000,
    operationKey: ask.operationKey,
  });
  return {
    ask,
    payment,
    state,
    receipt,
    result: state.status === "ready" ? await input.client.result({ operationKey: ask.operationKey }) : null,
  };
}
