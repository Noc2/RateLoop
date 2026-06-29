import {
  type X402QuestionParserOptions,
  type X402QuestionPayload,
  type X402QuestionPaymentNonceFeedbackBonus,
  type X402QuestionPaymentNonceQuestion,
  type X402QuestionPaymentNonceRewardTerms,
  X402_SUBMISSION_REWARD_ASSET_LREP,
  X402_SUBMISSION_REWARD_ASSET_USDC,
  buildDeterministicX402QuestionSalt,
  buildX402QuestionOneShotPaymentNonce,
  buildX402QuestionOperation,
  buildX402QuestionPaymentNonce,
  buildX402QuestionSubmissionKey,
  parseX402QuestionRequest,
} from "@rateloop/agents/x402-question-payload";
import { getUsdcEip712DomainName } from "@rateloop/contracts/protocol";
import { type Address, type Hex, isAddress } from "viem";

type JsonRecord = Record<string, unknown>;

const X402_PRIMARY_TYPE = "ReceiveWithAuthorization";
const MAX_X402_AUTHORIZATION_VALIDITY_SECONDS = 24n * 60n * 60n;
const X402_AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

type BrowserX402Authorization = {
  from: Address;
  nonce: Hex;
  to: Address;
  validAfter: string;
  validBefore: string;
  value: string;
};

type BrowserX402TypedData = {
  domain: {
    chainId: number;
    name: string;
    verifyingContract: Address;
    version: "2";
  };
  message: BrowserX402Authorization;
  primaryType: typeof X402_PRIMARY_TYPE;
  types: {
    [X402_PRIMARY_TYPE]: Array<{ name: string; type: string }>;
  };
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: JsonRecord, expectedKeys: readonly string[], fieldName: string) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpected.length || actualKeys.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${fieldName} has unexpected fields.`);
  }
}

function normalizeAddressField(value: unknown, fieldName: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${fieldName} must be an EVM address.`);
  }
  return value as Address;
}

function normalizeBytes32(value: unknown, fieldName: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${fieldName} must be a 32-byte hex value.`);
  }
  return value as Hex;
}

function normalizeUintString(value: unknown, fieldName: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${fieldName} must be a non-negative integer.`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${fieldName} must be a non-negative safe integer.`);
    }
    return BigInt(value).toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim()).toString();
  }
  throw new Error(`${fieldName} must be a non-negative integer string.`);
}

function normalizeChainId(value: unknown, fieldName: string): number {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer.`);
  }
  return chainId;
}

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function readTypedData(request: JsonRecord | null | undefined): BrowserX402TypedData {
  const typedData = request?.typedData ?? request?.eip712;
  if (!isRecord(typedData)) {
    throw new Error("RateLoop did not return EIP-3009 USDC typed data.");
  }

  const domain = typedData.domain;
  if (!isRecord(domain)) {
    throw new Error("Signing intent is missing an EIP-712 domain.");
  }
  assertExactKeys(domain, ["chainId", "name", "verifyingContract", "version"], "EIP-712 domain");
  if (typeof domain.name !== "string" || !domain.name.trim()) {
    throw new Error("EIP-712 domain.name must be a non-empty string.");
  }
  if (domain.version !== "2") {
    throw new Error("EIP-712 domain.version must be 2.");
  }
  const chainId = normalizeChainId(domain.chainId, "EIP-712 domain.chainId");
  const expectedDomainName = getUsdcEip712DomainName(chainId);
  if (domain.name !== expectedDomainName) {
    throw new Error(`EIP-712 domain.name must be ${expectedDomainName}.`);
  }

  const primaryType = typedData.primaryType;
  if (primaryType !== X402_PRIMARY_TYPE) {
    throw new Error(`Signing intent primaryType must be ${X402_PRIMARY_TYPE}.`);
  }

  const types = typedData.types;
  if (!isRecord(types)) {
    throw new Error("Signing intent is missing types.");
  }
  assertExactKeys(types, [X402_PRIMARY_TYPE], "EIP-3009 typedData.types");
  const fields = types[X402_PRIMARY_TYPE];
  if (!Array.isArray(fields) || fields.length !== X402_AUTHORIZATION_FIELDS.length) {
    throw new Error(`EIP-3009 typedData.types.${X402_PRIMARY_TYPE} must contain the standard fields.`);
  }
  fields.forEach((field, index) => {
    const expected = X402_AUTHORIZATION_FIELDS[index];
    if (!isRecord(field) || field.name !== expected.name || field.type !== expected.type) {
      throw new Error(
        `EIP-3009 typedData.types.${X402_PRIMARY_TYPE}[${index}] must be ${expected.name} ${expected.type}.`,
      );
    }
  });

  const message = normalizeAuthorizationRecord(typedData.message, "EIP-3009 typedData.message");
  return {
    domain: {
      chainId,
      name: domain.name,
      verifyingContract: normalizeAddressField(domain.verifyingContract, "EIP-712 domain.verifyingContract"),
      version: "2",
    },
    message,
    primaryType: X402_PRIMARY_TYPE,
    types: {
      ReceiveWithAuthorization: X402_AUTHORIZATION_FIELDS.map(field => ({ ...field })),
    },
  };
}

function normalizeAuthorizationRecord(value: unknown, fieldName: string): BrowserX402Authorization {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  assertExactKeys(value, ["from", "nonce", "to", "validAfter", "validBefore", "value"], fieldName);
  return {
    from: normalizeAddressField(value.from, `${fieldName}.from`),
    nonce: normalizeBytes32(value.nonce, `${fieldName}.nonce`),
    to: normalizeAddressField(value.to, `${fieldName}.to`),
    validAfter: normalizeUintString(value.validAfter, `${fieldName}.validAfter`),
    validBefore: normalizeUintString(value.validBefore, `${fieldName}.validBefore`),
    value: normalizeUintString(value.value, `${fieldName}.value`),
  };
}

function assertAuthorizationMatchesMessage(authorization: BrowserX402Authorization, message: BrowserX402Authorization) {
  if (!sameAddress(authorization.from, message.from)) {
    throw new Error("EIP-3009 authorization.from must match typedData.message.from.");
  }
  if (!sameAddress(authorization.to, message.to)) {
    throw new Error("EIP-3009 authorization.to must match typedData.message.to.");
  }
  if (authorization.nonce.toLowerCase() !== message.nonce.toLowerCase()) {
    throw new Error("EIP-3009 authorization.nonce must match typedData.message.nonce.");
  }
  for (const field of ["value", "validAfter", "validBefore"] as const) {
    if (authorization[field] !== message[field]) {
      throw new Error(`EIP-3009 authorization.${field} must match typedData.message.${field}.`);
    }
  }
}

export function readBrowserSigningBountyAmount(requestBody: JsonRecord | null | undefined) {
  if (!isRecord(requestBody?.bounty)) {
    throw new Error("Signing intent request body is missing bounty.amount.");
  }
  return normalizeUintString(requestBody.bounty.amount, "bounty.amount");
}

export function readBrowserSigningExpectedX402Amount(requestBody: JsonRecord | null | undefined) {
  const bountyAmount = BigInt(readBrowserSigningBountyAmount(requestBody));
  const feedbackBonus = isRecord(requestBody?.feedbackBonus) ? requestBody.feedbackBonus : null;
  if (!feedbackBonus) return bountyAmount.toString();

  const rawAsset = typeof feedbackBonus.asset === "string" ? feedbackBonus.asset.trim().toUpperCase() : "USDC";
  if (rawAsset === "LREP") {
    throw new Error("LREP Feedback Bonuses require wallet_calls funding mode.");
  }
  if (rawAsset !== "USDC") {
    throw new Error("feedbackBonus.asset must be USDC for x402 authorization.");
  }

  return (bountyAmount + BigInt(normalizeUintString(feedbackBonus.amount, "feedbackBonus.amount"))).toString();
}

function normalizeUintBigInt(value: unknown, fieldName: string): bigint {
  return BigInt(normalizeUintString(value, fieldName));
}

function onChainQuestionForPaymentNonce(
  question: X402QuestionPayload["questions"][number],
): X402QuestionPayload["questions"][number] {
  if (question.confidentiality?.visibility !== "gated") return question;
  return {
    ...question,
    contextUrl: "",
    detailsUrl: "",
    imageUrls: [],
    videoUrl: "",
  };
}

function buildPaymentNonceQuestion(params: {
  index: number;
  operationKey: Hex;
  payloadHash: string;
  question: X402QuestionPayload["questions"][number];
  walletAddress: Address;
}): X402QuestionPaymentNonceQuestion {
  const question = onChainQuestionForPaymentNonce(params.question);
  const submissionKey = buildX402QuestionSubmissionKey({
    categoryId: question.categoryId,
    contextUrl: question.contextUrl,
    detailsHash: question.detailsHash as Hex,
    detailsUrl: question.detailsUrl,
    imageUrls: question.imageUrls,
    tags: question.tags,
    title: question.title,
    videoUrl: question.videoUrl,
  });
  return {
    categoryId: question.categoryId,
    confidentiality: params.question.confidentiality,
    contextUrl: question.contextUrl,
    detailsHash: question.detailsHash as Hex,
    detailsUrl: question.detailsUrl,
    imageUrls: question.imageUrls,
    salt: buildDeterministicX402QuestionSalt({
      index: params.index,
      operationKey: params.operationKey,
      payloadHash: params.payloadHash,
      submissionKey,
      walletAddress: params.walletAddress,
    }),
    spec: {
      questionMetadataHash: params.question.questionMetadataHash as Hex,
      resultSpecHash: params.question.resultSpecHash as Hex,
    },
    tags: question.tags,
    title: question.title,
    videoUrl: question.videoUrl,
  };
}

function buildPaymentRewardTerms(payload: X402QuestionPayload): X402QuestionPaymentNonceRewardTerms {
  return {
    amount: payload.bounty.amount,
    asset: payload.bounty.asset === "LREP" ? X402_SUBMISSION_REWARD_ASSET_LREP : X402_SUBMISSION_REWARD_ASSET_USDC,
    bountyEligibility: payload.bounty.bountyEligibility,
    bountyStartBy: payload.bounty.bountyStartBy,
    bountyWindowSeconds: payload.bounty.bountyWindowSeconds,
    feedbackWindowSeconds: payload.bounty.feedbackWindowSeconds,
    requiredSettledRounds: payload.bounty.requiredSettledRounds,
    requiredVoters: payload.bounty.requiredVoters,
  };
}

function readBrowserSigningFeedbackBonus(params: {
  payload: X402QuestionPayload;
  requestBody: JsonRecord;
  walletAddress: Address;
}): X402QuestionPaymentNonceFeedbackBonus | null {
  const raw = params.requestBody.feedbackBonus;
  if (raw === undefined || raw === null || raw === false) return null;
  if (!isRecord(raw)) {
    throw new Error("feedbackBonus must be an object when provided.");
  }

  const asset = typeof raw.asset === "string" ? raw.asset.trim().toUpperCase() : "USDC";
  if (asset === "LREP") return null;
  if (asset !== "USDC") {
    throw new Error("feedbackBonus.asset must be USDC for x402 authorization.");
  }

  const amount = normalizeUintBigInt(raw.amount, "feedbackBonus.amount");
  if (amount <= 0n) {
    throw new Error("feedbackBonus.amount must be greater than zero.");
  }

  const feedbackWindowClosesAt = params.payload.bounty.bountyStartBy + params.payload.bounty.feedbackWindowSeconds;
  const feedbackClosesAt = normalizeUintBigInt(
    raw.feedbackClosesAt ?? feedbackWindowClosesAt,
    "feedbackBonus.feedbackClosesAt",
  );
  if (feedbackClosesAt <= 0n) {
    throw new Error("feedbackBonus.feedbackClosesAt must be greater than zero.");
  }
  if (feedbackClosesAt > feedbackWindowClosesAt) {
    throw new Error("feedbackBonus.feedbackClosesAt cannot be after the requested feedback window.");
  }

  const awarder = typeof raw.awarder === "string" && raw.awarder.trim() ? raw.awarder.trim() : params.walletAddress;
  return {
    amount,
    awarder: normalizeAddressField(awarder, "feedbackBonus.awarder"),
    feedbackClosesAt,
  };
}

export function buildBrowserSigningExpectedX402Nonce(params: {
  expectedChainId: number;
  expectedContentRegistryAddress: Address;
  expectedFeedbackBonusEscrowAddress?: Address;
  expectedQuestionRewardPoolEscrowAddress: Address;
  expectedSubmitterAddress: Address;
  expectedWalletAddress: Address;
  questionMetadataBaseUrl?: string | null;
  requestBody: JsonRecord | null | undefined;
  x402Authorization: BrowserX402Authorization;
}): Hex {
  if (!isRecord(params.requestBody)) {
    throw new Error("Signing intent request body is missing.");
  }
  const parserOptions: X402QuestionParserOptions = {
    questionMetadataBaseUrl: params.questionMetadataBaseUrl,
  };
  const payload = parseX402QuestionRequest(params.requestBody, params.expectedChainId, parserOptions);
  if (payload.chainId !== params.expectedChainId) {
    throw new Error("Signing intent request body chainId does not match the connected chain.");
  }
  if (payload.questions.length !== 1) {
    throw new Error("EIP-3009 USDC authorization currently supports single-question asks only.");
  }
  if (payload.bounty.asset !== "USDC") {
    throw new Error("LREP bounties require wallet_calls funding mode.");
  }

  const operation = buildX402QuestionOperation(payload, parserOptions);
  const primaryQuestion = payload.questions[0];
  if (!primaryQuestion) {
    throw new Error("Question payload is empty.");
  }
  const question = buildPaymentNonceQuestion({
    index: 0,
    operationKey: operation.operationKey as Hex,
    payloadHash: operation.payloadHash,
    question: primaryQuestion,
    walletAddress: params.expectedWalletAddress,
  });
  const rewardTerms = buildPaymentRewardTerms(payload);
  const feedbackBonus = readBrowserSigningFeedbackBonus({
    payload,
    requestBody: params.requestBody,
    walletAddress: params.expectedWalletAddress,
  });

  if (feedbackBonus) {
    if (!params.expectedFeedbackBonusEscrowAddress) {
      throw new Error("Cannot validate x402 authorization without a configured Feedback Bonus escrow.");
    }
    return buildX402QuestionOneShotPaymentNonce({
      chainId: payload.chainId,
      contentRegistryAddress: params.expectedContentRegistryAddress,
      feedbackBonus,
      feedbackBonusEscrowAddress: params.expectedFeedbackBonusEscrowAddress,
      question,
      questionRewardPoolEscrowAddress: params.expectedQuestionRewardPoolEscrowAddress,
      rewardTerms,
      roundConfig: payload.roundConfig,
      x402Authorization: params.x402Authorization,
      x402QuestionSubmitterAddress: params.expectedSubmitterAddress,
    });
  }

  return buildX402QuestionPaymentNonce({
    chainId: payload.chainId,
    contentRegistryAddress: params.expectedContentRegistryAddress,
    question,
    questionRewardPoolEscrowAddress: params.expectedQuestionRewardPoolEscrowAddress,
    rewardTerms,
    roundConfig: payload.roundConfig,
    x402Authorization: params.x402Authorization,
    x402QuestionSubmitterAddress: params.expectedSubmitterAddress,
  });
}

export function validateBrowserX402AuthorizationRequest(params: {
  expectedAmount: string | bigint | number;
  expectedChainId: number;
  expectedContentRegistryAddress: Address;
  expectedFeedbackBonusEscrowAddress?: Address;
  expectedQuestionRewardPoolEscrowAddress: Address;
  expectedSubmitterAddress: Address;
  expectedUsdcAddress: Address;
  expectedWalletAddress: Address;
  questionMetadataBaseUrl?: string | null;
  request: JsonRecord | null | undefined;
  requestBody: JsonRecord | null | undefined;
}): { authorization: BrowserX402Authorization; typedData: BrowserX402TypedData } {
  const typedData = readTypedData(params.request);
  const authorizationSource = isRecord(params.request?.authorization)
    ? params.request.authorization
    : typedData.message;
  const authorization = normalizeAuthorizationRecord(authorizationSource, "x402AuthorizationRequest.authorization");
  assertAuthorizationMatchesMessage(authorization, typedData.message);

  if (typedData.domain.chainId !== params.expectedChainId) {
    throw new Error(
      `Signing intent advertises chain ${params.expectedChainId} but the EIP-712 domain is bound to chain ${typedData.domain.chainId}. Refusing to sign.`,
    );
  }
  if (!sameAddress(typedData.domain.verifyingContract, params.expectedUsdcAddress)) {
    throw new Error("EIP-712 domain.verifyingContract must be the configured USDC token.");
  }
  if (!sameAddress(authorization.from, params.expectedWalletAddress)) {
    throw new Error("EIP-3009 authorization.from must match the connected wallet.");
  }
  if (!sameAddress(authorization.to, params.expectedSubmitterAddress)) {
    throw new Error("EIP-3009 authorization.to must be the configured RateLoop submitter.");
  }
  if (authorization.value !== normalizeUintString(params.expectedAmount, "expected EIP-3009 amount")) {
    throw new Error("EIP-3009 authorization.value must equal the requested x402 payment amount.");
  }
  const validBefore = BigInt(authorization.validBefore);
  if (validBefore <= BigInt(authorization.validAfter)) {
    throw new Error("EIP-3009 authorization.validBefore must be greater than validAfter.");
  }
  const maxValidBefore = BigInt(Math.floor(Date.now() / 1000)) + MAX_X402_AUTHORIZATION_VALIDITY_SECONDS;
  if (validBefore > maxValidBefore) {
    throw new Error(
      `EIP-3009 authorization.validBefore must be within ${MAX_X402_AUTHORIZATION_VALIDITY_SECONDS.toString()} seconds (24 hours) of now.`,
    );
  }

  const expectedNonce = buildBrowserSigningExpectedX402Nonce({
    expectedChainId: params.expectedChainId,
    expectedContentRegistryAddress: params.expectedContentRegistryAddress,
    expectedFeedbackBonusEscrowAddress: params.expectedFeedbackBonusEscrowAddress,
    expectedQuestionRewardPoolEscrowAddress: params.expectedQuestionRewardPoolEscrowAddress,
    expectedSubmitterAddress: params.expectedSubmitterAddress,
    expectedWalletAddress: params.expectedWalletAddress,
    questionMetadataBaseUrl:
      params.questionMetadataBaseUrl ??
      (typeof params.request?.questionMetadataBaseUrl === "string"
        ? params.request.questionMetadataBaseUrl
        : undefined),
    requestBody: params.requestBody,
    x402Authorization: authorization,
  });
  if (authorization.nonce.toLowerCase() !== expectedNonce.toLowerCase()) {
    throw new Error("EIP-3009 authorization.nonce does not match the RateLoop ask payload.");
  }

  return { authorization, typedData };
}
