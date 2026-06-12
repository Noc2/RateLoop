import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  erc20Abi,
  http,
  isAddress,
  isHex,
  keccak256,
  parseSignature,
  stringToHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import {
  ContentRegistryAbi,
  X402QuestionSubmitterAbi,
} from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { DEFAULT_ROUND_CONFIG } from "@rateloop/contracts/protocol";
import { normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import type {
  AskHumansRequest,
  AskHumansResponse,
  ConfirmAskTransactionsRequest,
  RateLoopAgentClient,
  RateLoopAgentWalletTransactionCall,
  QuestionStatusResponse,
} from "@rateloop/sdk/agent";
import {
  DEFAULT_AGENT_TEMPLATE_ID,
  DEFAULT_AGENT_TEMPLATE_VERSION,
  buildQuestionSpecHashes,
  normalizeQuestionMetadataBaseUrl,
  type AgentQuestionSpecInput,
} from "./questionSpecs.js";
import { findAgentResultTemplate } from "./templates.js";

type CliOptions = Record<string, string | boolean | undefined>;
type JsonRecord = Record<string, unknown>;

const KEYSTORE_VERSION = 3;
const DEFAULT_SCRYPT_PARAMS = {
  dklen: 32,
  n: 1 << 15,
  p: 1,
  r: 8,
};
const X402_USDC_BY_CHAIN_ID: Record<number, Address> = {
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
};
const X402_PRIMARY_TYPE = "ReceiveWithAuthorization";
const X402_AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;
/**
 * Sanity cap on EIP-3009 authorization lifetimes. The RateLoop server
 * proposes validBefore, so without a cap a compromised or buggy server could
 * obtain a transfer authorization that stays valid for years. Question
 * submissions settle within minutes, so 24 hours is generous headroom.
 */
const MAX_X402_AUTHORIZATION_VALIDITY_SECONDS = 24n * 60n * 60n;
const X402_SUBMISSION_REWARD_ASSET_USDC = 1;
const X402_DEFAULT_SUBMISSION_BOUNTY_USDC = 1_000_000n;
const X402_MIN_REWARD_POOL_REQUIRED_VOTERS = 3n;
const X402_MIN_REWARD_POOL_SETTLED_ROUNDS = 1n;
const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = 2 | 4 | 8;
const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 128;
const X402_MAX_QUESTION_BUNDLE_COUNT = 10;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as Hex;
const DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY = "after_settlement";
const QUESTION_CONTEXT_DOMAIN = keccak256(
  stringToHex("rateloop-question-context-v5"),
);
const QUESTION_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-reveal-v8"),
);
const QUESTION_BUNDLE_ITEM_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-item-v5"),
);
const QUESTION_BUNDLE_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-v5"),
);
const QUESTION_BUNDLE_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-reveal-v6"),
);
const X402_QUESTION_PAYMENT_DOMAIN = keccak256(
  stringToHex("rateloop-x402-question-payment-v3"),
);
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,160}$/;
const DIRECT_IMAGE_URL_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const IMAGE_ATTACHMENT_PATH_PATTERN =
  /^\/api\/attachments\/images\/(att_[A-Za-z0-9_-]{16,80})\.webp$/;
const IMAGE_ATTACHMENT_HASH_PATTERN = /^#sha256=0x[a-fA-F0-9]{64}$/;
const QUESTION_DETAILS_ATTACHMENT_PATH_PATTERN =
  /^\/api\/attachments\/details\/det_[A-Za-z0-9_-]{16,80}$/;
const DEFAULT_IMAGE_ATTACHMENT_ORIGINS = new Set([
  "https://www.rateloop.ai",
  "https://rateloop.ai",
]);
const X402_QUESTION_TOP_LEVEL_FIELDS = new Set([
  "clientRequestId",
  "questions",
  "question",
  "roundConfig",
  "bounty",
  "templateId",
  "templateInputs",
  "templateVersion",
  "confidentiality",
  "chainId",
  "maxPaymentAmount",
  "paymentMode",
  "fundingMode",
  "walletAddress",
  "agentWalletAddress",
  "detailsHash",
  "detailsUrl",
  "mode",
  "webhookUrl",
  "webhookSecret",
  "webhookEvents",
  "paymentAuthorization",
  "signatureMode",
  "transport",
]);

type LocalSignerConfig = {
  chainId?: number;
  chainName: string;
  contentRegistryAddress?: Address;
  feedbackBonusEscrowAddress?: Address;
  keystorePassword?: string;
  keystorePath?: string;
  lrepAddress?: Address;
  pollingIntervalMs: number;
  privateKey?: Hex;
  questionMetadataBaseUrl?: string;
  questionMetadataBaseUrlPinned?: boolean;
  questionRewardPoolEscrowAddress?: Address;
  receiptTimeoutMs: number;
  rpcUrl?: string;
  usdcAddress?: Address;
  x402QuestionSubmitterAddress?: Address;
};

type LoadedLocalSignerWallet = {
  account: PrivateKeyAccount;
  source: "keystore" | "private-key";
};

type GeneratedLocalSignerWallet = LoadedLocalSignerWallet & {
  keystorePath: string;
};

export type LocalTransactionReceiptSummary = {
  blockNumber: string;
  gasUsed: string;
  status: TransactionReceipt["status"];
  transactionHash: Hex;
};

type LocalTransactionExecutionSummary = {
  calls: Array<{
    hash: Hex;
    index: number;
    phase?: string;
    receipt: LocalTransactionReceiptSummary;
    to: Address;
  }>;
  transactionHashes: Hex[];
};

type LocalAskResult = {
  confirmed?: QuestionStatusResponse;
  finalAsk: AskHumansResponse;
  initialAsk: AskHumansResponse;
  signedX402Authorization: boolean;
  transactions?: LocalTransactionExecutionSummary;
  walletAddress: Address;
};

export type LocalAskProgress =
  | { type: "ask_submitted"; response: AskHumansResponse }
  | { type: "x402_signed" }
  | { type: "x402_resubmitted"; response: AskHumansResponse }
  | { type: "transaction_sent"; hash: Hex; index: number; phase?: string }
  | {
      type: "transaction_confirmed";
      hash: Hex;
      index: number;
      receipt: LocalTransactionReceiptSummary;
    }
  | { type: "transactions_confirmed"; response: QuestionStatusResponse };

type KeystoreV3 = {
  address?: string;
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: {
      dklen: number;
      n: number;
      p: number;
      r: number;
      salt: string;
    };
    mac: string;
  };
  id?: string;
  version: 3;
};

type TypedDataField = {
  name: string;
  type: string;
};

type X402TypedData = {
  domain: JsonRecord;
  message: JsonRecord;
  primaryType: string;
  types: Record<string, TypedDataField[]>;
};

type X402Authorization = {
  from?: Address;
  nonce?: Hex;
  signature?: Hex;
  to?: Address;
  validAfter?: string;
  validBefore?: string;
  value?: string;
};

type SignX402AuthorizationOptions = {
  expectedAmount?: bigint | number | string;
  expectedChainId?: number;
  expectedNonce?: Hex;
  expectedUsdcAddress?: Address;
  expectedX402QuestionSubmitterAddress?: Address;
};

type TransactionPlanValidationConfig = Pick<
  LocalSignerConfig,
  | "contentRegistryAddress"
  | "feedbackBonusEscrowAddress"
  | "lrepAddress"
  | "questionMetadataBaseUrl"
  | "questionMetadataBaseUrlPinned"
  | "questionRewardPoolEscrowAddress"
  | "usdcAddress"
  | "x402QuestionSubmitterAddress"
>;

type LocalQuestionRoundConfig = {
  epochDuration: bigint;
  maxDuration: bigint;
  minVoters: bigint;
  maxVoters: bigint;
};

type LocalQuestionPayload = {
  bounty: {
    amount: bigint;
    asset: "USDC";
    bountyEligibility: number;
    bountyStartBy: bigint;
    bountyWindowSeconds: bigint;
    feedbackWindowSeconds: bigint;
    requiredSettledRounds: bigint;
    requiredVoters: bigint;
  };
  chainId: number;
  clientRequestId: string;
  questions: LocalQuestionItemPayload[];
  roundConfig: LocalQuestionRoundConfig;
};

type LocalQuestionConfidentiality = NonNullable<
  AgentQuestionSpecInput["confidentiality"]
>;

type LocalQuestionItemPayload = {
  categoryId: bigint;
  confidentiality: LocalQuestionConfidentiality;
  contextUrl: string;
  detailsHash: Hex;
  detailsUrl: string;
  imageUrls: string[];
  questionMetadataHash: Hex;
  questionMetadataUri: string;
  resultSpecHash: Hex;
  tags: string;
  tagList: string[];
  targetAudience: AgentQuestionSpecInput["targetAudience"];
  templateId: string;
  templateInputs: AgentQuestionSpecInput["templateInputs"];
  templateVersion: number;
  title: string;
  videoUrl: string;
};

type LocalRewardTerms = {
  amount: bigint;
  asset: typeof X402_SUBMISSION_REWARD_ASSET_USDC;
  bountyStartBy: bigint;
  bountyWindowSeconds: bigint;
  bountyEligibility: number;
  feedbackWindowSeconds: bigint;
  requiredSettledRounds: bigint;
  requiredVoters: bigint;
};

type LocalQuestionSubmission = {
  categoryId: bigint;
  confidentiality: LocalQuestionConfidentiality;
  contextUrl: string;
  detailsHash: Hex;
  detailsUrl: string;
  imageUrls: string[];
  salt: Hex;
  spec: {
    questionMetadataHash: Hex;
    resultSpecHash: Hex;
  };
  submissionKey: Hex;
  tags: string;
  title: string;
  videoUrl: string;
};

function buildQuestionConfidentialityHash(
  confidentiality: LocalQuestionConfidentiality,
): Hex {
  const gated = confidentiality.visibility === "gated";
  const asset = gated && confidentiality.bond?.asset === "USDC" ? 1 : 0;
  const amount = gated ? BigInt(confidentiality.bond?.amount ?? "0") : 0n;
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bool" },
        { type: "uint8" },
        { type: "uint64" },
        { type: "uint8" },
      ],
      [gated, asset, amount, 0],
    ),
  );
}

type ExpectedLocalSignerQuestionPlan = {
  canonicalPayload: ReturnType<typeof toCanonicalLocalQuestionPayload>;
  isBundleSubmission: boolean;
  operationKey: Hex;
  payloadHash: string;
  primaryQuestion: LocalQuestionSubmission;
  questions: LocalQuestionSubmission[];
  revealCommitment: Hex;
  rewardTerms: LocalRewardTerms;
  roundConfig: LocalQuestionRoundConfig;
};

function optionString(options: CliOptions, name: string): string | undefined {
  const value = options[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function parsePrivateKey(
  value: string | undefined,
  name: string,
): Hex | undefined {
  if (!value) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key.`);
  }
  return value as Hex;
}

function parseOptionalAddress(
  value: string | undefined,
  name: string,
): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`);
  }
  return value as Address;
}

function parseQuestionMetadataBaseUrl(
  value: string | undefined,
  name: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error();
    }
    return normalizeQuestionMetadataBaseUrl(value);
  } catch {
    throw new Error(
      `${name} must be a public HTTPS URL without query or hash.`,
    );
  }
}

function normalizeInheritedQuestionMetadataBaseUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    return normalizeQuestionMetadataBaseUrl(value);
  } catch {
    return undefined;
  }
}

function resolveLocalSignerQuestionMetadataBaseUrlConfig(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
) {
  const optionValue = optionString(options, "question-metadata-base-url");
  if (optionValue !== undefined) {
    return {
      questionMetadataBaseUrl: parseQuestionMetadataBaseUrl(
        optionValue,
        "question-metadata-base-url",
      ),
      questionMetadataBaseUrlPinned: true,
    };
  }

  const localSignerValue = envString(
    env,
    "RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL",
  );
  if (localSignerValue !== undefined) {
    return {
      questionMetadataBaseUrl: parseQuestionMetadataBaseUrl(
        localSignerValue,
        "RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL",
      ),
      questionMetadataBaseUrlPinned: true,
    };
  }

  const legacyValue = envString(env, "RATELOOP_QUESTION_METADATA_BASE_URL");
  if (legacyValue !== undefined) {
    return {
      questionMetadataBaseUrl: parseQuestionMetadataBaseUrl(
        legacyValue,
        "RATELOOP_QUESTION_METADATA_BASE_URL",
      ),
      questionMetadataBaseUrlPinned: true,
    };
  }

  return {
    questionMetadataBaseUrl: normalizeInheritedQuestionMetadataBaseUrl(
      envString(env, "NEXT_PUBLIC_PONDER_URL") ??
        envString(env, "NEXT_PUBLIC_APP_URL"),
    ),
    questionMetadataBaseUrlPinned: false,
  };
}

function resolveAskQuestionMetadataBaseUrl(params: {
  ask: AskHumansResponse;
  config: TransactionPlanValidationConfig;
}) {
  const serverBaseUrl = readAskQuestionMetadataBaseUrl(params.ask);
  const localBaseUrl = params.config.questionMetadataBaseUrl;
  if (
    serverBaseUrl &&
    localBaseUrl &&
    (params.config.questionMetadataBaseUrlPinned ?? true) &&
    serverBaseUrl !== localBaseUrl
  ) {
    throw new Error(
      `RateLoop ask response questionMetadataBaseUrl ${serverBaseUrl} does not match local signer questionMetadataBaseUrl ${localBaseUrl}.`,
    );
  }
  return serverBaseUrl ?? localBaseUrl;
}

function assertRecord(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as JsonRecord;
}

function normalizeAddress(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an EVM address.`);
  }
  return value as Address;
}

function normalizeHex(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !isHex(value)) {
    throw new Error(`${name} must be hex.`);
  }
  return value as Hex;
}

function normalizeBytes32(value: unknown, name: string): Hex {
  const hex = normalizeHex(value, name);
  if (hex.length !== 66) {
    throw new Error(`${name} must be 32 bytes.`);
  }
  return hex;
}

function normalizeOptionalTransactionData(value: unknown, name: string): Hex {
  if (value === undefined || value === null || value === "") return "0x";
  const hex = normalizeHex(value, name);
  if (hex.length % 2 !== 0) {
    throw new Error(`${name} must be byte-aligned hex.`);
  }
  return hex;
}

function normalizeBigInt(value: unknown, name: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value))
    return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error(`${name} must be an unsigned integer.`);
}

function normalizeOptionalBigInt(
  value: unknown,
  name: string,
): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeBigInt(value, name);
}

function normalizeOptionalChainId(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = normalizeBigInt(value, name);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  const chainId = Number(parsed);
  if (chainId <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return chainId;
}

function normalizeRequiredChainId(value: unknown, name: string): number {
  const chainId = normalizeOptionalChainId(value, name);
  if (chainId === undefined) {
    throw new Error(`${name} is required.`);
  }
  return chainId;
}

function normalizeZeroNativeValue(value: unknown, name: string): 0n {
  const parsed = normalizeOptionalBigInt(value, name) ?? 0n;
  if (parsed !== 0n) {
    throw new Error(
      `${name} must be zero for RateLoop agent transaction plans.`,
    );
  }
  return 0n;
}

function normalizeOperationKey(value: unknown, name: string): Hex {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex string.`);
  }
  return value as Hex;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertExactKeys(
  record: JsonRecord,
  expected: readonly string[],
  name: string,
) {
  const expectedSet = new Set(expected);
  const extras = Object.keys(record).filter((key) => !expectedSet.has(key));
  const missing = expected.filter((key) => record[key] === undefined);
  if (extras.length > 0 || missing.length > 0) {
    const unexpectedSuffix = extras.length
      ? `; unexpected ${extras.join(", ")}`
      : "";
    const missingSuffix = missing.length
      ? `; missing ${missing.join(", ")}`
      : "";
    throw new Error(
      `${name} must contain exactly ${expected.join(", ")}${unexpectedSuffix}${missingSuffix}.`,
    );
  }
}

function stripEip712Domain(
  types: Record<string, TypedDataField[]>,
): Record<string, TypedDataField[]> {
  const { EIP712Domain: _domain, ...rest } = types;
  return rest;
}

function readTypedDataFields(types: unknown): Record<string, TypedDataField[]> {
  const record = assertRecord(types, "x402 typedData.types");
  const parsed: Record<string, TypedDataField[]> = {};

  for (const [typeName, fields] of Object.entries(record)) {
    if (!Array.isArray(fields)) {
      throw new Error(`x402 typedData.types.${typeName} must be an array.`);
    }
    parsed[typeName] = fields.map((field, index) => {
      const fieldRecord = assertRecord(
        field,
        `x402 typedData.types.${typeName}[${index}]`,
      );
      if (
        typeof fieldRecord.name !== "string" ||
        typeof fieldRecord.type !== "string"
      ) {
        throw new Error(
          `x402 typedData.types.${typeName}[${index}] must include name and type.`,
        );
      }
      return { name: fieldRecord.name, type: fieldRecord.type };
    });
  }

  return parsed;
}

function normalizeTypedDataValue(
  value: unknown,
  type: string,
  types: Record<string, TypedDataField[]>,
): unknown {
  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) throw new Error(`Expected ${type} array value.`);
    const itemType = type.slice(0, -2);
    return value.map((item) => normalizeTypedDataValue(item, itemType, types));
  }

  if (/^u?int([0-9]*)$/.test(type)) {
    return normalizeBigInt(value, type);
  }

  if (type === "address") {
    return normalizeAddress(value, type);
  }

  if (type === "bytes32") {
    return normalizeBytes32(value, type);
  }

  if (type === "bytes" || /^bytes[0-9]+$/.test(type)) {
    return normalizeHex(value, type);
  }

  const nested = types[type];
  if (nested) {
    const record = assertRecord(value, type);
    return normalizeTypedDataMessage(record, type, types);
  }

  return value;
}

function normalizeTypedDataMessage(
  message: JsonRecord,
  primaryType: string,
  types: Record<string, TypedDataField[]>,
): JsonRecord {
  const fields = types[primaryType];
  if (!fields) {
    throw new Error(
      `x402 typedData.types is missing primary type ${primaryType}.`,
    );
  }

  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      normalizeTypedDataValue(message[field.name], field.type, types),
    ]),
  );
}

function assertReceiveWithAuthorizationTypes(
  types: Record<string, TypedDataField[]>,
) {
  const typeNames = Object.keys(types);
  if (typeNames.length !== 1 || typeNames[0] !== X402_PRIMARY_TYPE) {
    throw new Error(
      `x402 typedData.types must contain only ${X402_PRIMARY_TYPE}.`,
    );
  }
  const fields = types[X402_PRIMARY_TYPE];
  if (!fields || fields.length !== X402_AUTHORIZATION_FIELDS.length) {
    throw new Error(
      `x402 typedData.types.${X402_PRIMARY_TYPE} must contain the standard EIP-3009 fields.`,
    );
  }
  for (const [index, expected] of X402_AUTHORIZATION_FIELDS.entries()) {
    const actual = fields[index];
    if (actual?.name !== expected.name || actual.type !== expected.type) {
      throw new Error(
        `x402 typedData.types.${X402_PRIMARY_TYPE}[${index}] must be ${expected.name} ${expected.type}.`,
      );
    }
  }
}

function normalizeX402Domain(domainRecord: JsonRecord) {
  assertExactKeys(
    domainRecord,
    ["chainId", "name", "verifyingContract", "version"],
    "x402 typedData.domain",
  );
  const chainId = normalizeRequiredChainId(
    domainRecord.chainId,
    "x402 typedData.domain.chainId",
  );
  if (domainRecord.name !== "USDC") {
    throw new Error("x402 typedData.domain.name must be USDC.");
  }
  if (domainRecord.version !== "2") {
    throw new Error("x402 typedData.domain.version must be 2.");
  }
  return {
    chainId,
    name: "USDC",
    verifyingContract: normalizeAddress(
      domainRecord.verifyingContract,
      "x402 typedData.domain.verifyingContract",
    ),
    version: "2",
  };
}

function parseX402AuthorizationRequest(value: unknown): {
  authorization: X402Authorization;
  typedData: X402TypedData;
  typedDataDomain: ReturnType<typeof normalizeX402Domain>;
} {
  const request = assertRecord(value, "x402AuthorizationRequest");
  const typedDataRecord = assertRecord(
    request.typedData ?? request.eip712,
    "x402AuthorizationRequest.typedData",
  );
  const primaryType = typedDataRecord.primaryType;
  if (primaryType !== X402_PRIMARY_TYPE) {
    throw new Error(`x402 typedData.primaryType must be ${X402_PRIMARY_TYPE}.`);
  }

  const types = stripEip712Domain(readTypedDataFields(typedDataRecord.types));
  assertReceiveWithAuthorizationTypes(types);
  const rawMessage = assertRecord(
    typedDataRecord.message,
    "x402 typedData.message",
  );
  assertExactKeys(
    rawMessage,
    X402_AUTHORIZATION_FIELDS.map((field) => field.name),
    "x402 typedData.message",
  );
  const normalizedMessage = normalizeTypedDataMessage(
    rawMessage,
    primaryType,
    types,
  );
  const authorizationSource = assertRecord(
    request.authorization ?? rawMessage,
    "x402AuthorizationRequest.authorization",
  );
  assertExactKeys(
    authorizationSource,
    X402_AUTHORIZATION_FIELDS.map((field) => field.name),
    "x402AuthorizationRequest.authorization",
  );
  const typedDataDomain = normalizeX402Domain(
    assertRecord(typedDataRecord.domain, "x402 typedData.domain"),
  );

  const authorization: X402Authorization = {
    from: normalizeAddress(
      authorizationSource.from ?? rawMessage.from,
      "paymentAuthorization.from",
    ),
    nonce: normalizeBytes32(
      authorizationSource.nonce ?? rawMessage.nonce,
      "paymentAuthorization.nonce",
    ),
    to: normalizeAddress(
      authorizationSource.to ?? rawMessage.to,
      "paymentAuthorization.to",
    ),
    validAfter: normalizeBigInt(
      authorizationSource.validAfter ?? rawMessage.validAfter,
      "paymentAuthorization.validAfter",
    ).toString(),
    validBefore: normalizeBigInt(
      authorizationSource.validBefore ?? rawMessage.validBefore,
      "paymentAuthorization.validBefore",
    ).toString(),
    value: normalizeBigInt(
      authorizationSource.value ?? rawMessage.value,
      "paymentAuthorization.value",
    ).toString(),
  };
  assertX402AuthorizationMatchesMessage(authorization, normalizedMessage);

  return {
    authorization,
    typedDataDomain,
    typedData: {
      domain: typedDataDomain,
      message: normalizedMessage,
      primaryType,
      types,
    },
  };
}

function assertX402AuthorizationMatchesMessage(
  authorization: X402Authorization,
  message: JsonRecord,
) {
  const messageFrom = normalizeAddress(
    message.from,
    "x402 typedData.message.from",
  );
  const messageTo = normalizeAddress(message.to, "x402 typedData.message.to");
  if (!authorization.from || !sameAddress(authorization.from, messageFrom)) {
    throw new Error(
      "x402 authorization.from must match typedData.message.from.",
    );
  }
  if (!authorization.to || !sameAddress(authorization.to, messageTo)) {
    throw new Error("x402 authorization.to must match typedData.message.to.");
  }
  const integerFields = ["value", "validAfter", "validBefore"] as const;
  for (const field of integerFields) {
    if (
      normalizeBigInt(authorization[field], `paymentAuthorization.${field}`) !==
      normalizeBigInt(message[field], `x402 typedData.message.${field}`)
    ) {
      throw new Error(
        `x402 authorization.${field} must match typedData.message.${field}.`,
      );
    }
  }
  if (
    !authorization.nonce ||
    authorization.nonce.toLowerCase() !==
      normalizeBytes32(
        message.nonce,
        "x402 typedData.message.nonce",
      ).toLowerCase()
  ) {
    throw new Error(
      "x402 authorization.nonce must match typedData.message.nonce.",
    );
  }
}

function resolveConfiguredUsdcAddress(
  config: Pick<LocalSignerConfig, "usdcAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.usdcAddress ??
    getSharedDeploymentAddress(chainId, "MockERC20") ??
    X402_USDC_BY_CHAIN_ID[chainId]
  );
}

function resolveConfiguredX402SubmitterAddress(
  config: Pick<LocalSignerConfig, "x402QuestionSubmitterAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.x402QuestionSubmitterAddress ??
    getSharedDeploymentAddress(chainId, "X402QuestionSubmitter")
  );
}

function resolveConfiguredContentRegistryAddress(
  config: Pick<LocalSignerConfig, "contentRegistryAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.contentRegistryAddress ??
    getSharedDeploymentAddress(chainId, "ContentRegistry")
  );
}

function resolveConfiguredQuestionRewardPoolEscrowAddress(
  config: Pick<LocalSignerConfig, "questionRewardPoolEscrowAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.questionRewardPoolEscrowAddress ??
    getSharedDeploymentAddress(chainId, "QuestionRewardPoolEscrow")
  );
}

function requireConfiguredAddress(
  value: Address | undefined,
  name: string,
): Address {
  if (!value) {
    throw new Error(
      `Cannot validate transaction plan without a trusted ${name} address for this chain.`,
    );
  }
  return value;
}

function normalizeExpectedAmount(
  value: SignX402AuthorizationOptions["expectedAmount"],
): bigint | undefined {
  return value === undefined
    ? undefined
    : normalizeBigInt(value, "expected x402 payment amount");
}

function assertTrustedX402Authorization(
  account: PrivateKeyAccount,
  authorization: X402Authorization,
  typedDataDomain: ReturnType<typeof normalizeX402Domain>,
  options: SignX402AuthorizationOptions,
) {
  if (authorization.from && !sameAddress(authorization.from, account.address)) {
    throw new Error(
      `x402 authorization is for ${authorization.from}, but local signer is ${account.address}.`,
    );
  }
  if (
    options.expectedChainId !== undefined &&
    typedDataDomain.chainId !== options.expectedChainId
  ) {
    throw new Error(
      `x402 authorization chainId ${typedDataDomain.chainId} does not match local signer chain ${options.expectedChainId}.`,
    );
  }
  if (!options.expectedUsdcAddress) {
    throw new Error(
      "Cannot validate x402 authorization without a trusted USDC address for this chain.",
    );
  }
  if (
    !sameAddress(typedDataDomain.verifyingContract, options.expectedUsdcAddress)
  ) {
    throw new Error(
      "x402 typedData.domain.verifyingContract must be the configured USDC token.",
    );
  }
  if (!options.expectedX402QuestionSubmitterAddress) {
    throw new Error(
      "Cannot validate x402 authorization without a trusted RateLoop x402 submitter address for this chain.",
    );
  }
  if (
    !authorization.to ||
    !sameAddress(authorization.to, options.expectedX402QuestionSubmitterAddress)
  ) {
    throw new Error(
      "x402 authorization.to must be the configured RateLoop x402 submitter.",
    );
  }
  const expectedAmount = normalizeExpectedAmount(options.expectedAmount);
  if (
    expectedAmount !== undefined &&
    normalizeBigInt(authorization.value, "paymentAuthorization.value") !==
      expectedAmount
  ) {
    throw new Error(
      "x402 authorization.value must equal the requested bounty amount.",
    );
  }
  const validBefore = normalizeBigInt(
    authorization.validBefore,
    "paymentAuthorization.validBefore",
  );
  if (
    validBefore <=
    normalizeBigInt(authorization.validAfter, "paymentAuthorization.validAfter")
  ) {
    throw new Error(
      "x402 authorization.validBefore must be greater than validAfter.",
    );
  }
  const maxValidBefore =
    BigInt(Math.floor(Date.now() / 1000)) +
    MAX_X402_AUTHORIZATION_VALIDITY_SECONDS;
  if (validBefore > maxValidBefore) {
    throw new Error(
      `x402 authorization.validBefore must be within ${MAX_X402_AUTHORIZATION_VALIDITY_SECONDS} seconds (24 hours) of now.`,
    );
  }
  if (
    options.expectedNonce &&
    authorization.nonce?.toLowerCase() !== options.expectedNonce.toLowerCase()
  ) {
    throw new Error(
      "x402 authorization.nonce does not match the RateLoop ask payload.",
    );
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalBytes32(value: unknown, fieldName: string): Hex {
  if (value === undefined || value === null || value === "")
    return EMPTY_DETAILS_HASH;
  return normalizeBytes32(value, fieldName);
}

function parseNonNegativeInteger(value: unknown, fieldName: string): bigint {
  const rawValue =
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "string"
      ? String(value).trim()
      : "";
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${fieldName} must be a non-negative integer.`);
  }
  return BigInt(rawValue);
}

function isSupportedBountyEligibility(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) return false;
  if (
    (value &
      ~(
        BOUNTY_ELIGIBILITY_CREDENTIAL_MASK |
        BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG
      )) !==
    0
  ) {
    return false;
  }

  const credentialMask = value & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
  return credentialMask === 0 ? value === 0 : true;
}

function parsePositiveAtomicAmount(value: unknown, fieldName: string): bigint {
  const parsed = parseNonNegativeInteger(value, fieldName);
  if (parsed <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return parsed;
}

function sanitizeHttpsUrl(value: string, fieldName: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error(`${fieldName} must be a public HTTPS URL.`);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes(fieldName))
      throw error;
    throw new Error(`${fieldName} must be a valid HTTPS URL.`);
  }
}

function matchesHostname(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return (
    normalizedHost === normalizedDomain ||
    normalizedHost.endsWith(`.${normalizedDomain}`)
  );
}

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    let id: string | null | undefined;
    if (
      matchesHostname(parsed.hostname, "youtube.com") &&
      parsed.pathname === "/watch"
    ) {
      id = parsed.searchParams.get("v");
    } else if (parsed.hostname.toLowerCase() === "youtu.be") {
      id = parsed.pathname.slice(1).split("/")[0];
    } else if (
      matchesHostname(parsed.hostname, "youtube.com") &&
      parsed.pathname.startsWith("/embed/")
    ) {
      id = parsed.pathname.split("/embed/")[1]?.split("/")[0];
    }
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function canonicalizeLocalUrl(url: string): string {
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `https://${hostname}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function normalizeQuestionContextUrl(value: string, fieldName: string): string {
  const sanitized = sanitizeHttpsUrl(value, fieldName);
  const parsed = new URL(sanitized);
  if (DIRECT_IMAGE_URL_PATH_PATTERN.test(parsed.pathname)) {
    throw new Error(
      `${fieldName} must be a public HTTPS page URL. Upload images through imageUrls.`,
    );
  }
  return canonicalizeLocalUrl(sanitized);
}

function isLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeImageAttachmentUrl(value: string, fieldName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a valid image upload URL.`);
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    !IMAGE_ATTACHMENT_PATH_PATTERN.test(parsed.pathname) ||
    !IMAGE_ATTACHMENT_HASH_PATTERN.test(parsed.hash)
  ) {
    throw new Error(
      "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
    );
  }
  const configuredOrigins = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]
    .map((origin) => {
      try {
        return origin ? new URL(origin).origin : null;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => Boolean(origin));
  const allowedOrigins = new Set([
    ...DEFAULT_IMAGE_ATTACHMENT_ORIGINS,
    ...configuredOrigins,
  ]);
  const localhostAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD === "true";
  const isAllowedProtocol =
    parsed.protocol === "https:" ||
    (localhostAllowed && parsed.protocol === "http:");
  if (!isAllowedProtocol) {
    throw new Error(
      "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
    );
  }
  if (
    !allowedOrigins.has(parsed.origin) &&
    !(localhostAllowed && isLocalhostOrigin(parsed.origin))
  ) {
    throw new Error(
      "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
    );
  }
  parsed.hash = parsed.hash.toLowerCase();
  return parsed.toString();
}

function allowedRateLoopAttachmentOrigins() {
  const configuredOrigins = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ]
    .map((origin) => {
      try {
        return origin ? new URL(origin).origin : null;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => Boolean(origin));
  return new Set([...DEFAULT_IMAGE_ATTACHMENT_ORIGINS, ...configuredOrigins]);
}

function isHostedQuestionDetailsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      QUESTION_DETAILS_ATTACHMENT_PATH_PATTERN.test(parsed.pathname) &&
      allowedRateLoopAttachmentOrigins().has(parsed.origin)
    );
  } catch {
    return false;
  }
}

function normalizeImageUrls(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      "imageUrls must be an array of RateLoop imageUrl values returned by rateloop_upload_image.",
    );
  }
  if (value.length > 4) {
    throw new Error("imageUrls supports at most four images.");
  }
  return value.map((entry, index) =>
    normalizeImageAttachmentUrl(
      readRequiredString(entry, `imageUrls[${index}]`),
      `imageUrls[${index}]`,
    ),
  );
}

function isYouTubeVideoUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

function normalizeTags(value: unknown): { tagList: string[]; tags: string } {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tagList = rawTags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);

  if (tagList.length === 0) {
    throw new Error("At least one tag is required.");
  }
  if (tagList.length > 3) {
    throw new Error("At most three tags are supported.");
  }
  return {
    tagList,
    tags: tagList.join(","),
  };
}

function cloneJsonObject<T>(
  value: unknown,
  fieldName: string,
  defaultValue: T,
): T {
  if (value === undefined || value === null) return defaultValue;
  if (!isJsonRecord(value)) {
    throw new Error(`${fieldName} must be an object when provided.`);
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new Error(`${fieldName} must be JSON serializable.`);
  }
}

function normalizeTemplateSelection(
  value: JsonRecord,
  fieldPrefix: string,
  defaults: {
    confidentiality?: LocalQuestionConfidentiality;
    templateId?: string;
    templateInputs?: AgentQuestionSpecInput["templateInputs"];
    templateVersion?: number;
  },
) {
  const rawTemplateId =
    readOptionalString(value.templateId) ||
    defaults.templateId ||
    DEFAULT_AGENT_TEMPLATE_ID;
  const template = findAgentResultTemplate(rawTemplateId);
  if (!template) {
    throw new Error(`${fieldPrefix}.templateId is not supported.`);
  }

  const templateVersion =
    value.templateVersion === undefined || value.templateVersion === null
      ? (defaults.templateVersion ?? template.version)
      : Number.parseInt(String(value.templateVersion), 10);
  if (!Number.isSafeInteger(templateVersion) || templateVersion <= 0) {
    throw new Error(
      `${fieldPrefix}.templateVersion must be a positive integer.`,
    );
  }
  if (templateVersion !== template.version) {
    throw new Error(
      `${fieldPrefix}.templateVersion ${templateVersion} is not supported for ${template.id}.`,
    );
  }

  return {
    template,
    templateId: template.id,
    templateInputs:
      value.templateInputs === undefined
        ? (defaults.templateInputs ?? null)
        : cloneJsonObject<AgentQuestionSpecInput["templateInputs"]>(
            value.templateInputs,
            `${fieldPrefix}.templateInputs`,
            null,
          ),
    templateVersion,
  };
}

function normalizeLocalChainId(
  value: unknown,
  fallbackChainId?: number,
): number {
  const rawValue = value ?? fallbackChainId;
  const chainId =
    typeof rawValue === "number"
      ? rawValue
      : Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("chainId must be a positive integer.");
  }
  return chainId;
}

function normalizeLocalQuestionConfidentiality(
  value: unknown,
  fieldName: string,
): LocalQuestionConfidentiality {
  if (value === undefined || value === null) {
    return {
      bond: null,
      disclosurePolicy: null,
      visibility: "public",
    };
  }
  if (!isJsonRecord(value)) {
    throw new Error(`${fieldName} must be an object when provided.`);
  }

  const visibility = readOptionalString(value.visibility) || "public";
  if (visibility !== "public" && visibility !== "gated") {
    throw new Error(`${fieldName}.visibility must be public or gated.`);
  }
  if (visibility === "public") {
    if (value.bond !== undefined && value.bond !== null) {
      throw new Error(
        `${fieldName}.bond is only supported for gated questions.`,
      );
    }
    return {
      bond: null,
      disclosurePolicy: null,
      visibility,
    };
  }

  const rawDisclosurePolicy =
    readOptionalString(value.disclosurePolicy) ||
    DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY;
  const disclosurePolicy =
    rawDisclosurePolicy === "private_until_settlement"
      ? DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY
      : rawDisclosurePolicy;
  if (
    disclosurePolicy !== DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY &&
    disclosurePolicy !== "private_forever"
  ) {
    throw new Error(
      `${fieldName}.disclosurePolicy must be after_settlement or private_forever.`,
    );
  }

  let bond: NonNullable<LocalQuestionConfidentiality["bond"]> | null = null;
  if (value.bond !== undefined && value.bond !== null) {
    if (!isJsonRecord(value.bond)) {
      throw new Error(`${fieldName}.bond must be an object when provided.`);
    }
    const amount = parseNonNegativeInteger(
      value.bond.amount ?? 0n,
      `${fieldName}.bond.amount`,
    );
    const asset = readOptionalString(value.bond.asset).toUpperCase() || "LREP";
    if (asset !== "LREP" && asset !== "USDC") {
      throw new Error(`${fieldName}.bond.asset must be LREP or USDC.`);
    }
    bond = {
      amount: amount.toString(),
      asset,
    };
  }

  return {
    bond: bond ?? {
      amount: "0",
      asset: "LREP",
    },
    disclosurePolicy,
    visibility,
  };
}

function normalizeLocalBounty(value: unknown): LocalQuestionPayload["bounty"] {
  if (!isJsonRecord(value)) {
    throw new Error("bounty is required.");
  }

  const asset = readOptionalString(value.asset).toUpperCase() || "USDC";
  if (asset !== "USDC") {
    throw new Error(
      "Only USDC bounties are supported for local signer question submissions.",
    );
  }

  const amount = parsePositiveAtomicAmount(value.amount, "bounty.amount");
  const requiredVoters = parseNonNegativeInteger(
    value.requiredVoters ?? X402_MIN_REWARD_POOL_REQUIRED_VOTERS,
    "bounty.requiredVoters",
  );
  const requiredSettledRounds = parseNonNegativeInteger(
    value.requiredSettledRounds ?? X402_MIN_REWARD_POOL_SETTLED_ROUNDS,
    "bounty.requiredSettledRounds",
  );
  const bountyStartBy = parseNonNegativeInteger(
    value.bountyStartBy ?? 0n,
    "bounty.bountyStartBy",
  );
  const bountyWindowSeconds = parseNonNegativeInteger(
    value.bountyWindowSeconds ?? 0n,
    "bounty.bountyWindowSeconds",
  );
  const feedbackWindowSeconds = parseNonNegativeInteger(
    value.feedbackWindowSeconds ?? value.bountyWindowSeconds ?? 0n,
    "bounty.feedbackWindowSeconds",
  );
  const bountyEligibility = Number(
    parseNonNegativeInteger(
      value.bountyEligibility ?? 0n,
      "bounty.bountyEligibility",
    ),
  );

  if (requiredVoters < X402_MIN_REWARD_POOL_REQUIRED_VOTERS) {
    throw new Error(
      `bounty.requiredVoters must be at least ${X402_MIN_REWARD_POOL_REQUIRED_VOTERS}.`,
    );
  }
  if (requiredSettledRounds < X402_MIN_REWARD_POOL_SETTLED_ROUNDS) {
    throw new Error(
      `bounty.requiredSettledRounds must be at least ${X402_MIN_REWARD_POOL_SETTLED_ROUNDS}.`,
    );
  }
  if (amount < X402_DEFAULT_SUBMISSION_BOUNTY_USDC) {
    throw new Error("bounty.amount must be at least 1000000 atomic USDC.");
  }
  if (amount < requiredVoters * requiredSettledRounds) {
    throw new Error(
      "bounty.amount is too small for the selected voter requirements.",
    );
  }
  if (bountyStartBy <= 0n) {
    throw new Error(
      "bounty.bountyStartBy must be greater than zero for local signer submissions.",
    );
  }
  if (bountyWindowSeconds <= 0n) {
    throw new Error(
      "bounty.bountyWindowSeconds must be greater than zero for local signer submissions.",
    );
  }
  if (feedbackWindowSeconds > bountyWindowSeconds) {
    throw new Error(
      "bounty.feedbackWindowSeconds cannot exceed bounty.bountyWindowSeconds.",
    );
  }
  if (!isSupportedBountyEligibility(bountyEligibility)) {
    throw new Error(
      "bounty.bountyEligibility must be 0 or a supported credential bitmask: 2 Selfie Check, 4 Passport, 8 Proof of Human, add values to allow any selected credential, and add 128 to require a recent recheck.",
    );
  }

  return {
    amount,
    asset: "USDC",
    bountyEligibility,
    bountyStartBy,
    bountyWindowSeconds,
    feedbackWindowSeconds,
    requiredSettledRounds,
    requiredVoters,
  };
}

function normalizeLocalRoundConfig(
  value: unknown,
  requiredVoters: bigint,
): LocalQuestionRoundConfig {
  if (value === undefined || value === null) {
    const defaultMaxVoters = BigInt(DEFAULT_ROUND_CONFIG.maxVoters);
    return {
      epochDuration: BigInt(DEFAULT_ROUND_CONFIG.epochDurationSeconds),
      maxDuration: BigInt(DEFAULT_ROUND_CONFIG.maxDurationSeconds),
      minVoters: requiredVoters,
      maxVoters:
        defaultMaxVoters < requiredVoters ? requiredVoters : defaultMaxVoters,
    };
  }
  if (!isJsonRecord(value)) {
    throw new Error("question.roundConfig must be an object.");
  }

  const epochDuration = parseNonNegativeInteger(
    value.epochDuration ?? value.blindPhaseSeconds ?? value.blindSeconds,
    "question.roundConfig.epochDuration",
  );
  const maxDuration = parseNonNegativeInteger(
    value.maxDuration ?? value.maxDurationSeconds ?? value.deadlineSeconds,
    "question.roundConfig.maxDuration",
  );
  const minVoters = parseNonNegativeInteger(
    value.minVoters,
    "question.roundConfig.minVoters",
  );
  const maxVoters = parseNonNegativeInteger(
    value.maxVoters,
    "question.roundConfig.maxVoters",
  );

  if (epochDuration <= 0n) {
    throw new Error(
      "question.roundConfig.epochDuration must be greater than zero.",
    );
  }
  if (maxDuration <= 0n) {
    throw new Error(
      "question.roundConfig.maxDuration must be greater than zero.",
    );
  }
  if (minVoters <= 0n || maxVoters <= 0n || maxVoters < minVoters) {
    throw new Error("question.roundConfig voter values are invalid.");
  }
  if (minVoters !== requiredVoters) {
    throw new Error(
      "question.roundConfig.minVoters must match bounty.requiredVoters.",
    );
  }

  return { epochDuration, maxDuration, minVoters, maxVoters };
}

function normalizeLocalQuestion(
  value: unknown,
  index: number,
  defaults: {
    confidentiality?: LocalQuestionConfidentiality;
    templateId?: string;
    templateInputs?: AgentQuestionSpecInput["templateInputs"];
    templateVersion?: number;
  },
  bounty: LocalQuestionPayload["bounty"],
  questionMetadataBaseUrl: string | undefined,
  roundConfig: LocalQuestionRoundConfig,
): LocalQuestionItemPayload {
  if (!isJsonRecord(value)) {
    throw new Error(`questions[${index}] must be an object.`);
  }

  const fieldPrefix = `questions[${index}]`;
  const title = readRequiredString(value.title, `${fieldPrefix}.title`);
  const imageUrls = normalizeImageUrls(value.imageUrls);
  const rawContextUrl = readOptionalString(value.contextUrl);
  const contextUrl = rawContextUrl
    ? normalizeQuestionContextUrl(rawContextUrl, `${fieldPrefix}.contextUrl`)
    : "";
  const rawVideoUrl = readOptionalString(value.videoUrl);
  const videoUrl = rawVideoUrl
    ? sanitizeHttpsUrl(rawVideoUrl, `${fieldPrefix}.videoUrl`)
    : "";
  const rawDetailsUrl = readOptionalString(value.detailsUrl);
  const detailsHash = readOptionalBytes32(
    value.detailsHash,
    `${fieldPrefix}.detailsHash`,
  );
  const detailsUrl = rawDetailsUrl
    ? sanitizeHttpsUrl(rawDetailsUrl, `${fieldPrefix}.detailsUrl`)
    : "";
  const confidentiality = normalizeLocalQuestionConfidentiality(
    value.confidentiality ?? defaults.confidentiality,
    `${fieldPrefix}.confidentiality`,
  );
  if (detailsUrl && detailsHash.toLowerCase() === EMPTY_DETAILS_HASH) {
    throw new Error(
      `${fieldPrefix}.detailsHash is required when detailsUrl is provided.`,
    );
  }
  if (!detailsUrl && detailsHash.toLowerCase() !== EMPTY_DETAILS_HASH) {
    throw new Error(
      `${fieldPrefix}.detailsUrl is required when detailsHash is provided.`,
    );
  }
  if (videoUrl && !isYouTubeVideoUrl(videoUrl)) {
    throw new Error(`${fieldPrefix}.videoUrl must be a supported YouTube URL.`);
  }
  if (videoUrl && imageUrls.length > 0) {
    throw new Error("Use imageUrls or videoUrl, not both.");
  }
  if (confidentiality.visibility === "gated") {
    if (contextUrl || videoUrl) {
      throw new Error(
        `${fieldPrefix}.confidentiality.visibility gated requires RateLoop-hosted imageUrls and/or detailsUrl; external contextUrl and videoUrl are not allowed.`,
      );
    }
    if (detailsUrl && !isHostedQuestionDetailsUrl(detailsUrl)) {
      throw new Error(
        `${fieldPrefix}.detailsUrl must be a RateLoop-hosted details attachment for gated questions.`,
      );
    }
  }
  if (
    !contextUrl &&
    imageUrls.length === 0 &&
    !videoUrl &&
    !(confidentiality.visibility === "gated" && detailsUrl)
  ) {
    throw new Error(
      `${fieldPrefix}.contextUrl, imageUrls, or videoUrl is required.`,
    );
  }

  const { tags, tagList } = normalizeTags(value.tags);
  const categoryId = parseNonNegativeInteger(
    value.categoryId,
    `${fieldPrefix}.categoryId`,
  );
  const targetAudience = normalizeTargetAudience(value.targetAudience, {
    fieldPrefix: `${fieldPrefix}.targetAudience`,
  }) as AgentQuestionSpecInput["targetAudience"];
  const templateSelection = normalizeTemplateSelection(
    value,
    fieldPrefix,
    defaults,
  );
  const spec = buildQuestionSpecHashes(
    {
      bounty: {
        amount: bounty.amount,
        asset: bounty.asset,
        bountyEligibility: bounty.bountyEligibility,
        requiredSettledRounds: bounty.requiredSettledRounds,
        requiredVoters: bounty.requiredVoters,
      },
      categoryId,
      confidentiality,
      contextUrl,
      imageUrls,
      roundConfig,
      study: {
        bundleIndex: index,
      },
      tags: tagList,
      targetAudience,
      templateId: templateSelection.templateId,
      templateInputs: templateSelection.templateInputs,
      templateVersion: templateSelection.templateVersion,
      title,
      videoUrl,
      voteSemantics: templateSelection.template.voteSemantics,
    },
    { questionMetadataBaseUrl },
  );

  return {
    categoryId,
    confidentiality,
    contextUrl,
    detailsHash,
    detailsUrl,
    imageUrls,
    questionMetadataHash: spec.questionMetadataHash,
    questionMetadataUri: spec.questionMetadataUri,
    resultSpecHash: spec.resultSpecHash,
    tags,
    tagList,
    targetAudience,
    templateId: templateSelection.templateId,
    templateInputs: templateSelection.templateInputs,
    templateVersion: templateSelection.templateVersion,
    title,
    videoUrl,
  };
}

function parseLocalQuestionRequest(
  value: unknown,
  fallbackChainId?: number,
  options: { questionMetadataBaseUrl?: string } = {},
): LocalQuestionPayload {
  const request = assertRecord(value, "ask payload");
  for (const key of Object.keys(request)) {
    if (!X402_QUESTION_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`Unknown top-level ask payload field: ${key}`);
    }
  }

  const clientRequestId = readRequiredString(
    request.clientRequestId,
    "clientRequestId",
  );
  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new Error(
      "clientRequestId must be 4-160 characters using letters, numbers, dot, dash, colon, or underscore.",
    );
  }

  const rawQuestions = Array.isArray(request.questions)
    ? request.questions
    : [isJsonRecord(request.question) ? request.question : request];
  if (rawQuestions.length === 0) {
    throw new Error("At least one question is required.");
  }
  if (rawQuestions.length > X402_MAX_QUESTION_BUNDLE_COUNT) {
    throw new Error(
      `At most ${X402_MAX_QUESTION_BUNDLE_COUNT} questions are supported.`,
    );
  }

  const firstQuestion = isJsonRecord(rawQuestions[0]) ? rawQuestions[0] : {};
  const bounty = normalizeLocalBounty(request.bounty);
  const roundConfig = normalizeLocalRoundConfig(
    request.roundConfig ?? firstQuestion.roundConfig,
    bounty.requiredVoters,
  );
  const topLevelTemplateInputs = cloneJsonObject<
    AgentQuestionSpecInput["templateInputs"]
  >(request.templateInputs, "templateInputs", null);
  const topLevelTemplateVersion =
    request.templateVersion === undefined || request.templateVersion === null
      ? DEFAULT_AGENT_TEMPLATE_VERSION
      : Number.parseInt(String(request.templateVersion), 10);
  const templateDefaults = {
    confidentiality: normalizeLocalQuestionConfidentiality(
      request.confidentiality,
      "confidentiality",
    ),
    templateId:
      readOptionalString(request.templateId) || DEFAULT_AGENT_TEMPLATE_ID,
    templateInputs: topLevelTemplateInputs,
    templateVersion: topLevelTemplateVersion,
  };
  const questions = rawQuestions.map((question, index) =>
    normalizeLocalQuestion(
      question,
      index,
      templateDefaults,
      bounty,
      options.questionMetadataBaseUrl,
      roundConfig,
    ),
  );
  if (
    questions.length > 1 &&
    questions.some(
      (question) => question.confidentiality.visibility === "gated",
    )
  ) {
    throw new Error(
      "Private context bundles are not supported yet. Submit gated questions one at a time.",
    );
  }

  return {
    bounty,
    chainId: normalizeLocalChainId(
      request.chainId ?? firstQuestion.chainId,
      fallbackChainId,
    ),
    clientRequestId,
    questions,
    roundConfig,
  };
}

function serializeLocalRoundConfig(config: LocalQuestionRoundConfig) {
  return {
    epochDuration: config.epochDuration.toString(),
    maxDuration: config.maxDuration.toString(),
    minVoters: config.minVoters.toString(),
    maxVoters: config.maxVoters.toString(),
  };
}

function toCanonicalLocalQuestionPayload(payload: LocalQuestionPayload) {
  return {
    bounty: {
      amount: payload.bounty.amount.toString(),
      asset: payload.bounty.asset,
      requiredSettledRounds: payload.bounty.requiredSettledRounds.toString(),
      requiredVoters: payload.bounty.requiredVoters.toString(),
      bountyStartBy: payload.bounty.bountyStartBy.toString(),
      bountyWindowSeconds: payload.bounty.bountyWindowSeconds.toString(),
      feedbackWindowSeconds: payload.bounty.feedbackWindowSeconds.toString(),
      bountyEligibility: String(payload.bounty.bountyEligibility),
    },
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    questions: payload.questions.map((question) => ({
      categoryId: question.categoryId.toString(),
      confidentiality: question.confidentiality,
      contextUrl: question.contextUrl,
      detailsHash: question.detailsHash,
      detailsUrl: question.detailsUrl,
      imageUrls: question.imageUrls,
      questionMetadataHash: question.questionMetadataHash,
      questionMetadataUri: question.questionMetadataUri,
      resultSpecHash: question.resultSpecHash,
      tags: question.tagList,
      targetAudience: question.targetAudience,
      templateId: question.templateId,
      templateInputs: question.templateInputs,
      templateVersion: question.templateVersion,
      title: question.title,
      videoUrl: question.videoUrl,
    })),
    roundConfig: serializeLocalRoundConfig(payload.roundConfig),
  };
}

/**
 * Parses a local ask payload and returns the canonical JSON payload the
 * RateLoop server hashes for operationKey/payloadHash derivation. Exposed so
 * agents and tests can verify the local signer normalization (including the
 * bounty.requiredVoters / roundConfig.minVoters alignment) matches the server
 * byte for byte.
 */
export function buildLocalQuestionCanonicalPayload(
  payload: unknown,
  fallbackChainId?: number,
  options: { questionMetadataBaseUrl?: string } = {},
) {
  return toCanonicalLocalQuestionPayload(
    parseLocalQuestionRequest(payload, fallbackChainId, options),
  );
}

function buildLocalQuestionOperation(payload: LocalQuestionPayload) {
  const canonicalPayload = toCanonicalLocalQuestionPayload(payload);
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
  const operationKey =
    `0x${createHash("sha256").update(`rateloop:x402-question:${payloadHash}`).digest("hex")}` as Hex;
  return {
    canonicalPayload,
    operationKey,
    payloadHash,
  };
}

function buildQuestionSubmissionKey(question: LocalQuestionItemPayload): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        question.categoryId,
        buildSubmissionMediaHash(question.imageUrls, question.videoUrl),
        buildSubmissionDetailsHash(question.detailsUrl, question.detailsHash),
        question.contextUrl,
        question.title,
        question.tags,
      ],
    ),
  );
}

function buildDeterministicQuestionSalt(params: {
  index: number;
  operationKey: Hex;
  payloadHash: string;
  submissionKey: Hex;
  walletAddress: Address;
}): Hex {
  return `0x${createHash("sha256")
    .update(
      [
        "rateloop",
        "agent-wallet-question-salt",
        params.operationKey,
        params.payloadHash,
        params.walletAddress.toLowerCase(),
        params.submissionKey,
        params.index.toString(),
      ].join(":"),
    )
    .digest("hex")}` as Hex;
}

function buildSubmissionMediaHash(
  imageUrls: readonly string[],
  videoUrl: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string[]" }, { type: "string" }],
      [[...imageUrls], videoUrl],
    ),
  );
}

function buildSubmissionDetailsHash(detailsUrl: string, detailsHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [detailsUrl, detailsHash],
    ),
  );
}

function buildRewardTermsHash(rewardTerms: LocalRewardTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        rewardTerms.asset,
        rewardTerms.amount,
        rewardTerms.requiredVoters,
        rewardTerms.requiredSettledRounds,
        rewardTerms.bountyStartBy,
        rewardTerms.bountyWindowSeconds,
        rewardTerms.feedbackWindowSeconds,
        rewardTerms.bountyEligibility,
      ],
    ),
  );
}

function buildRoundConfigHash(roundConfig: LocalQuestionRoundConfig): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        Number(roundConfig.epochDuration),
        Number(roundConfig.maxDuration),
        Number(roundConfig.minVoters),
        Number(roundConfig.maxVoters),
      ],
    ),
  );
}

function buildSingleQuestionRevealCommitment(params: {
  question: LocalQuestionSubmission;
  rewardTerms: LocalRewardTerms;
  roundConfig: LocalQuestionRoundConfig;
  submitter: Address;
}): Hex {
  const textHash = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }],
      [params.question.title, params.question.tags],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        QUESTION_REVEAL_DOMAIN,
        params.question.submissionKey,
        buildSubmissionMediaHash(
          params.question.imageUrls,
          params.question.videoUrl,
        ),
        textHash,
        buildSubmissionDetailsHash(
          params.question.detailsUrl,
          params.question.detailsHash,
        ),
        params.question.categoryId,
        params.question.salt,
        params.submitter,
        buildRewardTermsHash(params.rewardTerms),
        buildRoundConfigHash(params.roundConfig),
        params.question.spec.questionMetadataHash,
        params.question.spec.resultSpecHash,
        buildQuestionConfidentialityHash(params.question.confidentiality),
      ],
    ),
  );
}

function buildQuestionBundleHash(
  questions: readonly LocalQuestionSubmission[],
): Hex {
  const questionHashes = questions.map((question, index) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          QUESTION_BUNDLE_ITEM_DOMAIN,
          keccak256(
            encodeAbiParameters(
              [{ type: "string" }, { type: "string" }, { type: "string" }],
              [question.contextUrl, question.title, question.tags],
            ),
          ),
          buildSubmissionMediaHash(question.imageUrls, question.videoUrl),
          buildSubmissionDetailsHash(question.detailsUrl, question.detailsHash),
          question.categoryId,
          question.salt,
          BigInt(index),
          question.spec.questionMetadataHash,
          question.spec.resultSpecHash,
        ],
      ),
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32[]" }],
      [QUESTION_BUNDLE_DOMAIN, questionHashes],
    ),
  );
}

function buildQuestionBundleRevealCommitment(params: {
  questions: readonly LocalQuestionSubmission[];
  rewardTerms: LocalRewardTerms;
  roundConfig: LocalQuestionRoundConfig;
  submitter: Address;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        QUESTION_BUNDLE_REVEAL_DOMAIN,
        buildQuestionBundleHash(params.questions),
        params.submitter,
        params.rewardTerms.asset,
        params.rewardTerms.amount,
        params.rewardTerms.requiredVoters,
        params.rewardTerms.requiredSettledRounds,
        params.rewardTerms.bountyStartBy,
        params.rewardTerms.bountyWindowSeconds,
        params.rewardTerms.feedbackWindowSeconds,
        params.rewardTerms.bountyEligibility,
        Number(params.roundConfig.epochDuration),
        Number(params.roundConfig.maxDuration),
        Number(params.roundConfig.minVoters),
        Number(params.roundConfig.maxVoters),
      ],
    ),
  );
}

function buildExpectedLocalSignerQuestionPlan(params: {
  expectedChainId?: number;
  payload: AskHumansRequest;
  questionMetadataBaseUrl?: string;
  walletAddress: Address;
}): ExpectedLocalSignerQuestionPlan {
  const payload = parseLocalQuestionRequest(
    params.payload,
    params.expectedChainId,
    { questionMetadataBaseUrl: params.questionMetadataBaseUrl },
  );
  const operation = buildLocalQuestionOperation(payload);
  const rewardTerms = {
    amount: payload.bounty.amount,
    asset: X402_SUBMISSION_REWARD_ASSET_USDC,
    bountyStartBy: payload.bounty.bountyStartBy,
    bountyWindowSeconds: payload.bounty.bountyWindowSeconds,
    bountyEligibility: payload.bounty.bountyEligibility,
    feedbackWindowSeconds: payload.bounty.feedbackWindowSeconds,
    requiredSettledRounds: payload.bounty.requiredSettledRounds,
    requiredVoters: payload.bounty.requiredVoters,
  } as const;
  const questions = payload.questions.map((question, index) => {
    const submissionKey = buildQuestionSubmissionKey(question);
    return {
      categoryId: question.categoryId,
      confidentiality: question.confidentiality,
      contextUrl: question.contextUrl,
      detailsHash: question.detailsHash,
      detailsUrl: question.detailsUrl,
      imageUrls: question.imageUrls,
      salt: buildDeterministicQuestionSalt({
        index,
        operationKey: operation.operationKey,
        payloadHash: operation.payloadHash,
        submissionKey,
        walletAddress: params.walletAddress,
      }),
      spec: {
        questionMetadataHash: question.questionMetadataHash,
        resultSpecHash: question.resultSpecHash,
      },
      submissionKey,
      tags: question.tags,
      title: question.title,
      videoUrl: question.videoUrl,
    };
  });
  const primaryQuestion = questions[0];
  if (!primaryQuestion) {
    throw new Error("Question payload is empty.");
  }
  const isBundleSubmission = questions.length > 1;
  const revealCommitment = isBundleSubmission
    ? buildQuestionBundleRevealCommitment({
        questions,
        rewardTerms,
        roundConfig: payload.roundConfig,
        submitter: params.walletAddress,
      })
    : buildSingleQuestionRevealCommitment({
        question: primaryQuestion,
        rewardTerms,
        roundConfig: payload.roundConfig,
        submitter: params.walletAddress,
      });

  return {
    canonicalPayload: operation.canonicalPayload,
    isBundleSubmission,
    operationKey: operation.operationKey,
    payloadHash: operation.payloadHash,
    primaryQuestion,
    questions,
    revealCommitment,
    rewardTerms,
    roundConfig: payload.roundConfig,
  };
}

function buildX402QuestionPaymentNonce(params: {
  chainId: number;
  contentRegistryAddress: Address;
  question: LocalQuestionSubmission;
  questionRewardPoolEscrowAddress: Address;
  rewardTerms: LocalRewardTerms;
  roundConfig: LocalQuestionRoundConfig;
  x402Authorization: Pick<
    X402Authorization,
    "from" | "to" | "validAfter" | "validBefore" | "value"
  >;
  x402QuestionSubmitterAddress: Address;
}): Hex {
  if (!params.x402Authorization.from || !params.x402Authorization.to) {
    throw new Error("x402 authorization payer and payee are required.");
  }
  const submissionPayloadHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex(params.question.contextUrl)),
        buildX402StringArrayHash(params.question.imageUrls),
        keccak256(stringToHex(params.question.videoUrl)),
        keccak256(stringToHex(params.question.detailsUrl)),
        params.question.detailsHash,
        keccak256(stringToHex(params.question.title)),
        keccak256(stringToHex(params.question.tags)),
        params.question.categoryId,
        params.question.salt,
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        X402_QUESTION_PAYMENT_DOMAIN,
        BigInt(params.chainId),
        params.contentRegistryAddress,
        params.questionRewardPoolEscrowAddress,
        params.x402QuestionSubmitterAddress,
        params.x402Authorization.from,
        params.x402Authorization.to,
        normalizeBigInt(
          params.x402Authorization.value,
          "paymentAuthorization.value",
        ),
        normalizeBigInt(
          params.x402Authorization.validAfter,
          "paymentAuthorization.validAfter",
        ),
        normalizeBigInt(
          params.x402Authorization.validBefore,
          "paymentAuthorization.validBefore",
        ),
        submissionPayloadHash,
        buildRewardTermsHash(params.rewardTerms),
        buildRoundConfigHash(params.roundConfig),
        buildQuestionConfidentialityHash(params.question.confidentiality),
        params.question.spec.questionMetadataHash,
        params.question.spec.resultSpecHash,
      ],
    ),
  );
}

function buildX402StringArrayHash(values: readonly string[]): Hex {
  const packed = values
    .map((value) => keccak256(stringToHex(value)).slice(2))
    .join("");
  return keccak256(`0x${packed}` as Hex);
}

function normalizeCallEnvelope(params: {
  call: RateLoopAgentWalletTransactionCall;
  expectedPhase: string;
  expectedTo: Address;
  index: number;
}): { data: Hex; to: Address } {
  const to = normalizeAddress(
    params.call.to,
    `transactionPlan.calls[${params.index}].to`,
  );
  if (!sameAddress(to, params.expectedTo)) {
    throw new Error(
      `transactionPlan.calls[${params.index}].to must be ${params.expectedTo}.`,
    );
  }
  if (params.call.phase !== params.expectedPhase) {
    throw new Error(
      `transactionPlan.calls[${params.index}].phase must be ${params.expectedPhase}.`,
    );
  }
  const data = normalizeOptionalTransactionData(
    params.call.data,
    `transactionPlan.calls[${params.index}].data`,
  );
  if (data === "0x") {
    throw new Error(`transactionPlan.calls[${params.index}].data is required.`);
  }
  normalizeZeroNativeValue(
    params.call.value,
    `transactionPlan.calls[${params.index}].value`,
  );
  if (params.call.waitAfterMs !== undefined) {
    if (
      typeof params.call.waitAfterMs !== "number" ||
      !Number.isFinite(params.call.waitAfterMs) ||
      params.call.waitAfterMs < 0
    ) {
      throw new Error(
        `transactionPlan.calls[${params.index}].waitAfterMs must be a non-negative number.`,
      );
    }
  }
  return { data, to };
}

function decodedCall(
  data: Hex,
  abi:
    | typeof erc20Abi
    | typeof ContentRegistryAbi
    | typeof X402QuestionSubmitterAbi,
  fieldName: string,
) {
  try {
    return decodeFunctionData({ abi, data }) as {
      args?: readonly unknown[];
      functionName: string;
    };
  } catch {
    throw new Error(`${fieldName} has an unexpected function selector.`);
  }
}

function readStructField(
  value: unknown,
  key: string,
  index: number,
  fieldName: string,
): unknown {
  if (!value || typeof value !== "object") {
    throw new Error(`${fieldName} is required.`);
  }
  if (Array.isArray(value)) {
    return value[index];
  }
  return (value as JsonRecord)[key];
}

function assertEqualBigInt(
  actual: unknown,
  expected: bigint,
  fieldName: string,
) {
  if (normalizeBigInt(actual, fieldName) !== expected) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertEqualNumber(
  actual: unknown,
  expected: number,
  fieldName: string,
) {
  if (Number(normalizeBigInt(actual, fieldName)) !== expected) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertEqualBoolean(
  actual: unknown,
  expected: boolean,
  fieldName: string,
) {
  if (actual !== expected) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertEqualString(
  actual: unknown,
  expected: string,
  fieldName: string,
) {
  if (typeof actual !== "string" || actual !== expected) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertEqualAddress(
  actual: unknown,
  expected: Address,
  fieldName: string,
) {
  if (!sameAddress(normalizeAddress(actual, fieldName), expected)) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertEqualBytes32(actual: unknown, expected: Hex, fieldName: string) {
  if (
    normalizeBytes32(actual, fieldName).toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
}

function assertStringArray(
  value: unknown,
  expected: readonly string[],
  fieldName: string,
) {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${fieldName} must match the local signer ask payload.`);
  }
  for (const [index, entry] of value.entries()) {
    assertEqualString(entry, expected[index] ?? "", `${fieldName}[${index}]`);
  }
}

function assertRewardTerms(
  value: unknown,
  expected: LocalRewardTerms,
  fieldName: string,
) {
  if (!value || typeof value !== "object") {
    throw new Error(`${fieldName} is required.`);
  }
  if (
    normalizeBigInt(
      readStructField(value, "asset", 0, fieldName),
      `${fieldName}.asset`,
    ) !== 1n
  ) {
    throw new Error(`${fieldName}.asset must be USDC.`);
  }
  assertEqualBigInt(
    readStructField(value, "amount", 1, fieldName),
    expected.amount,
    `${fieldName}.amount`,
  );
  assertEqualBigInt(
    readStructField(value, "requiredVoters", 2, fieldName),
    expected.requiredVoters,
    `${fieldName}.requiredVoters`,
  );
  assertEqualBigInt(
    readStructField(value, "requiredSettledRounds", 3, fieldName),
    expected.requiredSettledRounds,
    `${fieldName}.requiredSettledRounds`,
  );
  assertEqualBigInt(
    readStructField(value, "bountyStartBy", 4, fieldName),
    expected.bountyStartBy,
    `${fieldName}.bountyStartBy`,
  );
  assertEqualBigInt(
    readStructField(value, "bountyWindowSeconds", 5, fieldName),
    expected.bountyWindowSeconds,
    `${fieldName}.bountyWindowSeconds`,
  );
  assertEqualBigInt(
    readStructField(value, "feedbackWindowSeconds", 6, fieldName),
    expected.feedbackWindowSeconds,
    `${fieldName}.feedbackWindowSeconds`,
  );
  assertEqualNumber(
    readStructField(value, "bountyEligibility", 7, fieldName),
    expected.bountyEligibility,
    `${fieldName}.bountyEligibility`,
  );
}

function assertRoundConfig(
  value: unknown,
  expected: LocalQuestionRoundConfig,
  fieldName: string,
) {
  assertEqualBigInt(
    readStructField(value, "epochDuration", 0, fieldName),
    expected.epochDuration,
    `${fieldName}.epochDuration`,
  );
  assertEqualBigInt(
    readStructField(value, "maxDuration", 1, fieldName),
    expected.maxDuration,
    `${fieldName}.maxDuration`,
  );
  assertEqualBigInt(
    readStructField(value, "minVoters", 2, fieldName),
    expected.minVoters,
    `${fieldName}.minVoters`,
  );
  assertEqualBigInt(
    readStructField(value, "maxVoters", 3, fieldName),
    expected.maxVoters,
    `${fieldName}.maxVoters`,
  );
}

function assertQuestionSpec(
  value: unknown,
  expected: LocalQuestionSubmission["spec"],
  fieldName: string,
) {
  assertEqualBytes32(
    readStructField(value, "questionMetadataHash", 0, fieldName),
    expected.questionMetadataHash,
    `${fieldName}.questionMetadataHash`,
  );
  assertEqualBytes32(
    readStructField(value, "resultSpecHash", 1, fieldName),
    expected.resultSpecHash,
    `${fieldName}.resultSpecHash`,
  );
}

function assertQuestionConfidentiality(
  value: unknown,
  expected: LocalQuestionConfidentiality,
  fieldName: string,
) {
  const gated = expected.visibility === "gated";
  assertEqualBoolean(
    readStructField(value, "gated", 0, fieldName),
    gated,
    `${fieldName}.gated`,
  );
  assertEqualNumber(
    readStructField(value, "bondAsset", 1, fieldName),
    gated && expected.bond?.asset === "USDC" ? 1 : 0,
    `${fieldName}.bondAsset`,
  );
  assertEqualBigInt(
    readStructField(value, "bondAmount", 2, fieldName),
    gated ? BigInt(expected.bond?.amount ?? "0") : 0n,
    `${fieldName}.bondAmount`,
  );
  assertEqualNumber(
    readStructField(value, "flags", 3, fieldName),
    0,
    `${fieldName}.flags`,
  );
}

function assertSubmissionDetails(
  value: unknown,
  expected: Pick<LocalQuestionSubmission, "detailsHash" | "detailsUrl">,
  fieldName: string,
) {
  assertEqualString(
    readStructField(value, "detailsUrl", 0, fieldName),
    expected.detailsUrl,
    `${fieldName}.detailsUrl`,
  );
  assertEqualBytes32(
    readStructField(value, "detailsHash", 1, fieldName),
    expected.detailsHash,
    `${fieldName}.detailsHash`,
  );
}

function assertQuestionSubmission(
  value: unknown,
  expected: LocalQuestionSubmission,
  fieldName: string,
) {
  assertEqualString(
    readStructField(value, "contextUrl", 0, fieldName),
    expected.contextUrl,
    `${fieldName}.contextUrl`,
  );
  assertStringArray(
    readStructField(value, "imageUrls", 1, fieldName),
    expected.imageUrls,
    `${fieldName}.imageUrls`,
  );
  assertEqualString(
    readStructField(value, "videoUrl", 2, fieldName),
    expected.videoUrl,
    `${fieldName}.videoUrl`,
  );
  assertEqualString(
    readStructField(value, "title", 3, fieldName),
    expected.title,
    `${fieldName}.title`,
  );
  assertEqualString(
    readStructField(value, "tags", 4, fieldName),
    expected.tags,
    `${fieldName}.tags`,
  );
  assertEqualBigInt(
    readStructField(value, "categoryId", 5, fieldName),
    expected.categoryId,
    `${fieldName}.categoryId`,
  );
  assertSubmissionDetails(
    readStructField(value, "details", 6, fieldName),
    expected,
    `${fieldName}.details`,
  );
  assertEqualBytes32(
    readStructField(value, "salt", 7, fieldName),
    expected.salt,
    `${fieldName}.salt`,
  );
  assertQuestionSpec(
    readStructField(value, "spec", 8, fieldName),
    expected.spec,
    `${fieldName}.spec`,
  );
}

function validateApproveCall(params: {
  call: RateLoopAgentWalletTransactionCall;
  expectedAmount: bigint;
  expectedSpender: Address;
  expectedToken: Address;
  expectedPhase: string;
  index: number;
}) {
  const { data } = normalizeCallEnvelope({
    call: params.call,
    expectedPhase: params.expectedPhase,
    expectedTo: params.expectedToken,
    index: params.index,
  });
  const decoded = decodedCall(
    data,
    erc20Abi,
    `transactionPlan.calls[${params.index}]`,
  );
  if (decoded.functionName !== "approve") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call ERC20 approve.`,
    );
  }
  const [spender, amount] = decoded.args ?? [];
  if (
    typeof spender !== "string" ||
    !sameAddress(spender, params.expectedSpender)
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] approve spender must be the configured RateLoop escrow.`,
    );
  }
  if (
    normalizeBigInt(
      amount,
      `transactionPlan.calls[${params.index}].approve.amount`,
    ) !== params.expectedAmount
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] approve amount must equal the requested bounty amount.`,
    );
  }
}

function validateReserveSubmissionCall(params: {
  call: RateLoopAgentWalletTransactionCall;
  contentRegistryAddress: Address;
  expectedRevealCommitment: Hex;
  index: number;
}) {
  const { data } = normalizeCallEnvelope({
    call: params.call,
    expectedPhase: "reserve_submission",
    expectedTo: params.contentRegistryAddress,
    index: params.index,
  });
  const decoded = decodedCall(
    data,
    ContentRegistryAbi,
    `transactionPlan.calls[${params.index}]`,
  );
  if (decoded.functionName !== "reserveSubmission") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call reserveSubmission.`,
    );
  }
  assertEqualBytes32(
    decoded.args?.[0],
    params.expectedRevealCommitment,
    `transactionPlan.calls[${params.index}].reserveSubmission.revealCommitment`,
  );
}

function validateSubmitQuestionCall(params: {
  call: RateLoopAgentWalletTransactionCall;
  contentRegistryAddress: Address;
  expectedPlan: ExpectedLocalSignerQuestionPlan;
  index: number;
}) {
  const { data } = normalizeCallEnvelope({
    call: params.call,
    expectedPhase: "submit_question",
    expectedTo: params.contentRegistryAddress,
    index: params.index,
  });
  const decoded = decodedCall(
    data,
    ContentRegistryAbi,
    `transactionPlan.calls[${params.index}]`,
  );
  if (params.expectedPlan.isBundleSubmission) {
    if (
      decoded.functionName !== "submitQuestionBundleWithRewardAndRoundConfig"
    ) {
      throw new Error(
        `transactionPlan.calls[${params.index}] must call submitQuestionBundleWithRewardAndRoundConfig.`,
      );
    }
    const questions = decoded.args?.[0];
    if (
      !Array.isArray(questions) ||
      questions.length !== params.expectedPlan.questions.length
    ) {
      throw new Error(
        `transactionPlan.calls[${params.index}].questions must match the local signer ask payload.`,
      );
    }
    for (const [
      questionIndex,
      expectedQuestion,
    ] of params.expectedPlan.questions.entries()) {
      assertQuestionSubmission(
        questions[questionIndex],
        expectedQuestion,
        `transactionPlan.calls[${params.index}].questions[${questionIndex}]`,
      );
    }
    assertRewardTerms(
      decoded.args?.[1],
      params.expectedPlan.rewardTerms,
      `transactionPlan.calls[${params.index}].rewardTerms`,
    );
    assertRoundConfig(
      decoded.args?.[2],
      params.expectedPlan.roundConfig,
      `transactionPlan.calls[${params.index}].roundConfig`,
    );
    return;
  }

  if (decoded.functionName !== "submitQuestionWithRewardAndRoundConfig") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call submitQuestionWithRewardAndRoundConfig.`,
    );
  }
  const args = decoded.args ?? [];
  assertEqualString(
    args[0],
    params.expectedPlan.primaryQuestion.contextUrl,
    `transactionPlan.calls[${params.index}].contextUrl`,
  );
  assertStringArray(
    args[1],
    params.expectedPlan.primaryQuestion.imageUrls,
    `transactionPlan.calls[${params.index}].imageUrls`,
  );
  assertEqualString(
    args[2],
    params.expectedPlan.primaryQuestion.videoUrl,
    `transactionPlan.calls[${params.index}].videoUrl`,
  );
  assertEqualString(
    args[3],
    params.expectedPlan.primaryQuestion.title,
    `transactionPlan.calls[${params.index}].title`,
  );
  assertEqualString(
    args[4],
    params.expectedPlan.primaryQuestion.tags,
    `transactionPlan.calls[${params.index}].tags`,
  );
  assertEqualBigInt(
    args[5],
    params.expectedPlan.primaryQuestion.categoryId,
    `transactionPlan.calls[${params.index}].categoryId`,
  );
  assertSubmissionDetails(
    args[6],
    params.expectedPlan.primaryQuestion,
    `transactionPlan.calls[${params.index}].details`,
  );
  assertEqualBytes32(
    args[7],
    params.expectedPlan.primaryQuestion.salt,
    `transactionPlan.calls[${params.index}].salt`,
  );
  assertRewardTerms(
    args[8],
    params.expectedPlan.rewardTerms,
    `transactionPlan.calls[${params.index}].rewardTerms`,
  );
  assertRoundConfig(
    args[9],
    params.expectedPlan.roundConfig,
    `transactionPlan.calls[${params.index}].roundConfig`,
  );
  assertQuestionSpec(
    args[10],
    params.expectedPlan.primaryQuestion.spec,
    `transactionPlan.calls[${params.index}].spec`,
  );
  assertQuestionConfidentiality(
    args[11],
    params.expectedPlan.primaryQuestion.confidentiality,
    `transactionPlan.calls[${params.index}].confidentiality`,
  );
}

function validateSubmitX402QuestionCall(params: {
  accountAddress: Address;
  call: RateLoopAgentWalletTransactionCall;
  contentRegistryAddress: Address;
  expectedPaymentAuthorization: X402Authorization;
  expectedPlan: ExpectedLocalSignerQuestionPlan;
  index: number;
  questionRewardPoolEscrowAddress: Address;
  responseChainId: number;
  x402QuestionSubmitterAddress: Address;
}) {
  const { data } = normalizeCallEnvelope({
    call: params.call,
    expectedPhase: "submit_x402_question",
    expectedTo: params.x402QuestionSubmitterAddress,
    index: params.index,
  });
  const decoded = decodedCall(
    data,
    X402QuestionSubmitterAbi,
    `transactionPlan.calls[${params.index}]`,
  );
  if (decoded.functionName !== "submitQuestionWithX402Payment") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call submitQuestionWithX402Payment.`,
    );
  }
  if (params.expectedPlan.isBundleSubmission) {
    throw new Error(
      "x402_authorization transaction plans must submit exactly one question.",
    );
  }
  const args = decoded.args ?? [];
  assertEqualString(
    args[0],
    params.expectedPlan.primaryQuestion.contextUrl,
    `transactionPlan.calls[${params.index}].contextUrl`,
  );
  assertStringArray(
    args[1],
    params.expectedPlan.primaryQuestion.imageUrls,
    `transactionPlan.calls[${params.index}].imageUrls`,
  );
  assertEqualString(
    args[2],
    params.expectedPlan.primaryQuestion.videoUrl,
    `transactionPlan.calls[${params.index}].videoUrl`,
  );
  assertEqualString(
    args[3],
    params.expectedPlan.primaryQuestion.title,
    `transactionPlan.calls[${params.index}].title`,
  );
  assertEqualString(
    args[4],
    params.expectedPlan.primaryQuestion.tags,
    `transactionPlan.calls[${params.index}].tags`,
  );
  assertEqualBigInt(
    args[5],
    params.expectedPlan.primaryQuestion.categoryId,
    `transactionPlan.calls[${params.index}].categoryId`,
  );
  assertSubmissionDetails(
    args[6],
    params.expectedPlan.primaryQuestion,
    `transactionPlan.calls[${params.index}].details`,
  );
  assertEqualBytes32(
    args[7],
    params.expectedPlan.primaryQuestion.salt,
    `transactionPlan.calls[${params.index}].salt`,
  );
  assertRewardTerms(
    args[8],
    params.expectedPlan.rewardTerms,
    `transactionPlan.calls[${params.index}].rewardTerms`,
  );
  assertRoundConfig(
    args[9],
    params.expectedPlan.roundConfig,
    `transactionPlan.calls[${params.index}].roundConfig`,
  );
  assertQuestionSpec(
    args[10],
    params.expectedPlan.primaryQuestion.spec,
    `transactionPlan.calls[${params.index}].spec`,
  );
  assertQuestionConfidentiality(
    args[11],
    params.expectedPlan.primaryQuestion.confidentiality,
    `transactionPlan.calls[${params.index}].confidentiality`,
  );
  const authorization = decoded.args?.[12];
  if (!authorization || typeof authorization !== "object") {
    throw new Error(
      `transactionPlan.calls[${params.index}].paymentAuthorization is required.`,
    );
  }
  const authorizationFieldName = `transactionPlan.calls[${params.index}].paymentAuthorization`;
  const parsed = authorization as JsonRecord;
  if (
    !sameAddress(
      normalizeAddress(
        readStructField(parsed, "from", 0, authorizationFieldName),
        "paymentAuthorization.from",
      ),
      params.accountAddress,
    )
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] x402 authorization.from must match the local signer.`,
    );
  }
  if (
    !sameAddress(
      normalizeAddress(
        readStructField(parsed, "to", 1, authorizationFieldName),
        "paymentAuthorization.to",
      ),
      params.x402QuestionSubmitterAddress,
    )
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] x402 authorization.to must be the RateLoop submitter.`,
    );
  }
  if (
    normalizeBigInt(
      readStructField(parsed, "value", 2, authorizationFieldName),
      "paymentAuthorization.value",
    ) !== params.expectedPlan.rewardTerms.amount
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] x402 authorization.value must equal the requested bounty.`,
    );
  }
  const decodedAuthorization: X402Authorization = {
    from: normalizeAddress(
      readStructField(parsed, "from", 0, authorizationFieldName),
      `${authorizationFieldName}.from`,
    ),
    nonce: normalizeBytes32(
      readStructField(parsed, "nonce", 5, authorizationFieldName),
      `${authorizationFieldName}.nonce`,
    ),
    to: normalizeAddress(
      readStructField(parsed, "to", 1, authorizationFieldName),
      `${authorizationFieldName}.to`,
    ),
    validAfter: normalizeBigInt(
      readStructField(parsed, "validAfter", 3, authorizationFieldName),
      `${authorizationFieldName}.validAfter`,
    ).toString(),
    validBefore: normalizeBigInt(
      readStructField(parsed, "validBefore", 4, authorizationFieldName),
      `${authorizationFieldName}.validBefore`,
    ).toString(),
    value: normalizeBigInt(
      readStructField(parsed, "value", 2, authorizationFieldName),
      `${authorizationFieldName}.value`,
    ).toString(),
  };
  const expectedNonce = buildX402QuestionPaymentNonce({
    chainId: params.responseChainId,
    contentRegistryAddress: params.contentRegistryAddress,
    question: params.expectedPlan.primaryQuestion,
    questionRewardPoolEscrowAddress: params.questionRewardPoolEscrowAddress,
    rewardTerms: params.expectedPlan.rewardTerms,
    roundConfig: params.expectedPlan.roundConfig,
    x402Authorization: decodedAuthorization,
    x402QuestionSubmitterAddress: params.x402QuestionSubmitterAddress,
  });
  assertEqualBytes32(
    decodedAuthorization.nonce,
    expectedNonce,
    `${authorizationFieldName}.nonce`,
  );
  assertEqualAddress(
    decodedAuthorization.from,
    normalizeAddress(
      params.expectedPaymentAuthorization.from,
      "signed x402 authorization.from",
    ),
    `${authorizationFieldName}.from`,
  );
  assertEqualAddress(
    decodedAuthorization.to,
    normalizeAddress(
      params.expectedPaymentAuthorization.to,
      "signed x402 authorization.to",
    ),
    `${authorizationFieldName}.to`,
  );
  assertEqualBigInt(
    decodedAuthorization.value,
    normalizeBigInt(
      params.expectedPaymentAuthorization.value,
      "signed x402 authorization.value",
    ),
    `${authorizationFieldName}.value`,
  );
  assertEqualBigInt(
    decodedAuthorization.validAfter,
    normalizeBigInt(
      params.expectedPaymentAuthorization.validAfter,
      "signed x402 authorization.validAfter",
    ),
    `${authorizationFieldName}.validAfter`,
  );
  assertEqualBigInt(
    decodedAuthorization.validBefore,
    normalizeBigInt(
      params.expectedPaymentAuthorization.validBefore,
      "signed x402 authorization.validBefore",
    ),
    `${authorizationFieldName}.validBefore`,
  );
  assertEqualBytes32(
    decodedAuthorization.nonce,
    normalizeBytes32(
      params.expectedPaymentAuthorization.nonce,
      "signed x402 authorization.nonce",
    ),
    `${authorizationFieldName}.nonce`,
  );
  if (!params.expectedPaymentAuthorization.signature) {
    throw new Error(
      "Signed x402 authorization must include a signature before executing the transaction plan.",
    );
  }
  const signature = parseSignature(
    params.expectedPaymentAuthorization.signature,
  );
  const expectedV = Number(signature.v ?? BigInt(signature.yParity + 27));
  assertEqualBytes32(
    readStructField(parsed, "r", 7, authorizationFieldName),
    signature.r,
    `${authorizationFieldName}.r`,
  );
  assertEqualBytes32(
    readStructField(parsed, "s", 8, authorizationFieldName),
    signature.s,
    `${authorizationFieldName}.s`,
  );
  assertEqualNumber(
    readStructField(parsed, "v", 6, authorizationFieldName),
    expectedV,
    `${authorizationFieldName}.v`,
  );
}

function validatePaymentMetadata(params: {
  ask: AskHumansResponse;
  expectedAmount: bigint;
  expectedSpender: Address;
  usdcAddress: Address;
}) {
  const payment = params.ask.payment;
  if (!payment) {
    throw new Error("RateLoop transaction plan is missing payment metadata.");
  }
  if (
    !payment.tokenAddress ||
    !sameAddress(
      normalizeAddress(payment.tokenAddress, "payment.tokenAddress"),
      params.usdcAddress,
    )
  ) {
    throw new Error(
      "RateLoop transaction plan payment.tokenAddress must be the configured USDC token.",
    );
  }
  if (
    !payment.spender ||
    !sameAddress(
      normalizeAddress(payment.spender, "payment.spender"),
      params.expectedSpender,
    )
  ) {
    throw new Error(
      "RateLoop transaction plan payment.spender must be the expected RateLoop contract.",
    );
  }
  if (
    normalizeBigInt(payment.amount, "payment.amount") !== params.expectedAmount
  ) {
    throw new Error(
      "RateLoop transaction plan payment.amount must equal the requested bounty amount.",
    );
  }
}

function readAskQuestionMetadataBaseUrl(
  ask: AskHumansResponse,
): string | undefined {
  const value = ask.questionMetadataBaseUrl;
  return parseQuestionMetadataBaseUrl(
    typeof value === "string" ? value : undefined,
    "ask response questionMetadataBaseUrl",
  );
}

export function validateLocalSignerTransactionPlan(params: {
  accountAddress: Address;
  ask: AskHumansResponse;
  config: TransactionPlanValidationConfig;
  expectedBountyAmount: bigint;
  expectedChainId?: number;
  expectedPaymentAuthorization?: X402Authorization | null;
  expectedPayload: AskHumansRequest;
}): RateLoopAgentWalletTransactionCall[] {
  const calls = params.ask.transactionPlan?.calls ?? [];
  if (calls.length === 0) {
    return [];
  }
  normalizeOperationKey(params.ask.operationKey, "operationKey");
  if (params.ask.transactionPlan?.requiresOrderedExecution !== true) {
    throw new Error(
      "RateLoop transaction plans must require ordered execution.",
    );
  }
  const responseChainId = normalizeRequiredChainId(
    params.ask.chainId,
    "ask response chainId",
  );
  if (
    params.expectedChainId !== undefined &&
    responseChainId !== params.expectedChainId
  ) {
    throw new Error(
      `Ask response chainId ${responseChainId} does not match local signer chain ${params.expectedChainId}.`,
    );
  }
  const wallet = assertRecord(params.ask.wallet, "ask response wallet");
  const walletAddress = normalizeAddress(
    wallet.address,
    "ask response wallet.address",
  );
  if (!sameAddress(walletAddress, params.accountAddress)) {
    throw new Error(
      `RateLoop transaction plan wallet ${walletAddress} does not match local signer ${params.accountAddress}.`,
    );
  }
  const expectedPlan = buildExpectedLocalSignerQuestionPlan({
    expectedChainId: responseChainId,
    payload: params.expectedPayload,
    questionMetadataBaseUrl: resolveAskQuestionMetadataBaseUrl({
      ask: params.ask,
      config: params.config,
    }),
    walletAddress: params.accountAddress,
  });
  if (expectedPlan.rewardTerms.amount !== params.expectedBountyAmount) {
    throw new Error(
      "Expected bounty amount must match the local signer ask payload.",
    );
  }
  if (
    normalizeOperationKey(
      params.ask.operationKey,
      "operationKey",
    ).toLowerCase() !== expectedPlan.operationKey.toLowerCase()
  ) {
    throw new Error(
      "RateLoop transaction plan operationKey does not match the local signer ask payload.",
    );
  }
  if (
    params.ask.payloadHash !== undefined &&
    params.ask.payloadHash !== expectedPlan.payloadHash
  ) {
    throw new Error(
      "RateLoop transaction plan payloadHash does not match the local signer ask payload.",
    );
  }

  const usdcAddress = requireConfiguredAddress(
    resolveConfiguredUsdcAddress(params.config, responseChainId),
    "USDC token",
  );
  const contentRegistryAddress = requireConfiguredAddress(
    resolveConfiguredContentRegistryAddress(params.config, responseChainId),
    "ContentRegistry",
  );
  const paymentMode =
    typeof params.ask.paymentMode === "string" ? params.ask.paymentMode : "";

  if (paymentMode === "wallet_calls") {
    if (calls.length !== 3) {
      throw new Error(
        "wallet_calls transaction plans must contain approve, reserve, and submit calls.",
      );
    }
    const escrowAddress = requireConfiguredAddress(
      resolveConfiguredQuestionRewardPoolEscrowAddress(
        params.config,
        responseChainId,
      ),
      "QuestionRewardPoolEscrow",
    );
    validatePaymentMetadata({
      ask: params.ask,
      expectedAmount: params.expectedBountyAmount,
      expectedSpender: escrowAddress,
      usdcAddress,
    });
    validateApproveCall({
      call: calls[0]!,
      expectedAmount: params.expectedBountyAmount,
      expectedPhase: "approve_usdc",
      expectedSpender: escrowAddress,
      expectedToken: usdcAddress,
      index: 0,
    });
    validateReserveSubmissionCall({
      call: calls[1]!,
      contentRegistryAddress,
      expectedRevealCommitment: expectedPlan.revealCommitment,
      index: 1,
    });
    validateSubmitQuestionCall({
      call: calls[2]!,
      contentRegistryAddress,
      expectedPlan,
      index: 2,
    });
    return calls;
  }

  if (paymentMode === "x402_authorization") {
    if (calls.length !== 2) {
      throw new Error(
        "x402_authorization transaction plans must contain reserve and submit calls.",
      );
    }
    const x402QuestionSubmitterAddress = requireConfiguredAddress(
      resolveConfiguredX402SubmitterAddress(params.config, responseChainId),
      "X402QuestionSubmitter",
    );
    const questionRewardPoolEscrowAddress = requireConfiguredAddress(
      resolveConfiguredQuestionRewardPoolEscrowAddress(
        params.config,
        responseChainId,
      ),
      "QuestionRewardPoolEscrow",
    );
    if (!params.expectedPaymentAuthorization?.signature) {
      throw new Error(
        "x402_authorization transaction plans require the exact signed local x402 authorization.",
      );
    }
    validatePaymentMetadata({
      ask: params.ask,
      expectedAmount: params.expectedBountyAmount,
      expectedSpender: x402QuestionSubmitterAddress,
      usdcAddress,
    });
    validateReserveSubmissionCall({
      call: calls[0]!,
      contentRegistryAddress,
      expectedRevealCommitment: expectedPlan.revealCommitment,
      index: 0,
    });
    validateSubmitX402QuestionCall({
      accountAddress: params.accountAddress,
      call: calls[1]!,
      contentRegistryAddress,
      expectedPaymentAuthorization: params.expectedPaymentAuthorization,
      expectedPlan,
      index: 1,
      questionRewardPoolEscrowAddress,
      responseChainId,
      x402QuestionSubmitterAddress,
    });
    return calls;
  }

  throw new Error(
    "RateLoop transaction plan paymentMode must be wallet_calls or x402_authorization.",
  );
}

async function deriveScryptKey(
  password: string,
  salt: Buffer,
  params: { dklen: number; n: number; p: number; r: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      Buffer.from(password),
      salt,
      params.dklen,
      {
        N: params.n,
        maxmem: Math.max(32 * 1024 * 1024, 128 * params.n * params.r * 2),
        p: params.p,
        r: params.r,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

async function encryptPrivateKey(
  privateKey: Hex,
  password: string,
  address: Address,
): Promise<KeystoreV3> {
  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const privateKeyBytes = Buffer.from(privateKey.slice(2), "hex");
  const derivedKey = await deriveScryptKey(
    password,
    salt,
    DEFAULT_SCRYPT_PARAMS,
  );
  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([
    cipher.update(privateKeyBytes),
    cipher.final(),
  ]);
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);

  return {
    address: address.slice(2).toLowerCase(),
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: {
        ...DEFAULT_SCRYPT_PARAMS,
        salt: salt.toString("hex"),
      },
      mac: keccak256(`0x${macInput.toString("hex")}`).slice(2),
    },
    version: KEYSTORE_VERSION,
  };
}

async function decryptLocalKeystore(
  path: string,
  password: string,
): Promise<Hex> {
  const raw = await readFile(path, "utf8");
  const keystore = JSON.parse(raw) as KeystoreV3;
  if (keystore.version !== KEYSTORE_VERSION) {
    throw new Error(
      `Unsupported keystore version: ${String(keystore.version)}.`,
    );
  }
  if (keystore.crypto?.kdf !== "scrypt") {
    throw new Error(
      `Unsupported keystore KDF: ${String(keystore.crypto?.kdf)}.`,
    );
  }
  if (keystore.crypto?.cipher !== "aes-128-ctr") {
    throw new Error(
      `Unsupported keystore cipher: ${String(keystore.crypto?.cipher)}.`,
    );
  }

  const params = keystore.crypto.kdfparams;
  const salt = Buffer.from(params.salt, "hex");
  const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");
  const derivedKey = await deriveScryptKey(password, salt, params);
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const computedMac = Buffer.from(
    keccak256(`0x${macInput.toString("hex")}`).slice(2),
    "hex",
  );
  const storedMac = Buffer.from(keystore.crypto.mac.replace(/^0x/, ""), "hex");

  if (
    computedMac.length !== storedMac.length ||
    !timingSafeEqual(computedMac, storedMac)
  ) {
    throw new Error("Keystore MAC mismatch. Check the local signer password.");
  }

  const iv = Buffer.from(keystore.crypto.cipherparams.iv, "hex");
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derivedKey.subarray(0, 16),
    iv,
  );
  const privateKey = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return `0x${privateKey.toString("hex")}` as Hex;
}

export function loadLocalSignerConfig(
  options: CliOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): LocalSignerConfig {
  const passwordEnvName =
    optionString(options, "password-env") ??
    envString(env, "RATELOOP_LOCAL_SIGNER_PASSWORD_ENV");
  const keystorePassword =
    optionString(options, "keystore-password") ??
    (passwordEnvName ? envString(env, passwordEnvName) : undefined) ??
    envString(env, "RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD");

  return {
    chainId: parsePositiveInteger(
      optionString(options, "chain-id") ?? envString(env, "RATELOOP_CHAIN_ID"),
      "RATELOOP_CHAIN_ID",
    ),
    chainName:
      optionString(options, "chain-name") ??
      envString(env, "RATELOOP_CHAIN_NAME") ??
      "RateLoop local signer chain",
    contentRegistryAddress: parseOptionalAddress(
      optionString(options, "content-registry-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_CONTENT_REGISTRY_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_CONTENT_REGISTRY_ADDRESS",
    ),
    feedbackBonusEscrowAddress: parseOptionalAddress(
      optionString(options, "feedback-bonus-escrow-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_FEEDBACK_BONUS_ESCROW_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_FEEDBACK_BONUS_ESCROW_ADDRESS",
    ),
    keystorePassword,
    keystorePath:
      optionString(options, "keystore") ??
      envString(env, "RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH"),
    lrepAddress: parseOptionalAddress(
      optionString(options, "lrep-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_LREP_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_LREP_ADDRESS",
    ),
    pollingIntervalMs:
      parsePositiveInteger(
        optionString(options, "polling-interval-ms") ??
          envString(env, "RATELOOP_LOCAL_SIGNER_POLLING_INTERVAL_MS"),
        "RATELOOP_LOCAL_SIGNER_POLLING_INTERVAL_MS",
      ) ?? 2_000,
    privateKey: parsePrivateKey(
      optionString(options, "private-key") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_PRIVATE_KEY"),
      "RATELOOP_LOCAL_SIGNER_PRIVATE_KEY",
    ),
    ...resolveLocalSignerQuestionMetadataBaseUrlConfig(options, env),
    questionRewardPoolEscrowAddress: parseOptionalAddress(
      optionString(options, "question-reward-pool-escrow-address") ??
        envString(
          env,
          "RATELOOP_LOCAL_SIGNER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
        ),
      "RATELOOP_LOCAL_SIGNER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
    ),
    receiptTimeoutMs:
      parsePositiveInteger(
        optionString(options, "receipt-timeout-ms") ??
          envString(env, "RATELOOP_LOCAL_SIGNER_RECEIPT_TIMEOUT_MS"),
        "RATELOOP_LOCAL_SIGNER_RECEIPT_TIMEOUT_MS",
      ) ?? 120_000,
    rpcUrl:
      optionString(options, "rpc-url") ?? envString(env, "RATELOOP_RPC_URL"),
    usdcAddress: parseOptionalAddress(
      optionString(options, "usdc-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS") ??
        envString(env, "RATELOOP_X402_USDC_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS",
    ),
    x402QuestionSubmitterAddress: parseOptionalAddress(
      optionString(options, "x402-submitter-address") ??
        envString(env, "RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS") ??
        envString(env, "RATELOOP_X402_QUESTION_SUBMITTER_ADDRESS"),
      "RATELOOP_LOCAL_SIGNER_X402_SUBMITTER_ADDRESS",
    ),
  };
}

export async function loadLocalSignerWallet(
  config: LocalSignerConfig,
): Promise<LoadedLocalSignerWallet> {
  if (config.keystorePath && config.privateKey) {
    throw new Error(
      "Set either RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or RATELOOP_LOCAL_SIGNER_PRIVATE_KEY, not both.",
    );
  }

  if (config.keystorePath) {
    if (!config.keystorePassword) {
      throw new Error(
        "Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD to unlock the local signer keystore.",
      );
    }
    const privateKey = await decryptLocalKeystore(
      resolve(config.keystorePath),
      config.keystorePassword,
    );
    return { account: privateKeyToAccount(privateKey), source: "keystore" };
  }

  if (config.privateKey) {
    return {
      account: privateKeyToAccount(config.privateKey),
      source: "private-key",
    };
  }

  throw new Error(
    "No local signer wallet configured. Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or generate one with `wallet --generate`.",
  );
}

export async function generateLocalSignerWallet(
  config: LocalSignerConfig,
  options: { overwrite?: boolean } = {},
): Promise<GeneratedLocalSignerWallet> {
  if (!config.keystorePath) {
    throw new Error(
      "Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH or pass --keystore before generating a wallet.",
    );
  }
  if (!config.keystorePassword) {
    throw new Error(
      "Set RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD before generating a wallet.",
    );
  }
  if (config.privateKey) {
    throw new Error(
      "Refusing to generate a keystore while RATELOOP_LOCAL_SIGNER_PRIVATE_KEY is set.",
    );
  }

  const keystorePath = resolve(config.keystorePath);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const keystore = await encryptPrivateKey(
    privateKey,
    config.keystorePassword,
    account.address,
  );
  await mkdir(dirname(keystorePath), { recursive: true });
  await writeFile(keystorePath, `${JSON.stringify(keystore, null, 2)}\n`, {
    flag: options.overwrite ? "w" : "wx",
    mode: 0o600,
  });
  await chmod(keystorePath, 0o600);

  return { account, keystorePath, source: "keystore" };
}

export function withLocalSignerWallet(
  payload: unknown,
  walletAddress: Address,
): AskHumansRequest {
  const request = assertRecord(payload, "ask payload") as AskHumansRequest;
  const requestedWallet = request.walletAddress;
  if (
    typeof requestedWallet === "string" &&
    requestedWallet.trim() &&
    !sameAddress(requestedWallet, walletAddress)
  ) {
    throw new Error(
      `Ask payload walletAddress ${requestedWallet} does not match local signer ${walletAddress}.`,
    );
  }

  return { ...request, walletAddress };
}

function withLocalSignerChainId(
  request: AskHumansRequest,
  chainId: number | undefined,
): AskHumansRequest {
  const requestedChainId = normalizeOptionalChainId(
    request.chainId,
    "ask payload chainId",
  );
  if (chainId === undefined) {
    return requestedChainId === undefined
      ? request
      : { ...request, chainId: requestedChainId };
  }

  if (requestedChainId !== undefined && requestedChainId !== chainId) {
    throw new Error(
      `Ask payload chainId ${requestedChainId} does not match local signer chain ${chainId}.`,
    );
  }

  return { ...request, chainId };
}

export async function signX402AuthorizationRequest(
  account: PrivateKeyAccount,
  x402AuthorizationRequest: unknown,
  options: SignX402AuthorizationOptions = {},
): Promise<X402Authorization> {
  const { authorization, typedData, typedDataDomain } =
    parseX402AuthorizationRequest(x402AuthorizationRequest);
  assertTrustedX402Authorization(account, authorization, typedDataDomain, {
    ...options,
    expectedChainId: options.expectedChainId ?? typedDataDomain.chainId,
    expectedUsdcAddress:
      options.expectedUsdcAddress ??
      X402_USDC_BY_CHAIN_ID[typedDataDomain.chainId],
    expectedX402QuestionSubmitterAddress:
      options.expectedX402QuestionSubmitterAddress ??
      getSharedDeploymentAddress(
        typedDataDomain.chainId,
        "X402QuestionSubmitter",
      ),
  });

  const signature = await account.signTypedData({
    domain: typedData.domain,
    message: typedData.message,
    primaryType: typedData.primaryType,
    types: typedData.types,
  } as never);

  return { ...authorization, signature };
}

async function resolveChain(config: LocalSignerConfig) {
  if (!config.rpcUrl) {
    throw new Error(
      "Set RATELOOP_RPC_URL before executing local signer transaction plans.",
    );
  }

  const probeClient = createPublicClient({ transport: http(config.rpcUrl) });
  const rpcChainId = await probeClient.getChainId();
  if (config.chainId !== undefined && rpcChainId !== config.chainId) {
    throw new Error(
      `RATELOOP_CHAIN_ID is ${config.chainId}, but RATELOOP_RPC_URL reports ${rpcChainId}.`,
    );
  }

  return defineChain({
    id: rpcChainId,
    name: config.chainName,
    nativeCurrency: { decimals: 18, name: "Native token", symbol: "NATIVE" },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
  });
}

async function resolveConfiguredChainId(
  config: LocalSignerConfig,
): Promise<number | undefined> {
  if (config.rpcUrl) {
    return (await resolveChain(config)).id;
  }
  return config.chainId;
}

function summarizeReceipt(
  receipt: TransactionReceipt,
): LocalTransactionReceiptSummary {
  return {
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    status: receipt.status,
    transactionHash: receipt.transactionHash,
  };
}

async function executeTransactionPlan(params: {
  account: PrivateKeyAccount;
  calls: RateLoopAgentWalletTransactionCall[];
  config: LocalSignerConfig;
  onProgress?: (event: LocalAskProgress) => void;
}): Promise<LocalTransactionExecutionSummary> {
  const chain = await resolveChain(params.config);
  const transport = http(params.config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: params.account,
    chain,
    transport,
  });
  const calls: LocalTransactionExecutionSummary["calls"] = [];

  for (const [index, call] of params.calls.entries()) {
    const to = normalizeAddress(call.to, `transactionPlan.calls[${index}].to`);
    const hash = await walletClient.sendTransaction({
      account: params.account,
      data: normalizeOptionalTransactionData(
        call.data,
        `transactionPlan.calls[${index}].data`,
      ),
      to,
      value: normalizeZeroNativeValue(
        call.value,
        `transactionPlan.calls[${index}].value`,
      ),
    });
    params.onProgress?.({
      hash,
      index,
      phase: call.phase,
      type: "transaction_sent",
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      pollingInterval: params.config.pollingIntervalMs,
      timeout: params.config.receiptTimeoutMs,
    });
    const summary = summarizeReceipt(receipt);
    params.onProgress?.({
      hash,
      index,
      receipt: summary,
      type: "transaction_confirmed",
    });
    if (receipt.status !== "success") {
      throw new Error(`transactionPlan.calls[${index}] reverted: ${hash}`);
    }

    calls.push({ hash, index, phase: call.phase, receipt: summary, to });
    if (typeof call.waitAfterMs === "number" && call.waitAfterMs > 0) {
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, call.waitAfterMs),
      );
    }
  }

  return {
    calls,
    transactionHashes: calls.map((call) => call.hash),
  };
}

export async function askHumansWithLocalSigner(params: {
  account: PrivateKeyAccount;
  agent: Pick<RateLoopAgentClient, "askHumans" | "confirmAskTransactions">;
  config: LocalSignerConfig;
  onProgress?: (event: LocalAskProgress) => void;
  paymentMode?: AskHumansRequest["paymentMode"];
  payload: unknown;
}): Promise<LocalAskResult> {
  const expectedChainId = await resolveConfiguredChainId(params.config);
  const baseAsk = withLocalSignerChainId(
    withLocalSignerWallet(params.payload, params.account.address),
    expectedChainId,
  );
  if (params.paymentMode) {
    baseAsk.paymentMode = params.paymentMode;
  }

  const initialAsk = await params.agent.askHumans(baseAsk);
  params.onProgress?.({ response: initialAsk, type: "ask_submitted" });

  let finalAsk = initialAsk;
  let signedX402Authorization = false;
  let signedPaymentAuthorization: X402Authorization | null = null;
  if (initialAsk.x402AuthorizationRequest) {
    if (baseAsk.chainId === undefined) {
      throw new Error(
        "Ask payload chainId is required before signing an x402 authorization.",
      );
    }
    const expectedPlan = buildExpectedLocalSignerQuestionPlan({
      expectedChainId: baseAsk.chainId,
      payload: baseAsk,
      questionMetadataBaseUrl: resolveAskQuestionMetadataBaseUrl({
        ask: initialAsk,
        config: params.config,
      }),
      walletAddress: params.account.address,
    });
    if (expectedPlan.isBundleSubmission) {
      throw new Error(
        "x402_authorization local signing supports one question per authorization.",
      );
    }
    if (
      initialAsk.operationKey &&
      normalizeOperationKey(
        initialAsk.operationKey,
        "operationKey",
      ).toLowerCase() !== expectedPlan.operationKey.toLowerCase()
    ) {
      throw new Error(
        "RateLoop x402 authorization operationKey does not match the local signer ask payload.",
      );
    }
    if (
      initialAsk.payloadHash !== undefined &&
      initialAsk.payloadHash !== expectedPlan.payloadHash
    ) {
      throw new Error(
        "RateLoop x402 authorization payloadHash does not match the local signer ask payload.",
      );
    }
    const { authorization: pendingAuthorization } =
      parseX402AuthorizationRequest(initialAsk.x402AuthorizationRequest);
    const contentRegistryAddress = requireConfiguredAddress(
      resolveConfiguredContentRegistryAddress(params.config, baseAsk.chainId),
      "ContentRegistry",
    );
    const questionRewardPoolEscrowAddress = requireConfiguredAddress(
      resolveConfiguredQuestionRewardPoolEscrowAddress(
        params.config,
        baseAsk.chainId,
      ),
      "QuestionRewardPoolEscrow",
    );
    const x402QuestionSubmitterAddress = requireConfiguredAddress(
      resolveConfiguredX402SubmitterAddress(params.config, baseAsk.chainId),
      "X402QuestionSubmitter",
    );
    const expectedNonce = buildX402QuestionPaymentNonce({
      chainId: baseAsk.chainId,
      contentRegistryAddress,
      question: expectedPlan.primaryQuestion,
      questionRewardPoolEscrowAddress,
      rewardTerms: expectedPlan.rewardTerms,
      roundConfig: expectedPlan.roundConfig,
      x402Authorization: pendingAuthorization,
      x402QuestionSubmitterAddress,
    });
    const paymentAuthorization = await signX402AuthorizationRequest(
      params.account,
      initialAsk.x402AuthorizationRequest,
      {
        expectedChainId: baseAsk.chainId,
        expectedAmount: normalizeBigInt(
          baseAsk.bounty.amount,
          "ask payload bounty.amount",
        ),
        expectedNonce,
        expectedUsdcAddress: resolveConfiguredUsdcAddress(
          params.config,
          baseAsk.chainId,
        ),
        expectedX402QuestionSubmitterAddress: x402QuestionSubmitterAddress,
      },
    );
    signedPaymentAuthorization = paymentAuthorization;
    signedX402Authorization = true;
    params.onProgress?.({ type: "x402_signed" });

    finalAsk = await params.agent.askHumans({
      ...baseAsk,
      paymentAuthorization,
      paymentMode: "x402_authorization",
    });
    params.onProgress?.({ response: finalAsk, type: "x402_resubmitted" });
  }

  const calls = validateLocalSignerTransactionPlan({
    accountAddress: params.account.address,
    ask: finalAsk,
    config: params.config,
    expectedBountyAmount: normalizeBigInt(
      baseAsk.bounty.amount,
      "ask payload bounty.amount",
    ),
    expectedChainId: baseAsk.chainId,
    expectedPaymentAuthorization: signedPaymentAuthorization,
    expectedPayload: baseAsk,
  });
  if (!calls.length) {
    return {
      finalAsk,
      initialAsk,
      signedX402Authorization,
      walletAddress: params.account.address,
    };
  }

  if (!finalAsk.operationKey) {
    throw new Error(
      "RateLoop returned a transaction plan without an operationKey.",
    );
  }

  const transactions = await executeTransactionPlan({
    account: params.account,
    calls,
    config: params.config,
    onProgress: params.onProgress,
  });
  const confirmRequest: ConfirmAskTransactionsRequest = {
    operationKey: finalAsk.operationKey,
    transactionHashes: transactions.transactionHashes,
  };
  const confirmed = await params.agent.confirmAskTransactions(confirmRequest);
  params.onProgress?.({ response: confirmed, type: "transactions_confirmed" });

  return {
    confirmed,
    finalAsk,
    initialAsk,
    signedX402Authorization,
    transactions,
    walletAddress: params.account.address,
  };
}
