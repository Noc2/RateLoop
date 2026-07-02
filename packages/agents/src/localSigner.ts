import {
  createCipheriv,
  createDecipheriv,
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
  FeedbackBonusEscrowAbi,
  X402QuestionSubmitterAbi,
} from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import {
  CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  USDC_BY_CHAIN_ID,
  getUsdcEip712DomainName,
} from "@rateloop/contracts/protocol";
import type {
  AskHumansRequest,
  AskHumansResponse,
  ConfirmAskTransactionsRequest,
  RateLoopAgentClient,
  RateLoopAgentWalletTransactionCall,
  QuestionStatusResponse,
} from "@rateloop/sdk/agent";
import { assertSafeScryptParams } from "@rateloop/node-utils/keystore";
import { normalizeQuestionMetadataBaseUrl } from "./questionSpecs.js";
import {
  buildX402QuestionOperation as buildSharedX402QuestionOperation,
  buildDeterministicX402QuestionSalt,
  buildX402QuestionOneShotPaymentNonce as buildSharedX402QuestionOneShotPaymentNonce,
  buildX402QuestionPaymentNonce as buildSharedX402QuestionPaymentNonce,
  parseX402QuestionRequest as parseSharedX402QuestionRequest,
  buildDefaultX402QuestionParserOptions,
  toCanonicalQuestionPayload as toSharedCanonicalQuestionPayload,
  X402_CONFIDENTIALITY_BOND_UINT64_MAX,
  X402_ROUND_CONFIG_UINT16_MAX,
  X402_ROUND_CONFIG_UINT32_MAX,
  type X402QuestionItemPayload,
  type X402QuestionPayload,
  type X402QuestionParserOptions,
  type X402QuestionRoundConfig,
} from "./x402QuestionPayload.js";

type CliOptions = Record<string, string | boolean | undefined>;
type JsonRecord = Record<string, unknown>;
type ChainScopedAddressOverrides = Partial<Record<number, Address>>;

const KEYSTORE_VERSION = 3;
const RESERVED_SUBMISSION_MIN_AGE_SECONDS = 1n;
const RESERVATION_REVEAL_READY_TIMEOUT_MS = 30_000;
const DEFAULT_SCRYPT_PARAMS = {
  dklen: 32,
  n: 1 << 15,
  p: 1,
  r: 8,
};

const X402_USDC_BY_CHAIN_ID: Record<number, Address> = USDC_BY_CHAIN_ID;
const X402_PRIMARY_TYPE = "ReceiveWithAuthorization";
const X402_AUTHORIZATION_FIELDS = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;
const X402QuestionSubmitterOneShotAbi = [
  {
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
        name: "details",
        type: "tuple",
      },
      { name: "salt", type: "bytes32" },
      {
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
        name: "rewardTerms",
        type: "tuple",
      },
      {
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
        name: "roundConfig",
        type: "tuple",
      },
      {
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
        name: "spec",
        type: "tuple",
      },
      {
        components: [
          { name: "gated", type: "bool" },
          { name: "bondAsset", type: "uint8" },
          { name: "bondAmount", type: "uint64" },
          { name: "flags", type: "uint8" },
        ],
        name: "confidentiality",
        type: "tuple",
      },
      {
        components: [
          { name: "amount", type: "uint256" },
          { name: "awarder", type: "address" },
        ],
        name: "feedbackBonusTerms",
        type: "tuple",
      },
      {
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
        name: "paymentAuthorization",
        type: "tuple",
      },
    ],
    name: "submitQuestionWithX402OneShotPayment",
    outputs: [
      { name: "contentId", type: "uint256" },
      { name: "feedbackBonusPoolId", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
const LocalX402QuestionSubmitterAbi = [
  ...X402QuestionSubmitterAbi,
  ...X402QuestionSubmitterOneShotAbi,
] as const;
/**
 * Sanity cap on EIP-3009 authorization lifetimes. The RateLoop server
 * proposes validBefore, so without a cap a compromised or buggy server could
 * obtain a transfer authorization that stays valid for years. Question
 * submissions settle within minutes, so 24 hours is generous headroom.
 */
const MAX_X402_AUTHORIZATION_VALIDITY_SECONDS = 24n * 60n * 60n;
const FEEDBACK_BONUS_ASSET_LREP = 0;
const FEEDBACK_BONUS_ASSET_USDC = 1;
const X402_SUBMISSION_REWARD_ASSET_LREP = 0;
const X402_SUBMISSION_REWARD_ASSET_USDC = 1;
const QUESTION_CONTEXT_DOMAIN = keccak256(
  stringToHex("rateloop-question-context-v5"),
);
const QUESTION_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-reveal-v9"),
);
const QUESTION_BUNDLE_ITEM_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-item-v5"),
);
const QUESTION_BUNDLE_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-v5"),
);
const QUESTION_BUNDLE_REVEAL_DOMAIN = keccak256(
  stringToHex("rateloop-question-bundle-reveal-v7"),
);
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
  usdcAddressesByChain?: ChainScopedAddressOverrides;
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

type LocalTransactionPlanKind = "ask" | "feedback_bonus";

type LocalAskResult = {
  askConfirmed?: QuestionStatusResponse;
  confirmed?: QuestionStatusResponse;
  feedbackBonusConfirmed?: QuestionStatusResponse;
  feedbackBonusTransactions?: LocalTransactionExecutionSummary;
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
  | {
      type: "transaction_sent";
      hash: Hex;
      index: number;
      phase?: string;
      plan?: LocalTransactionPlanKind;
    }
  | {
      type: "transaction_confirmed";
      hash: Hex;
      index: number;
      plan?: LocalTransactionPlanKind;
      receipt: LocalTransactionReceiptSummary;
    }
  | {
      type: "transactions_confirmed";
      plan?: LocalTransactionPlanKind;
      response: QuestionStatusResponse;
    };

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
  | "usdcAddressesByChain"
  | "x402QuestionSubmitterAddress"
>;

type LocalSignerAgentClient = Pick<
  RateLoopAgentClient,
  "askHumans" | "confirmAskTransactions"
> & {
  confirmFeedbackBonusTransactions?: (
    params: ConfirmAskTransactionsRequest,
  ) => Promise<QuestionStatusResponse>;
};

type ExecuteLocalTransactionPlanParams = {
  account: PrivateKeyAccount;
  calls: RateLoopAgentWalletTransactionCall[];
  config: LocalSignerConfig;
  onProgress?: (event: LocalAskProgress) => void;
  plan?: LocalTransactionPlanKind;
};

type LocalTransactionPlanExecutor = (
  params: ExecuteLocalTransactionPlanParams,
) => Promise<LocalTransactionExecutionSummary>;

type LocalFeedbackBonusAsset = "LREP" | "USDC";
type LocalSubmissionRewardAsset = X402QuestionPayload["bounty"]["asset"];

type ExpectedLocalSignerFeedbackBonus = {
  amount: bigint;
  asset: LocalFeedbackBonusAsset;
  assetId: typeof FEEDBACK_BONUS_ASSET_LREP | typeof FEEDBACK_BONUS_ASSET_USDC;
  awarder: Address;
};

type ExpectedLocalSignerFeedbackBonusPoolTarget = {
  contentId: bigint;
  feedbackClosesAt: bigint;
  roundId: bigint;
};

type LocalQuestionRoundConfig = X402QuestionRoundConfig;
type LocalQuestionConfidentiality = X402QuestionItemPayload["confidentiality"];
type LocalQuestionItemPayload = Omit<
  X402QuestionItemPayload,
  | "detailsHash"
  | "questionMetadataHash"
  | "questionMetadataUri"
  | "resultSpecHash"
> & {
  detailsHash: Hex;
  questionMetadataHash: Hex;
  questionMetadataUri: string;
  resultSpecHash: Hex;
};
type LocalQuestionPayload = Omit<X402QuestionPayload, "questions"> & {
  questions: LocalQuestionItemPayload[];
};

type LocalRewardTerms = {
  amount: bigint;
  asset:
    | typeof X402_SUBMISSION_REWARD_ASSET_LREP
    | typeof X402_SUBMISSION_REWARD_ASSET_USDC;
  bountyEligibility: number;
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
  if (amount > X402_CONFIDENTIALITY_BOND_UINT64_MAX) {
    throw new Error(
      `question.confidentiality.bond.amount must be at most ${X402_CONFIDENTIALITY_BOND_UINT64_MAX}.`,
    );
  }
  const flags = questionConfidentialityFlags(confidentiality);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bool" },
        { type: "uint8" },
        { type: "uint64" },
        { type: "uint8" },
      ],
      [gated, asset, amount, flags],
    ),
  );
}

function questionConfidentialityFlags(
  confidentiality: LocalQuestionConfidentiality,
) {
  return confidentiality.visibility === "gated" &&
    confidentiality.disclosurePolicy === "private_forever"
    ? CONFIDENTIALITY_FLAG_PRIVATE_FOREVER
    : 0;
}

type ExpectedLocalSignerQuestionPlan = {
  canonicalPayload: ReturnType<typeof toCanonicalLocalQuestionPayload>;
  isBundleSubmission: boolean;
  operationKey: Hex;
  parsedPayload: X402QuestionPayload;
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

function parseOptionalAddressAlias(
  primaryValue: string | undefined,
  primaryName: string,
  aliasValue: string | undefined,
  aliasName: string,
): Address | undefined {
  const primary = parseOptionalAddress(primaryValue, primaryName);
  const alias = parseOptionalAddress(aliasValue, aliasName);
  if (primary && alias && !sameAddress(primary, alias)) {
    throw new Error(
      `${primaryName} and ${aliasName} must match when both are set.`,
    );
  }
  return primary ?? alias;
}

function parseChainScopedAddressAliases(
  env: NodeJS.ProcessEnv,
  primaryName: string,
  aliasName: string,
): ChainScopedAddressOverrides {
  const addressesByChain: Record<number, Address> = {};
  const namesByChain: Record<number, string> = {};

  for (const baseName of [primaryName, aliasName]) {
    const prefix = `${baseName}_`;
    for (const [rawName, rawValue] of Object.entries(env)) {
      if (!rawName.startsWith(prefix)) continue;
      const suffix = rawName.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;

      const chainId = Number(suffix);
      if (!Number.isSafeInteger(chainId) || chainId <= 0) {
        throw new Error(
          `${rawName} must use a positive safe integer chain id.`,
        );
      }

      const address = parseOptionalAddress(
        typeof rawValue === "string" ? rawValue.trim() : undefined,
        rawName,
      );
      if (!address) continue;

      const existingAddress = addressesByChain[chainId];
      if (existingAddress && !sameAddress(existingAddress, address)) {
        throw new Error(
          `${namesByChain[chainId]} and ${rawName} must match when both are set.`,
        );
      }
      addressesByChain[chainId] = address;
      namesByChain[chainId] = namesByChain[chainId] ?? rawName;
    }
  }

  return addressesByChain;
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

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function normalizeLocalSignerRpcUrl(
  value: string | undefined,
  name: string,
): string | undefined {
  if (!value) return undefined;
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be a valid http(s) URL.`);
  }

  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error(
      `${name} must use HTTPS; localhost HTTP is only allowed for local development.`,
    );
  }

  return parsed.toString().replace(/\/$/, "");
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

function parseMaxPaymentAmount(value: unknown): bigint {
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("maxPaymentAmount must be a safe non-negative integer.");
  }
  const raw =
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string"
      ? String(value).trim()
      : "";
  if (!/^\d+$/.test(raw)) {
    throw new Error("maxPaymentAmount must be a non-negative integer string.");
  }
  return BigInt(raw);
}

function normalizeSubmissionRewardAsset(
  value: unknown,
): LocalSubmissionRewardAsset {
  if (value === undefined || value === null || value === "") return "USDC";
  if (typeof value !== "string") {
    throw new Error("bounty.asset must be USDC or LREP.");
  }
  const asset = value.trim().toUpperCase();
  if (asset === "USDC" || asset === "LREP") return asset;
  throw new Error("bounty.asset must be USDC or LREP.");
}

function sameAssetFeedbackBonusPaymentAmount(request: AskHumansRequest): bigint {
  const bonus = request.feedbackBonus;
  if (!bonus) return 0n;
  assertSingleQuestionFeedbackBonus(request);
  const bountyAsset = normalizeSubmissionRewardAsset(request.bounty.asset);
  const bonusAsset = normalizeFeedbackBonusAsset(bonus.asset ?? bountyAsset);
  if (bonusAsset !== bountyAsset) return 0n;
  return normalizeBigInt(bonus.amount, "feedbackBonus.amount");
}

function normalizeFeedbackBonusAsset(value: unknown): LocalFeedbackBonusAsset {
  if (value === undefined || value === null || value === "") return "USDC";
  if (typeof value !== "string") {
    throw new Error("feedbackBonus.asset must be USDC or LREP.");
  }
  const asset = value.trim().toUpperCase();
  if (asset === "USDC" || asset === "LREP") return asset;
  throw new Error("feedbackBonus.asset must be USDC or LREP.");
}

function assertSingleQuestionFeedbackBonus(request: AskHumansRequest): void {
  if (Array.isArray(request.questions) && request.questions.length !== 1) {
    throw new Error("Feedback Bonus funding requires a single-question ask.");
  }
}

function submissionRewardAssetId(
  asset: LocalSubmissionRewardAsset,
): LocalRewardTerms["asset"] {
  return asset === "LREP"
    ? X402_SUBMISSION_REWARD_ASSET_LREP
    : X402_SUBMISSION_REWARD_ASSET_USDC;
}

function submissionRewardAssetLabel(
  assetId: LocalRewardTerms["asset"],
): LocalSubmissionRewardAsset {
  return assetId === X402_SUBMISSION_REWARD_ASSET_LREP ? "LREP" : "USDC";
}

function normalizeLocalSignerFeedbackBonus(
  request: AskHumansRequest,
  walletAddress: Address,
): ExpectedLocalSignerFeedbackBonus | null {
  const bonus = request.feedbackBonus;
  if (bonus === undefined || bonus === null) return null;
  assertSingleQuestionFeedbackBonus(request);
  if (typeof bonus !== "object" || Array.isArray(bonus)) {
    throw new Error("feedbackBonus must be an object when provided.");
  }
  const bountyAsset = normalizeSubmissionRewardAsset(request.bounty.asset);
  const asset = normalizeFeedbackBonusAsset(bonus.asset ?? bountyAsset);
  const amount = normalizeBigInt(bonus.amount, "feedbackBonus.amount");
  if (amount <= 0n) {
    throw new Error("feedbackBonus.amount must be greater than zero.");
  }
  if (bonus.feedbackClosesAt !== undefined) {
    throw new Error(
      "feedbackBonus.feedbackClosesAt is no longer accepted; Feedback Bonus timing uses the question duration.",
    );
  }
  const awarder =
    typeof bonus.awarder === "string" && bonus.awarder.trim()
      ? normalizeAddress(bonus.awarder, "feedbackBonus.awarder")
      : walletAddress;
  return {
    amount,
    asset,
    assetId:
      asset === "LREP" ? FEEDBACK_BONUS_ASSET_LREP : FEEDBACK_BONUS_ASSET_USDC,
    awarder,
  };
}

function assertWithinMaxPaymentAmount(request: AskHumansRequest): bigint {
  if (
    request.maxPaymentAmount === undefined ||
    request.maxPaymentAmount === null
  ) {
    throw new Error("maxPaymentAmount is required for local signer asks.");
  }
  const cap = parseMaxPaymentAmount(request.maxPaymentAmount);
  const total =
    normalizeBigInt(request.bounty.amount, "bounty.amount") +
    sameAssetFeedbackBonusPaymentAmount(request);
  if (total > cap) {
    throw new Error("Quoted payment exceeds maxPaymentAmount.");
  }
  return cap;
}

function assertAskPaymentWithinCap(ask: AskHumansResponse, cap: bigint): void {
  const payment = ask.payment;
  if (!payment) return;
  const quoted = normalizeBigInt(
    payment.totalAmount ?? payment.amount,
    "payment.totalAmount",
  );
  if (quoted > cap) {
    throw new Error("RateLoop quoted payment exceeds maxPaymentAmount.");
  }
}

function assertProductionQuestionMetadataBaseUrlPinned(
  config: TransactionPlanValidationConfig,
): void {
  if (
    process.env.NODE_ENV === "production" &&
    !config.questionMetadataBaseUrlPinned
  ) {
    throw new Error(
      "Production local signer requires RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL or --question-metadata-base-url.",
    );
  }
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

function normalizeRequiredPositiveBigInt(value: unknown, name: string): bigint {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required.`);
  }
  const parsed = normalizeBigInt(value, name);
  if (parsed <= 0n) {
    throw new Error(`${name} must be greater than zero.`);
  }
  return parsed;
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
  if (typeof domainRecord.name !== "string" || !domainRecord.name.trim()) {
    throw new Error("x402 typedData.domain.name must be a non-empty string.");
  }
  if (domainRecord.version !== "2") {
    throw new Error("x402 typedData.domain.version must be 2.");
  }
  const expectedDomainName = getUsdcEip712DomainName(chainId);
  if (domainRecord.name !== expectedDomainName) {
    throw new Error(
      `x402 typedData.domain.name must be ${expectedDomainName}.`,
    );
  }
  return {
    chainId,
    name: domainRecord.name,
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
  config: Pick<LocalSignerConfig, "usdcAddress" | "usdcAddressesByChain">,
  chainId: number,
): Address | undefined {
  return (
    config.usdcAddressesByChain?.[chainId] ??
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

function resolveConfiguredFeedbackBonusEscrowAddress(
  config: Pick<LocalSignerConfig, "feedbackBonusEscrowAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.feedbackBonusEscrowAddress ??
    getSharedDeploymentAddress(chainId, "FeedbackBonusEscrow")
  );
}

function resolveConfiguredLrepAddress(
  config: Pick<LocalSignerConfig, "lrepAddress">,
  chainId: number,
): Address | undefined {
  return (
    config.lrepAddress ?? getSharedDeploymentAddress(chainId, "LoopReputation")
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

function localQuestionParserOptions(
  options: { questionMetadataBaseUrl?: string } = {},
): X402QuestionParserOptions {
  return {
    ...buildDefaultX402QuestionParserOptions(),
    ...options,
  };
}

function parseLocalQuestionRequest(
  value: unknown,
  fallbackChainId?: number,
  options: { questionMetadataBaseUrl?: string } = {},
): LocalQuestionPayload {
  return parseSharedX402QuestionRequest(
    value,
    fallbackChainId,
    localQuestionParserOptions(options),
  ) as LocalQuestionPayload;
}

function toCanonicalLocalQuestionPayload(
  payload: LocalQuestionPayload,
  options: { questionMetadataBaseUrl?: string } = {},
) {
  return toSharedCanonicalQuestionPayload(
    payload,
    localQuestionParserOptions(options),
  );
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
  const parsed = parseLocalQuestionRequest(payload, fallbackChainId, options);
  return toSharedCanonicalQuestionPayload(
    parsed,
    localQuestionParserOptions(options),
  );
}

function buildLocalQuestionOperation(payload: LocalQuestionPayload) {
  const operation = buildSharedX402QuestionOperation(payload);
  return {
    canonicalPayload: operation.canonicalPayload,
    operationKey: operation.operationKey as Hex,
    payloadHash: operation.payloadHash,
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
  return buildDeterministicX402QuestionSalt(params);
}

function buildSubmissionMediaHash(
  imageUrls: readonly string[],
  videoUrl: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string[]" }, { type: "string" }],
      [[...new Set(imageUrls)].sort(), videoUrl],
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
        { type: "uint8" },
      ],
      [
        rewardTerms.asset,
        rewardTerms.amount,
        rewardTerms.requiredVoters,
        rewardTerms.bountyEligibility,
      ],
    ),
  );
}

function roundConfigAbiNumber(
  value: bigint,
  fieldName: string,
  maxValue: bigint,
): number {
  if (value >= 0n && value <= maxValue) return Number(value);
  throw new Error(`${fieldName} must be at most ${maxValue}.`);
}

function roundConfigAbiValues(roundConfig: LocalQuestionRoundConfig) {
  return {
    epochDuration: roundConfigAbiNumber(
      roundConfig.epochDuration,
      "question.roundConfig.epochDuration",
      X402_ROUND_CONFIG_UINT32_MAX,
    ),
    maxDuration: roundConfigAbiNumber(
      roundConfig.maxDuration,
      "question.roundConfig.maxDuration",
      X402_ROUND_CONFIG_UINT32_MAX,
    ),
    maxVoters: roundConfigAbiNumber(
      roundConfig.maxVoters,
      "question.roundConfig.maxVoters",
      X402_ROUND_CONFIG_UINT16_MAX,
    ),
    minVoters: roundConfigAbiNumber(
      roundConfig.minVoters,
      "question.roundConfig.minVoters",
      X402_ROUND_CONFIG_UINT16_MAX,
    ),
  };
}

function buildRoundConfigHash(roundConfig: LocalQuestionRoundConfig): Hex {
  const abiValues = roundConfigAbiValues(roundConfig);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        abiValues.epochDuration,
        abiValues.maxDuration,
        abiValues.minVoters,
        abiValues.maxVoters,
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
  const abiRoundConfig = roundConfigAbiValues(params.roundConfig);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint8" },
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
        params.rewardTerms.bountyEligibility,
        abiRoundConfig.epochDuration,
        abiRoundConfig.maxDuration,
        abiRoundConfig.minVoters,
        abiRoundConfig.maxVoters,
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
    asset: submissionRewardAssetId(payload.bounty.asset),
    bountyEligibility: payload.bounty.bountyEligibility,
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
    parsedPayload: payload,
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
  return buildSharedX402QuestionPaymentNonce(params);
}

function buildX402QuestionOneShotPaymentNonce(params: {
  chainId: number;
  contentRegistryAddress: Address;
  feedbackBonus: ExpectedLocalSignerFeedbackBonus;
  feedbackBonusEscrowAddress: Address;
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
  return buildSharedX402QuestionOneShotPaymentNonce(params);
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
    | typeof FeedbackBonusEscrowAbi
    | typeof LocalX402QuestionSubmitterAbi,
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
  const actualAsset = normalizeBigInt(
    readStructField(value, "asset", 0, fieldName),
    `${fieldName}.asset`,
  );
  if (actualAsset !== BigInt(expected.asset)) {
    throw new Error(
      `${fieldName}.asset must be ${submissionRewardAssetLabel(expected.asset)}.`,
    );
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
  assertEqualNumber(
    readStructField(value, "bountyEligibility", 3, fieldName),
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
    questionConfidentialityFlags(expected),
    `${fieldName}.flags`,
  );
}

function assertFeedbackBonusTerms(
  value: unknown,
  expected: ExpectedLocalSignerFeedbackBonus | null | undefined,
  fieldName: string,
) {
  if (!expected) {
    throw new Error(
      `${fieldName} requires a Feedback Bonus in the local signer ask payload.`,
    );
  }
  if (expected.asset !== "USDC") {
    throw new Error(
      `${fieldName}.asset must be USDC for one-shot x402 funding.`,
    );
  }
  assertEqualBigInt(
    readStructField(value, "amount", 0, fieldName),
    expected.amount,
    `${fieldName}.amount`,
  );
  assertEqualAddress(
    readStructField(value, "awarder", 1, fieldName),
    expected.awarder,
    `${fieldName}.awarder`,
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
      `transactionPlan.calls[${params.index}] approve amount must equal the expected amount.`,
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
  expectedFeedbackBonus?: ExpectedLocalSignerFeedbackBonus | null;
  expectedPaymentAuthorization: X402Authorization;
  expectedPlan: ExpectedLocalSignerQuestionPlan;
  feedbackBonusEscrowAddress?: Address;
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
    LocalX402QuestionSubmitterAbi,
    `transactionPlan.calls[${params.index}]`,
  );
  const oneShot =
    decoded.functionName === "submitQuestionWithX402OneShotPayment";
  if (decoded.functionName !== "submitQuestionWithX402Payment" && !oneShot) {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call submitQuestionWithX402Payment or submitQuestionWithX402OneShotPayment.`,
    );
  }
  if (oneShot && params.expectedFeedbackBonus?.asset !== "USDC") {
    throw new Error(
      `transactionPlan.calls[${params.index}] one-shot x402 submissions require a USDC Feedback Bonus in the local signer ask payload.`,
    );
  }
  if (!oneShot && params.expectedFeedbackBonus?.asset === "USDC") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call submitQuestionWithX402OneShotPayment for USDC Feedback Bonus funding.`,
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
  if (oneShot) {
    assertFeedbackBonusTerms(
      args[12],
      params.expectedFeedbackBonus,
      `transactionPlan.calls[${params.index}].feedbackBonusTerms`,
    );
  }
  const authorization = decoded.args?.[oneShot ? 13 : 12];
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
    ) !==
    params.expectedPlan.rewardTerms.amount +
      (oneShot ? params.expectedFeedbackBonus!.amount : 0n)
  ) {
    throw new Error(
      `transactionPlan.calls[${params.index}] x402 authorization.value must equal the requested payment amount.`,
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
  const expectedNonce = oneShot
    ? buildX402QuestionOneShotPaymentNonce({
        chainId: params.responseChainId,
        contentRegistryAddress: params.contentRegistryAddress,
        feedbackBonus: params.expectedFeedbackBonus!,
        feedbackBonusEscrowAddress: requireConfiguredAddress(
          params.feedbackBonusEscrowAddress,
          "FeedbackBonusEscrow",
        ),
        question: params.expectedPlan.primaryQuestion,
        questionRewardPoolEscrowAddress: params.questionRewardPoolEscrowAddress,
        rewardTerms: params.expectedPlan.rewardTerms,
        roundConfig: params.expectedPlan.roundConfig,
        x402Authorization: decodedAuthorization,
        x402QuestionSubmitterAddress: params.x402QuestionSubmitterAddress,
      })
    : buildX402QuestionPaymentNonce({
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
  expectedAsset: LocalSubmissionRewardAsset;
  expectedSpender: Address;
  expectedToken: Address;
}) {
  const payment = params.ask.payment;
  if (!payment) {
    throw new Error("RateLoop transaction plan is missing payment metadata.");
  }
  if (
    !payment.tokenAddress ||
    !sameAddress(
      normalizeAddress(payment.tokenAddress, "payment.tokenAddress"),
      params.expectedToken,
    )
  ) {
    throw new Error(
      `RateLoop transaction plan payment.tokenAddress must be the configured ${params.expectedAsset} token.`,
    );
  }
  if (payment.asset !== undefined && payment.asset !== params.expectedAsset) {
    throw new Error(
      `RateLoop transaction plan payment.asset must be ${params.expectedAsset}.`,
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
      "RateLoop transaction plan payment.amount must equal the requested payment amount.",
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
    throw new Error("RateLoop transaction plan is missing wallet calls.");
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
  const expectedFeedbackBonus = normalizeLocalSignerFeedbackBonus(
    params.expectedPayload,
    params.accountAddress,
  );
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
        "wallet_calls transaction plans must contain reserve, approve, and submit calls.",
      );
    }
    const escrowAddress = requireConfiguredAddress(
      resolveConfiguredQuestionRewardPoolEscrowAddress(
        params.config,
        responseChainId,
      ),
      "QuestionRewardPoolEscrow",
    );
    const expectedBountyAsset = submissionRewardAssetLabel(
      expectedPlan.rewardTerms.asset,
    );
    const rewardTokenAddress =
      expectedBountyAsset === "LREP"
        ? requireConfiguredAddress(
            resolveConfiguredLrepAddress(params.config, responseChainId),
            "LoopReputation",
          )
        : usdcAddress;
    validatePaymentMetadata({
      ask: params.ask,
      expectedAmount: params.expectedBountyAmount,
      expectedAsset: expectedBountyAsset,
      expectedSpender: escrowAddress,
      expectedToken: rewardTokenAddress,
    });
    validateReserveSubmissionCall({
      call: calls[0]!,
      contentRegistryAddress,
      expectedRevealCommitment: expectedPlan.revealCommitment,
      index: 0,
    });
    validateApproveCall({
      call: calls[1]!,
      expectedAmount: params.expectedBountyAmount,
      expectedPhase:
        expectedBountyAsset === "LREP" ? "approve_lrep" : "approve_usdc",
      expectedSpender: escrowAddress,
      expectedToken: rewardTokenAddress,
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
    if (expectedPlan.rewardTerms.asset !== X402_SUBMISSION_REWARD_ASSET_USDC) {
      throw new Error(
        "x402_authorization transaction plans require USDC bounties.",
      );
    }
    if (calls.length !== 1) {
      throw new Error(
        "x402_authorization transaction plans must contain exactly one submit call.",
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
    const feedbackBonusEscrowAddress =
      expectedFeedbackBonus?.asset === "USDC"
        ? requireConfiguredAddress(
            resolveConfiguredFeedbackBonusEscrowAddress(
              params.config,
              responseChainId,
            ),
            "FeedbackBonusEscrow",
          )
        : undefined;
    if (!params.expectedPaymentAuthorization?.signature) {
      throw new Error(
        "x402_authorization transaction plans require the exact signed local x402 authorization.",
      );
    }
    validatePaymentMetadata({
      ask: params.ask,
      expectedAmount:
        params.expectedBountyAmount +
        (expectedFeedbackBonus?.asset === "USDC"
          ? expectedFeedbackBonus.amount
          : 0n),
      expectedAsset: "USDC",
      expectedSpender: x402QuestionSubmitterAddress,
      expectedToken: usdcAddress,
    });
    validateSubmitX402QuestionCall({
      accountAddress: params.accountAddress,
      call: calls[0]!,
      contentRegistryAddress,
      expectedFeedbackBonus,
      expectedPaymentAuthorization: params.expectedPaymentAuthorization,
      expectedPlan,
      feedbackBonusEscrowAddress,
      index: 0,
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

function validateCreateFeedbackBonusPoolCall(params: {
  call: RateLoopAgentWalletTransactionCall;
  expectedFeedbackBonus: ExpectedLocalSignerFeedbackBonus;
  expectedPoolTarget: ExpectedLocalSignerFeedbackBonusPoolTarget;
  expectedTo: Address;
  index: number;
}) {
  const { data } = normalizeCallEnvelope({
    call: params.call,
    expectedPhase: "create_feedback_bonus_pool",
    expectedTo: params.expectedTo,
    index: params.index,
  });
  const decoded = decodedCall(
    data,
    FeedbackBonusEscrowAbi,
    `transactionPlan.calls[${params.index}]`,
  );
  if (decoded.functionName !== "createFeedbackBonusPoolWithAsset") {
    throw new Error(
      `transactionPlan.calls[${params.index}] must call createFeedbackBonusPoolWithAsset.`,
    );
  }
  const args = decoded.args ?? [];
  assertEqualBigInt(
    args[0],
    params.expectedPoolTarget.contentId,
    `transactionPlan.calls[${params.index}].contentId`,
  );
  assertEqualBigInt(
    args[1],
    params.expectedPoolTarget.roundId,
    `transactionPlan.calls[${params.index}].roundId`,
  );
  assertEqualNumber(
    args[2],
    params.expectedFeedbackBonus.assetId,
    `transactionPlan.calls[${params.index}].asset`,
  );
  assertEqualBigInt(
    args[3],
    params.expectedFeedbackBonus.amount,
    `transactionPlan.calls[${params.index}].amount`,
  );
  assertEqualBigInt(
    args[4],
    params.expectedPoolTarget.feedbackClosesAt,
    `transactionPlan.calls[${params.index}].feedbackClosesAt`,
  );
  assertEqualAddress(
    args[5],
    params.expectedFeedbackBonus.awarder,
    `transactionPlan.calls[${params.index}].awarder`,
  );
}

function readExpectedFeedbackBonusPoolTarget(
  feedbackBonus: QuestionStatusResponse["feedbackBonus"],
): ExpectedLocalSignerFeedbackBonusPoolTarget {
  const record = assertRecord(feedbackBonus, "feedbackBonus");
  return {
    contentId: normalizeRequiredPositiveBigInt(
      record.contentId,
      "feedbackBonus.contentId",
    ),
    feedbackClosesAt: normalizeRequiredPositiveBigInt(
      record.feedbackClosesAt,
      "feedbackBonus.feedbackClosesAt",
    ),
    roundId: normalizeRequiredPositiveBigInt(
      record.roundId,
      "feedbackBonus.roundId",
    ),
  };
}

function validateLocalSignerFeedbackBonusTransactionPlan(params: {
  ask: QuestionStatusResponse;
  config: TransactionPlanValidationConfig;
  expectedFeedbackBonus: ExpectedLocalSignerFeedbackBonus;
}): RateLoopAgentWalletTransactionCall[] {
  const feedbackBonus = params.ask.feedbackBonus;
  const expectedPoolTarget =
    readExpectedFeedbackBonusPoolTarget(feedbackBonus);
  const plan = feedbackBonus?.transactionPlan as
    | {
        calls?: RateLoopAgentWalletTransactionCall[];
        requiresOrderedExecution?: boolean;
      }
    | undefined;
  const calls = plan?.calls ?? [];
  if (calls.length !== 2) {
    throw new Error(
      "Feedback Bonus transaction plan must contain approve and create-pool calls.",
    );
  }
  if (plan?.requiresOrderedExecution !== true) {
    throw new Error(
      "Feedback Bonus transaction plans must require ordered execution.",
    );
  }
  const chainId = normalizeRequiredChainId(
    params.ask.chainId,
    "ask response chainId",
  );
  const escrowAddress = requireConfiguredAddress(
    resolveConfiguredFeedbackBonusEscrowAddress(params.config, chainId),
    "FeedbackBonusEscrow",
  );
  const tokenAddress =
    params.expectedFeedbackBonus.asset === "LREP"
      ? requireConfiguredAddress(
          resolveConfiguredLrepAddress(params.config, chainId),
          "LoopReputation",
        )
      : requireConfiguredAddress(
          resolveConfiguredUsdcAddress(params.config, chainId),
          "USDC token",
        );
  validateApproveCall({
    call: calls[0]!,
    expectedAmount: params.expectedFeedbackBonus.amount,
    expectedPhase:
      params.expectedFeedbackBonus.asset === "LREP"
        ? "approve_feedback_bonus_lrep"
        : "approve_feedback_bonus_usdc",
    expectedSpender: escrowAddress,
    expectedToken: tokenAddress,
    index: 0,
  });
  validateCreateFeedbackBonusPoolCall({
    call: calls[1]!,
    expectedFeedbackBonus: params.expectedFeedbackBonus,
    expectedPoolTarget,
    expectedTo: escrowAddress,
    index: 1,
  });
  return calls;
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
  assertSafeScryptParams(params);
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
  const usdcAddressOption = optionString(options, "usdc-address");
  const rpcUrlOption = optionString(options, "rpc-url");
  const rpcUrlEnv = envString(env, "RATELOOP_RPC_URL");

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
    rpcUrl: normalizeLocalSignerRpcUrl(
      rpcUrlOption ?? rpcUrlEnv,
      rpcUrlOption === undefined ? "RATELOOP_RPC_URL" : "--rpc-url",
    ),
    usdcAddress: usdcAddressOption
      ? parseOptionalAddress(usdcAddressOption, "usdc-address")
      : parseOptionalAddressAlias(
          envString(env, "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS"),
          "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS",
          envString(env, "RATELOOP_X402_USDC_ADDRESS"),
          "RATELOOP_X402_USDC_ADDRESS",
        ),
    usdcAddressesByChain: usdcAddressOption
      ? {}
      : parseChainScopedAddressAliases(
          env,
          "RATELOOP_LOCAL_SIGNER_USDC_ADDRESS",
          "RATELOOP_X402_USDC_ADDRESS",
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

function isReserveSubmissionCall(call: RateLoopAgentWalletTransactionCall) {
  return (
    call.functionName === "reserveSubmission" ||
    call.phase === "reserve_submission" ||
    call.id === "reserve-submission"
  );
}

function isReservationRevealCall(call: RateLoopAgentWalletTransactionCall) {
  return (
    call.phase === "submit_question" ||
    call.id === "submit-question" ||
    (typeof call.functionName === "string" &&
      call.functionName.startsWith("submitQuestion"))
  );
}

async function waitForLocalReservationRevealReady(params: {
  config: LocalSignerConfig;
  publicClient: Pick<ReturnType<typeof createPublicClient>, "getBlock">;
  receipt: TransactionReceipt;
}) {
  const reserveBlock = await params.publicClient.getBlock({
    blockNumber: params.receipt.blockNumber,
  });
  const revealReadyTimestamp =
    reserveBlock.timestamp + RESERVED_SUBMISSION_MIN_AGE_SECONDS;
  const pollMs = Math.max(50, params.config.pollingIntervalMs);
  const deadline = Date.now() + RESERVATION_REVEAL_READY_TIMEOUT_MS;

  for (;;) {
    const latestBlock = await params.publicClient.getBlock({
      blockTag: "latest",
    });
    if (latestBlock.timestamp >= revealReadyTimestamp) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        "Timed out waiting for the reserved submission reveal window.",
      );
    }
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, Math.min(pollMs, remainingMs)),
    );
  }
}

async function executeTransactionPlan(
  params: ExecuteLocalTransactionPlanParams,
): Promise<LocalTransactionExecutionSummary> {
  const chain = await resolveChain(params.config);
  const transport = http(params.config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: params.account,
    chain,
    transport,
  });
  const calls: LocalTransactionExecutionSummary["calls"] = [];
  let latestReservationReceipt: TransactionReceipt | null = null;

  for (const [index, call] of params.calls.entries()) {
    if (latestReservationReceipt && isReservationRevealCall(call)) {
      await waitForLocalReservationRevealReady({
        config: params.config,
        publicClient,
        receipt: latestReservationReceipt,
      });
      latestReservationReceipt = null;
    }

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
      plan: params.plan,
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
      plan: params.plan,
      receipt: summary,
      type: "transaction_confirmed",
    });
    if (receipt.status !== "success") {
      throw new Error(`transactionPlan.calls[${index}] reverted: ${hash}`);
    }
    if (isReserveSubmissionCall(call)) {
      latestReservationReceipt = receipt;
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
  agent: LocalSignerAgentClient;
  config: LocalSignerConfig;
  executeTransactionPlan?: LocalTransactionPlanExecutor;
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
  const paymentMode: string =
    typeof baseAsk.paymentMode === "string" ? baseAsk.paymentMode : "";
  assertProductionQuestionMetadataBaseUrlPinned(params.config);
  const maxPaymentCap = assertWithinMaxPaymentAmount(baseAsk);
  const expectedFeedbackBonus = normalizeLocalSignerFeedbackBonus(
    baseAsk,
    params.account.address,
  );
  const bountyAsset = normalizeSubmissionRewardAsset(baseAsk.bounty.asset);
  if (
    expectedFeedbackBonus &&
    (paymentMode === "x402_authorization" ||
      paymentMode === "eip3009_usdc_authorization") &&
    (bountyAsset !== "USDC" || expectedFeedbackBonus.asset !== "USDC")
  ) {
    throw new Error(
      "EIP-3009 authorization can only fund USDC bounties and USDC Feedback Bonuses.",
    );
  }
  const runTransactionPlan =
    params.executeTransactionPlan ?? executeTransactionPlan;

  const initialAsk = await params.agent.askHumans(baseAsk);
  params.onProgress?.({ response: initialAsk, type: "ask_submitted" });
  assertAskPaymentWithinCap(initialAsk, maxPaymentCap);

  let finalAsk = initialAsk;
  let signedX402Authorization = false;
  let signedPaymentAuthorization: X402Authorization | null = null;
  if (initialAsk.x402AuthorizationRequest) {
    if (
      bountyAsset !== "USDC" ||
      (expectedFeedbackBonus && expectedFeedbackBonus.asset !== "USDC")
    ) {
      throw new Error(
        "EIP-3009 authorization can only fund USDC bounties and USDC Feedback Bonuses.",
      );
    }
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
    const feedbackBonusEscrowAddress =
      expectedFeedbackBonus?.asset === "USDC"
        ? requireConfiguredAddress(
            resolveConfiguredFeedbackBonusEscrowAddress(
              params.config,
              baseAsk.chainId,
            ),
            "FeedbackBonusEscrow",
          )
        : undefined;
    const expectedPaymentAmount =
      normalizeBigInt(baseAsk.bounty.amount, "ask payload bounty.amount") +
      (expectedFeedbackBonus?.asset === "USDC"
        ? expectedFeedbackBonus.amount
        : 0n);
    const expectedNonce =
      expectedFeedbackBonus?.asset === "USDC"
        ? buildX402QuestionOneShotPaymentNonce({
            chainId: baseAsk.chainId,
            contentRegistryAddress,
            feedbackBonus: expectedFeedbackBonus,
            feedbackBonusEscrowAddress: requireConfiguredAddress(
              feedbackBonusEscrowAddress,
              "FeedbackBonusEscrow",
            ),
            question: expectedPlan.primaryQuestion,
            questionRewardPoolEscrowAddress,
            rewardTerms: expectedPlan.rewardTerms,
            roundConfig: expectedPlan.roundConfig,
            x402Authorization: pendingAuthorization,
            x402QuestionSubmitterAddress,
          })
        : buildX402QuestionPaymentNonce({
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
        expectedAmount: expectedPaymentAmount,
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

  assertAskPaymentWithinCap(finalAsk, maxPaymentCap);

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

  if (!finalAsk.operationKey) {
    throw new Error(
      "RateLoop returned a transaction plan without an operationKey.",
    );
  }

  const transactions = await runTransactionPlan({
    account: params.account,
    calls,
    config: params.config,
    onProgress: params.onProgress,
    plan: "ask",
  });
  const confirmRequest: ConfirmAskTransactionsRequest = {
    operationKey: finalAsk.operationKey,
    transactionHashes: transactions.transactionHashes,
  };
  const askConfirmed =
    await params.agent.confirmAskTransactions(confirmRequest);
  params.onProgress?.({
    plan: "ask",
    response: askConfirmed,
    type: "transactions_confirmed",
  });

  const feedbackBonusStatus =
    typeof askConfirmed.feedbackBonus?.status === "string"
      ? askConfirmed.feedbackBonus.status
      : "";
  if (expectedFeedbackBonus && !askConfirmed.feedbackBonus) {
    throw new Error(
      "RateLoop ask confirmation did not include the requested Feedback Bonus status.",
    );
  }
  let feedbackBonusTransactions: LocalTransactionExecutionSummary | undefined;
  let feedbackBonusConfirmed: QuestionStatusResponse | undefined;
  if (
    expectedFeedbackBonus &&
    feedbackBonusStatus === "awaiting_wallet_signature"
  ) {
    if (finalAsk.paymentMode !== "wallet_calls") {
      throw new Error(
        "Separate Feedback Bonus wallet plans are only supported for wallet-call asks.",
      );
    }
    if (!params.agent.confirmFeedbackBonusTransactions) {
      throw new Error(
        "RateLoop agent client cannot confirm Feedback Bonus transactions.",
      );
    }
    const feedbackBonusCalls = validateLocalSignerFeedbackBonusTransactionPlan({
      ask: askConfirmed,
      config: params.config,
      expectedFeedbackBonus,
    });
    feedbackBonusTransactions = await runTransactionPlan({
      account: params.account,
      calls: feedbackBonusCalls,
      config: params.config,
      onProgress: params.onProgress,
      plan: "feedback_bonus",
    });
    const confirmFeedbackBonusRequest: ConfirmAskTransactionsRequest = {
      operationKey: finalAsk.operationKey,
      transactionHashes: feedbackBonusTransactions.transactionHashes,
    };
    feedbackBonusConfirmed =
      await params.agent.confirmFeedbackBonusTransactions(
        confirmFeedbackBonusRequest,
      );
    params.onProgress?.({
      plan: "feedback_bonus",
      response: feedbackBonusConfirmed,
      type: "transactions_confirmed",
    });
  }

  return {
    askConfirmed,
    confirmed: askConfirmed,
    feedbackBonusConfirmed,
    feedbackBonusTransactions,
    finalAsk,
    initialAsk,
    signedX402Authorization,
    transactions,
    walletAddress: params.account.address,
  };
}
