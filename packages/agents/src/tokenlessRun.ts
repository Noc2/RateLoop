import { writeFile } from "node:fs/promises";
import type {
  TokenlessAskRequest,
  TokenlessDeploymentIdentity,
  TokenlessQuoteRequest,
  TokenlessRateLoopClient,
} from "@rateloop/sdk";
import {
  buildTokenlessQuoteIntent,
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
  deployment: TokenlessDeploymentIdentity;
  /** Hard local ceiling in atomic USDC units. The server cannot raise it. */
  maxTotalFundedAtomic: string;
  /** Locally approved platform terms that every signed round must match. */
  roundPolicy: TokenlessAutonomousRoundPolicy;
};

export type TokenlessAutonomousRoundPolicy = {
  beaconNetworkHash: `0x${string}`;
  beaconGenesisSeconds: number;
  beaconPeriodSeconds: number;
  revealWindowSeconds: number;
  beaconFailureGraceSeconds: number;
  claimGracePeriodSeconds: number;
  feeRecipient: `0x${string}`;
  /** Permitted server/local clock difference when binding the commit deadline. Defaults to 300 seconds. */
  clockSkewToleranceSeconds?: number;
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

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/u;

function assertIdempotencyKey(value: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new Error(
      "idempotencyKey must be 8-160 characters using letters, numbers, dot, underscore, colon, or hyphen.",
    );
  }
}

function atomicAmount(value: string, name: string) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned atomic USDC amount.`);
  }
  return BigInt(value);
}

function policyInteger(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value! < minimum || value! > maximum) {
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return BigInt(value!);
}

function exactHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function assertSignedRoundMatchesIntent(input: {
  request: TokenlessAutonomousRunInput;
  quoteIntent: ReturnType<typeof buildTokenlessQuoteIntent>;
  instructions: Awaited<
    ReturnType<TokenlessRateLoopClient["paymentInstructions"]>
  >;
  requestedAtSeconds: bigint;
  receivedAtSeconds: bigint;
}) {
  const terms = input.instructions.roundTerms;
  const policy = input.request.roundPolicy;
  if (!exactHex(terms.contentId, input.quoteIntent.contentId)) {
    throw new Error(
      "The payment instructions changed the locally requested question content.",
    );
  }
  if (!exactHex(terms.termsHash, input.quoteIntent.termsHash)) {
    throw new Error(
      "The payment instructions changed the locally requested review terms.",
    );
  }
  if (
    !exactHex(
      terms.admissionPolicyHash,
      input.quoteIntent.normalizedRequest.audience.admissionPolicyHash,
    )
  ) {
    throw new Error(
      "The payment instructions changed the locally requested audience.",
    );
  }
  const bounty = atomicAmount(
    input.quoteIntent.normalizedRequest.budget.bountyAtomic,
    "quote.budget.bountyAtomic",
  );
  const reserve = atomicAmount(
    input.quoteIntent.normalizedRequest.budget.attemptReserveAtomic,
    "quote.budget.attemptReserveAtomic",
  );
  const fee =
    (bounty * BigInt(input.quoteIntent.normalizedRequest.budget.feeBps)) /
    10_000n;
  const maximumCommits = BigInt(
    input.quoteIntent.normalizedRequest.requestedPanelSize,
  );
  const minimumReveals = BigInt(
    Math.max(3, Math.ceil(Number(maximumCommits) * 0.8)),
  );
  const attemptCompensation = ((bounty / maximumCommits) * 8_000n) / 10_000n;
  for (const [name, actual, expected] of [
    ["bounty allocation", terms.bountyAmount, bounty],
    ["fee allocation", terms.feeAmount, fee],
    ["attempt reserve", terms.attemptReserve, reserve],
    ["attempt compensation", terms.attemptCompensation, attemptCompensation],
    ["minimum reveals", terms.minimumReveals, minimumReveals],
    ["maximum commits", terms.maximumCommits, maximumCommits],
  ] as const) {
    const normalizedActual =
      typeof actual === "number"
        ? BigInt(actual)
        : atomicAmount(actual, `roundTerms.${name}`);
    if (normalizedActual !== expected)
      throw new Error(`The payment instructions changed the ${name}.`);
  }

  if (
    !/^0x[0-9a-fA-F]{64}$/.test(policy.beaconNetworkHash) ||
    /^0x0{64}$/i.test(policy.beaconNetworkHash)
  ) {
    throw new Error("roundPolicy.beaconNetworkHash must be a bytes32 value.");
  }
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(policy.feeRecipient) ||
    /^0x0{40}$/i.test(policy.feeRecipient)
  ) {
    throw new Error("roundPolicy.feeRecipient must be an EVM address.");
  }
  if (!exactHex(terms.beaconNetworkHash, policy.beaconNetworkHash)) {
    throw new Error(
      "The payment instructions changed the approved beacon network.",
    );
  }
  if (!exactHex(terms.feeRecipient, policy.feeRecipient)) {
    throw new Error(
      "The payment instructions changed the approved fee recipient.",
    );
  }
  const revealWindow = policyInteger(
    policy.revealWindowSeconds,
    "roundPolicy.revealWindowSeconds",
    1,
    86_400,
  );
  const beaconGrace = policyInteger(
    policy.beaconFailureGraceSeconds,
    "roundPolicy.beaconFailureGraceSeconds",
    21_600,
    86_400,
  );
  const claimGrace = policyInteger(
    policy.claimGracePeriodSeconds,
    "roundPolicy.claimGracePeriodSeconds",
    1,
    30 * 86_400,
  );
  const beaconGenesis = policyInteger(
    policy.beaconGenesisSeconds,
    "roundPolicy.beaconGenesisSeconds",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const beaconPeriod = policyInteger(
    policy.beaconPeriodSeconds,
    "roundPolicy.beaconPeriodSeconds",
    1,
    3_600,
  );
  const skew = policyInteger(
    policy.clockSkewToleranceSeconds ?? 300,
    "roundPolicy.clockSkewToleranceSeconds",
    0,
    900,
  );
  const responseWindow = BigInt(
    input.quoteIntent.normalizedRequest.responseWindowSeconds,
  );
  const commitDeadline = atomicAmount(
    terms.commitDeadline,
    "roundTerms.commitDeadline",
  );
  const revealDeadline = atomicAmount(
    terms.revealDeadline,
    "roundTerms.revealDeadline",
  );
  const beaconFailureDeadline = atomicAmount(
    terms.beaconFailureDeadline,
    "roundTerms.beaconFailureDeadline",
  );
  if (
    commitDeadline < input.requestedAtSeconds + responseWindow - skew ||
    commitDeadline > input.receivedAtSeconds + responseWindow + skew
  ) {
    throw new Error(
      "The payment instructions changed the approved response deadline.",
    );
  }
  if (revealDeadline - commitDeadline !== revealWindow) {
    throw new Error(
      "The payment instructions changed the approved reveal window.",
    );
  }
  if (beaconFailureDeadline - revealDeadline !== beaconGrace) {
    throw new Error(
      "The payment instructions changed the approved beacon-failure grace period.",
    );
  }
  if (
    atomicAmount(terms.claimGracePeriod, "roundTerms.claimGracePeriod") !==
    claimGrace
  ) {
    throw new Error(
      "The payment instructions changed the approved claim grace period.",
    );
  }
  if (commitDeadline < beaconGenesis)
    throw new Error("The payment instructions use an invalid beacon deadline.");
  const expectedBeaconRound =
    (commitDeadline - beaconGenesis) / beaconPeriod + 1n;
  if (
    atomicAmount(terms.beaconRound, "roundTerms.beaconRound") !==
    expectedBeaconRound
  ) {
    throw new Error(
      "The payment instructions changed the deterministic beacon round.",
    );
  }
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
  const quoteIntent = buildTokenlessQuoteIntent(input.request.quote, quote);
  const quoteTotal = atomicAmount(
    quote.economics.totalFundedAtomic,
    "quote.economics.totalFundedAtomic",
  );
  const localCeiling = atomicAmount(
    input.request.maxTotalFundedAtomic,
    "maxTotalFundedAtomic",
  );
  if (quoteTotal > localCeiling) {
    throw new Error(
      "The accepted quote exceeds the local autonomous spend ceiling.",
    );
  }
  const ask = await input.client.ask({
    idempotencyKey: input.request.idempotencyKey,
    payment: { mode: "x402", payerAddress: input.account.address },
    quoteId: quote.quoteId,
  } satisfies TokenlessAskRequest);
  const instructionRequestedAtSeconds = BigInt(Math.floor(Date.now() / 1_000));
  const instructions = await input.client.paymentInstructions({
    operationKey: ask.operationKey,
  });
  const instructionReceivedAtSeconds = BigInt(Math.floor(Date.now() / 1_000));
  if (
    instructions.funderAddress.toLowerCase() !==
    input.account.address.toLowerCase()
  ) {
    throw new Error(
      "The payment instructions are not bound to the local agent wallet.",
    );
  }
  const instructionTotal = atomicAmount(
    instructions.totalFundedAtomic,
    "paymentInstructions.totalFundedAtomic",
  );
  if (instructionTotal !== quoteTotal) {
    throw new Error(
      "The payment instructions do not match the accepted quote total.",
    );
  }
  if (instructionTotal > localCeiling) {
    throw new Error(
      "The payment instructions exceed the local autonomous spend ceiling.",
    );
  }
  assertSignedRoundMatchesIntent({
    request: input.request,
    quoteIntent,
    instructions,
    requestedAtSeconds: instructionRequestedAtSeconds,
    receivedAtSeconds: instructionReceivedAtSeconds,
  });
  const typed = buildTokenlessX402Authorization(
    instructions,
    undefined,
    input.request.deployment,
  );
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
    await writeFile(input.resumePath, `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
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
    result:
      state.status === "ready"
        ? await input.client.result({ operationKey: ask.operationKey })
        : null,
  };
}
