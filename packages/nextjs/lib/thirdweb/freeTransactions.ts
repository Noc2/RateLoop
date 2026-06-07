import deployedContracts from "@rateloop/contracts/deployedContracts";
import { and, eq, sql } from "drizzle-orm";
import "server-only";
import {
  type Abi,
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  isHash,
  isHex,
  parseAbi,
  parseEventLogs,
  toHex,
} from "viem";
import { parseTags } from "~~/constants/categories";
import { getImageAttachmentSubmissionValidationError } from "~~/lib/attachments/imageAttachments";
import {
  MAX_SUBMISSION_IMAGE_URLS,
  isUploadedImageUrl,
  isYouTubeVideoUrl,
  normalizeSubmissionContextUrl,
  normalizeSubmissionMediaUrl,
} from "~~/lib/contentMedia";
import { db } from "~~/lib/db";
import { freeTransactionQuotas, freeTransactionReservations } from "~~/lib/db/schema";
import {
  getFreeTransactionLimit,
  getServerEnvironmentScope,
  getServerRpcOverrides,
  getServerTargetNetworkById,
} from "~~/lib/env/server";
import { findBlockedContentTags, getContentTitleValidationError } from "~~/lib/moderation/submissionValidation";
import { buildFreeTransactionOperationKey } from "~~/lib/thirdweb/freeTransactionOperation";
import { isFreeTransactionStoreUnavailableError } from "~~/lib/thirdweb/freeTransactionStoreFallback";
import { sanitizeExternalUrl } from "~~/utils/externalUrl";

type DeployedContractsMap = Record<
  number,
  Record<
    string,
    {
      address: Address;
      abi: Abi;
    }
  >
>;

type ThirdwebVerifierUserOp = {
  sender?: string;
  targets?: string[];
  gasLimit?: string;
  gasPrice?: string;
  data?: {
    targets?: string[];
    callDatas?: string[];
    values?: string[];
  };
};

type ThirdwebVerifierRequest = {
  clientId?: string;
  chainId?: number;
  userOp?: ThirdwebVerifierUserOp;
};

type FreeTransactionDbWrite = Pick<typeof db, "insert" | "select" | "update">;
type ResolveRaterIdentityKey = (address: `0x${string}`, chainId: number) => Promise<string | null>;
type CheckTransactionHashesSucceeded = (params: {
  chainId: number;
  transactionHashes: Hash[];
  walletAddress: `0x${string}`;
}) => Promise<boolean>;
type TransactionVerificationLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};
type TransactionVerificationClient = {
  getTransaction: (params: { hash: Hash }) => Promise<{ chainId: bigint | number; from: Address }>;
  getTransactionReceipt: (params: {
    hash: Hash;
  }) => Promise<{ logs: readonly TransactionVerificationLog[]; status: "reverted" | "success" }>;
};
type GetTransactionVerificationClient = (chainId: number) => Promise<TransactionVerificationClient | null>;

export type FreeTransactionAllowanceSummary = {
  chainId: number;
  environment: string;
  limit: number;
  used: number;
  remaining: number;
  verified: boolean;
  exhausted: boolean;
  walletAddress: `0x${string}` | null;
  raterIdentityKey: string | null;
  /** @deprecated use raterIdentityKey */
  voterIdTokenId: string | null;
};

export type FreeTransactionAllowanceDecision =
  | {
      isAllowed: true;
      summary: FreeTransactionAllowanceSummary;
      debugCode?: string;
    }
  | {
      isAllowed: false;
      reason: string;
      summary?: FreeTransactionAllowanceSummary;
      debugCode:
        | "invalid_chain"
        | "invalid_sender"
        | "invalid_targets"
        | "target_not_allowlisted"
        | "unsupported_operation"
        | "invalid_operation_key"
        | "missing_rater_identity"
        | "free_tx_exhausted"
        | "quota_store_unavailable";
    };

const DEFAULT_DENY_REASON = "Transaction not sponsored.";
const FREE_TX_EXHAUSTED_REASON = "Free transactions used up. Add ETH to continue.";
const NO_RATER_IDENTITY_REASON = "Verify your ID to unlock free transactions.";
const MAX_CONTENT_TAGS_LENGTH = 256;
const FREE_TRANSACTION_RESERVATION_TTL_MS = 5 * 60_000;
const FREE_TRANSACTION_IDEMPOTENCY_WINDOW_MS = 2 * 60_000;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}`;
const USER_OPERATION_RECEIPT_EVENT_ABI = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
const EXECUTED_RECEIPT_EVENT_ABI = parseAbi([
  "event Executed(address indexed user, address indexed signer, address indexed executor, uint256 batchSize)",
]);
const CONTENT_REGISTRY_SUBMISSION_ABI = [
  {
    type: "function",
    name: "cancelReservedSubmission",
    inputs: [{ name: "revealCommitment", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reserveSubmission",
    inputs: [{ name: "revealCommitment", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestion",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
      },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestionWithRewardAndRoundConfig",
    inputs: [
      { name: "contextUrl", type: "string" },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
      { name: "title", type: "string" },
      { name: "tags", type: "string" },
      { name: "categoryId", type: "uint256" },
      {
        name: "details",
        type: "tuple",
        components: [
          { name: "detailsUrl", type: "string" },
          { name: "detailsHash", type: "bytes32" },
        ],
      },
      { name: "salt", type: "bytes32" },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyStartBy", type: "uint256" },
          { name: "bountyWindowSeconds", type: "uint256" },
          { name: "feedbackWindowSeconds", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
      {
        name: "spec",
        type: "tuple",
        components: [
          { name: "questionMetadataHash", type: "bytes32" },
          { name: "resultSpecHash", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitQuestionBundleWithRewardAndRoundConfig",
    inputs: [
      {
        name: "questions",
        type: "tuple[]",
        components: [
          { name: "contextUrl", type: "string" },
          { name: "imageUrls", type: "string[]" },
          { name: "videoUrl", type: "string" },
          { name: "title", type: "string" },
          { name: "tags", type: "string" },
          { name: "categoryId", type: "uint256" },
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "detailsUrl", type: "string" },
              { name: "detailsHash", type: "bytes32" },
            ],
          },
          { name: "salt", type: "bytes32" },
          {
            name: "spec",
            type: "tuple",
            components: [
              { name: "questionMetadataHash", type: "bytes32" },
              { name: "resultSpecHash", type: "bytes32" },
            ],
          },
        ],
      },
      {
        name: "rewardTerms",
        type: "tuple",
        components: [
          { name: "asset", type: "uint8" },
          { name: "amount", type: "uint256" },
          { name: "requiredVoters", type: "uint256" },
          { name: "requiredSettledRounds", type: "uint256" },
          { name: "bountyStartBy", type: "uint256" },
          { name: "bountyWindowSeconds", type: "uint256" },
          { name: "feedbackWindowSeconds", type: "uint256" },
          { name: "bountyEligibility", type: "uint8" },
        ],
      },
      {
        name: "roundConfig",
        type: "tuple",
        components: [
          { name: "epochDuration", type: "uint32" },
          { name: "maxDuration", type: "uint32" },
          { name: "minVoters", type: "uint16" },
          { name: "maxVoters", type: "uint16" },
        ],
      },
    ],
    outputs: [
      { name: "bundleId", type: "uint256" },
      { name: "contentIds", type: "uint256[]" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

let ensureFreeTransactionQuotaTablePromise: Promise<void> | null = null;
let freeTransactionTestOverrides: {
  resolveRaterIdentityKey?: ResolveRaterIdentityKey;
  allTransactionHashesSucceeded?: CheckTransactionHashesSucceeded;
  getTransactionVerificationClient?: GetTransactionVerificationClient;
} | null = null;

function getContractsForChain(chainId: number) {
  return (deployedContracts as unknown as Partial<DeployedContractsMap>)[chainId];
}

function buildIdentityKey(params: { chainId: number; environment: string; raterIdentityKey: string }) {
  return `${params.environment}:${params.chainId}:${params.raterIdentityKey}`;
}

function normalizeAddress(value: string): `0x${string}` {
  return getAddress(value) as `0x${string}`;
}

function getTimestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function isCallableAbi(abi: Abi) {
  return abi.some(entry => entry.type === "function");
}

function getContractsByAddress(chainId: number): Map<string, { name: string; address: Address; abi: Abi }> {
  const contracts = getContractsForChain(chainId);
  if (!contracts) {
    return new Map();
  }

  return new Map(
    Object.entries(contracts)
      .filter(([name, contract]) => !name.endsWith("Lib") && isCallableAbi(contract.abi))
      .map(([name, contract]) => [
        contract.address.toLowerCase(),
        { name, address: contract.address, abi: contract.abi },
      ]),
  );
}

function decodeContentRegistryCallData(data: Hex) {
  return decodeFunctionData({
    abi: CONTENT_REGISTRY_SUBMISSION_ABI,
    data,
  }) as { functionName: string; args: readonly unknown[] | undefined };
}

function stripAppendedPermitSuffix(data: Hex): Hex | null {
  const permitSuffixHexLength = 128 * 2;
  if (data.length <= 2 + permitSuffixHexLength) {
    return null;
  }
  return `0x${data.slice(2, -permitSuffixHexLength)}`;
}

function getRpcUrl(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  if (!network) {
    return null;
  }

  const rpcOverrides = getServerRpcOverrides();
  return rpcOverrides[chainId] ?? network.rpcUrls.default.http[0] ?? null;
}

async function getPublicClientForChain(chainId: number) {
  const network = getServerTargetNetworkById(chainId);
  const rpcUrl = getRpcUrl(chainId);

  if (!network || !rpcUrl) {
    return null;
  }

  return createPublicClient({
    chain: network,
    transport: http(rpcUrl),
  });
}

async function getTransactionVerificationClient(chainId: number): Promise<TransactionVerificationClient | null> {
  if (freeTransactionTestOverrides?.getTransactionVerificationClient) {
    return freeTransactionTestOverrides.getTransactionVerificationClient(chainId);
  }

  const client = await getPublicClientForChain(chainId);
  if (!client) {
    return null;
  }

  return {
    getTransaction: async params => {
      const transaction = await client.getTransaction(params);
      const transactionChainId = "chainId" in transaction ? transaction.chainId : undefined;

      return {
        chainId:
          typeof transactionChainId === "bigint" || typeof transactionChainId === "number"
            ? transactionChainId
            : Number.NaN,
        from: transaction.from,
      };
    },
    getTransactionReceipt: params => client.getTransactionReceipt(params),
  };
}

async function resolveRaterIdentityKey(address: `0x${string}`, chainId: number) {
  const client = await getPublicClientForChain(chainId);
  const contracts = getContractsForChain(chainId);
  const raterRegistry = contracts?.RaterRegistry;

  if (!client || !raterRegistry) {
    return null;
  }

  const resolvedRater = await client
    .readContract({
      address: raterRegistry.address,
      abi: raterRegistry.abi,
      functionName: "resolveRater",
      args: [address],
    })
    .catch(() => null);

  if (!resolvedRater) {
    return null;
  }

  const resolved = resolvedRater as
    | { identityKey?: `0x${string}`; hasActiveHumanCredential?: boolean }
    | readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean];
  const identityKey = Array.isArray(resolved)
    ? (resolved as readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean])[1]
    : (resolved as { identityKey?: `0x${string}` }).identityKey;
  const hasActiveHumanCredential = Array.isArray(resolved)
    ? (resolved as readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean])[3]
    : (resolved as { hasActiveHumanCredential?: boolean }).hasActiveHumanCredential;

  if (
    !hasActiveHumanCredential ||
    !identityKey ||
    !/^0x[0-9a-fA-F]{64}$/.test(identityKey) ||
    /^0x0{64}$/.test(identityKey)
  ) {
    return null;
  }

  return identityKey.toLowerCase();
}

async function ensureQuotaRow(
  database: FreeTransactionDbWrite,
  params: {
    chainId: number;
    environment: string;
    raterIdentityKey: string;
    walletAddress: `0x${string}`;
  },
) {
  const now = new Date();
  const freeTxLimit = getFreeTransactionLimit();
  const identityKey = buildIdentityKey(params);

  await database
    .insert(freeTransactionQuotas)
    .values({
      identityKey,
      voterIdTokenId: params.raterIdentityKey,
      chainId: params.chainId,
      environment: params.environment,
      lastWalletAddress: params.walletAddress,
      freeTxLimit,
      freeTxUsed: 0,
      exhaustedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  return identityKey;
}

function buildQuotaSummary(params: {
  chainId: number;
  environment: string;
  freeTxLimit: number;
  freeTxUsed: number;
  pendingReservations?: number;
  raterIdentityKey: string;
  walletAddress: `0x${string}`;
}) {
  const used = params.freeTxUsed + (params.pendingReservations ?? 0);

  return {
    chainId: params.chainId,
    environment: params.environment,
    limit: params.freeTxLimit,
    used,
    remaining: Math.max(params.freeTxLimit - used, 0),
    verified: true,
    exhausted: used >= params.freeTxLimit,
    walletAddress: params.walletAddress,
    raterIdentityKey: params.raterIdentityKey,
    voterIdTokenId: params.raterIdentityKey,
  } satisfies FreeTransactionAllowanceSummary;
}

function normalizeQuotaRow(
  row:
    | {
        chainId?: number | string | null;
        chain_id?: number | string | null;
        chainid?: number | string | null;
        environment?: string | null;
        freeTxLimit?: number | string | null;
        free_tx_limit?: number | string | null;
        freetxlimit?: number | string | null;
        freeTxUsed?: number | string | null;
        free_tx_used?: number | string | null;
        freetxused?: number | string | null;
        raterIdentityKey?: string | null;
        voter_id_token_id?: string | null;
        voteridtokenid?: string | null;
      }
    | null
    | undefined,
) {
  if (!row) {
    return null;
  }

  return {
    chainId: Number(row.chainId ?? row.chain_id ?? row.chainid),
    environment: row.environment ?? "",
    freeTxLimit: Number(row.freeTxLimit ?? row.free_tx_limit ?? row.freetxlimit),
    freeTxUsed: Number(row.freeTxUsed ?? row.free_tx_used ?? row.freetxused),
    raterIdentityKey: row.raterIdentityKey ?? row.voter_id_token_id ?? row.voteridtokenid ?? "",
  };
}

function normalizeReservationRow(
  row:
    | {
        chainId?: number | string | null;
        chain_id?: number | string | null;
        chainid?: number | string | null;
        walletAddress?: string | null;
        wallet_address?: string | null;
        walletaddress?: string | null;
        status?: string | null;
        confirmedAt?: Date | string | null;
        confirmed_at?: Date | string | null;
        confirmedat?: Date | string | null;
        expiresAt?: Date | string | null;
        expires_at?: Date | string | null;
        expiresat?: Date | string | null;
      }
    | null
    | undefined,
) {
  if (!row) {
    return null;
  }

  return {
    chainId: Number(row.chainId ?? row.chain_id ?? row.chainid),
    walletAddress: row.walletAddress ?? row.wallet_address ?? row.walletaddress ?? "",
    status: row.status ?? "",
    confirmedAt: row.confirmedAt ?? row.confirmed_at ?? row.confirmedat ?? null,
    expiresAt: row.expiresAt ?? row.expires_at ?? row.expiresat ?? null,
  };
}

async function readQuotaSummary(params: {
  chainId: number;
  environment: string;
  raterIdentityKey: string;
  walletAddress: `0x${string}`;
}) {
  const identityKey = await ensureQuotaRow(db, params);
  const now = new Date();
  const [row] = await db
    .select()
    .from(freeTransactionQuotas)
    .where(eq(freeTransactionQuotas.identityKey, identityKey))
    .limit(1);

  if (!row) {
    return null;
  }

  const quotaRow = normalizeQuotaRow(row);
  if (!quotaRow) {
    return null;
  }

  const pendingReservations = await getActivePendingReservationCount(db, {
    identityKey,
    now,
  });

  return buildQuotaSummary({
    chainId: quotaRow.chainId,
    environment: quotaRow.environment,
    freeTxLimit: quotaRow.freeTxLimit,
    freeTxUsed: quotaRow.freeTxUsed,
    pendingReservations,
    raterIdentityKey: quotaRow.raterIdentityKey,
    walletAddress: params.walletAddress,
  });
}

export function __setFreeTransactionTestOverridesForTests(
  overrides: {
    resolveRaterIdentityKey?: ResolveRaterIdentityKey;
    allTransactionHashesSucceeded?: CheckTransactionHashesSucceeded;
    getTransactionVerificationClient?: GetTransactionVerificationClient;
  } | null,
) {
  freeTransactionTestOverrides = overrides;
}

function buildUnverifiedSummary(params: { chainId: number; walletAddress: `0x${string}` | null }) {
  const limit = getFreeTransactionLimit();

  return {
    chainId: params.chainId,
    environment: getServerEnvironmentScope(),
    limit,
    used: 0,
    remaining: 0,
    verified: false,
    exhausted: false,
    walletAddress: params.walletAddress,
    raterIdentityKey: null,
    voterIdTokenId: null,
  } satisfies FreeTransactionAllowanceSummary;
}

type NormalizedVerifierCall = {
  data: Hex;
  to: `0x${string}`;
  value: Hex;
};

function normalizeCallValue(value: string | undefined): Hex | null {
  if (value === undefined) {
    return "0x0";
  }

  if (isHex(value)) {
    return toHex(BigInt(value));
  }

  if (/^\d+$/.test(value)) {
    return toHex(BigInt(value));
  }

  return null;
}

function extractOperationCalls(body: ThirdwebVerifierRequest): NormalizedVerifierCall[] | null {
  const targets = body.userOp?.data?.targets ?? body.userOp?.targets ?? [];
  const callDatas = body.userOp?.data?.callDatas;
  const values = body.userOp?.data?.values;

  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !Array.isArray(callDatas) ||
    callDatas.length !== targets.length
  ) {
    return null;
  }

  if (values && values.length !== targets.length) {
    return null;
  }

  const calls: NormalizedVerifierCall[] = [];
  for (const [index, target] of targets.entries()) {
    const callData = callDatas[index];
    const value = normalizeCallValue(values?.[index]);

    if (!isAddress(target) || !isHex(callData) || !value) {
      return null;
    }

    calls.push({
      data: callData,
      to: normalizeAddress(target),
      value,
    });
  }

  return calls;
}

function extractOperationKey(body: ThirdwebVerifierRequest, calls: readonly NormalizedVerifierCall[]): Hash | null {
  const sender = body.userOp?.sender;
  if (!sender || !body.chainId || calls.length === 0) {
    return null;
  }

  return buildFreeTransactionOperationKey({
    chainId: body.chainId,
    calls,
    sender,
  });
}

function isZeroCallValue(value: Hex) {
  return BigInt(value) === 0n;
}

function normalizeAddressArg(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !isAddress(value)) {
    return null;
  }

  return normalizeAddress(value);
}

type SponsoredSubmissionQuestion = {
  contextUrl: string;
  detailsHash: string;
  detailsUrl: string;
  imageUrls: string[];
  tags: string;
  title: string;
  videoUrl: string;
};

function getTupleField(value: unknown, key: string, index: number) {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object") return (value as Record<string, unknown>)[key];
  return undefined;
}

function readStringField(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readStringArrayField(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? (value as string[]) : null;
}

function readSubmissionDetailsField(value: unknown): { detailsHash: string; detailsUrl: string } | null {
  const detailsUrl = readStringField(getTupleField(value, "detailsUrl", 0));
  const detailsHash = readStringField(getTupleField(value, "detailsHash", 1));
  if (detailsUrl === null || detailsHash === null) {
    return null;
  }

  return { detailsHash, detailsUrl };
}

function readSponsoredSubmissionQuestionFromArgs(args: readonly unknown[]): SponsoredSubmissionQuestion | null {
  const contextUrl = readStringField(args[0]);
  const imageUrls = readStringArrayField(args[1]);
  const videoUrl = readStringField(args[2]);
  const title = readStringField(args[3]);
  const tags = readStringField(args[4]);
  const details = readSubmissionDetailsField(args[6]);

  if (
    contextUrl === null ||
    imageUrls === null ||
    videoUrl === null ||
    title === null ||
    tags === null ||
    details === null
  ) {
    return null;
  }

  return {
    contextUrl,
    detailsHash: details.detailsHash,
    detailsUrl: details.detailsUrl,
    imageUrls,
    tags,
    title,
    videoUrl,
  };
}

function readSponsoredSubmissionQuestionFromTuple(value: unknown): SponsoredSubmissionQuestion | null {
  const contextUrl = readStringField(getTupleField(value, "contextUrl", 0));
  const imageUrls = readStringArrayField(getTupleField(value, "imageUrls", 1));
  const videoUrl = readStringField(getTupleField(value, "videoUrl", 2));
  const title = readStringField(getTupleField(value, "title", 3));
  const tags = readStringField(getTupleField(value, "tags", 4));
  const details = readSubmissionDetailsField(getTupleField(value, "details", 6));

  if (
    contextUrl === null ||
    imageUrls === null ||
    videoUrl === null ||
    title === null ||
    tags === null ||
    details === null
  ) {
    return null;
  }

  return {
    contextUrl,
    detailsHash: details.detailsHash,
    detailsUrl: details.detailsUrl,
    imageUrls,
    tags,
    title,
    videoUrl,
  };
}

function hasCanonicalContextUrl(value: string) {
  if (!value) return true;
  return normalizeSubmissionContextUrl(value) === value;
}

function hasCanonicalDetails(detailsUrl: string, detailsHash: string) {
  const hasDetailsUrl = Boolean(detailsUrl);
  const hasDetailsHash = detailsHash !== EMPTY_DETAILS_HASH;

  if (!/^0x[a-fA-F0-9]{64}$/.test(detailsHash)) return false;
  if (hasDetailsUrl !== hasDetailsHash) return false;
  if (!hasDetailsUrl) return true;
  return detailsUrl.trim() === detailsUrl && sanitizeExternalUrl(detailsUrl) === detailsUrl;
}

function hasCanonicalVideoUrl(value: string) {
  if (!value) return true;
  const normalized = normalizeSubmissionMediaUrl(value);
  return normalized === value && isYouTubeVideoUrl(normalized);
}

function hasCanonicalUploadedImageUrls(imageUrls: readonly string[]) {
  if (imageUrls.length > MAX_SUBMISSION_IMAGE_URLS) return false;

  return imageUrls.every(url => {
    const normalized = normalizeSubmissionMediaUrl(url);
    return normalized === url && isUploadedImageUrl(normalized);
  });
}

async function validateSponsoredSubmissionQuestion(
  question: SponsoredSubmissionQuestion,
  walletAddress: `0x${string}`,
) {
  const title = question.title.trim();
  const tags = question.tags.trim();

  if (!title || title !== question.title) return false;
  if (!tags || tags !== question.tags || tags.length > MAX_CONTENT_TAGS_LENGTH) return false;
  if (question.contextUrl.trim() !== question.contextUrl || question.videoUrl.trim() !== question.videoUrl)
    return false;
  if (!hasCanonicalContextUrl(question.contextUrl) || !hasCanonicalVideoUrl(question.videoUrl)) return false;
  if (!hasCanonicalDetails(question.detailsUrl, question.detailsHash)) return false;
  if (question.videoUrl && question.imageUrls.length > 0) return false;
  if (!question.contextUrl && question.imageUrls.length === 0 && !question.videoUrl) return false;
  if (!hasCanonicalUploadedImageUrls(question.imageUrls)) return false;
  if (getContentTitleValidationError(title)) return false;

  const parsedTags = parseTags(tags);
  if (parsedTags.length === 0 || parsedTags.length > 3 || findBlockedContentTags(parsedTags).length > 0) {
    return false;
  }

  const imageValidationError = await getImageAttachmentSubmissionValidationError({
    imageUrls: question.imageUrls,
    ownerWalletAddress: walletAddress,
  });
  if (imageValidationError) return false;

  return true;
}

async function validateSponsoredContentRegistryCall(
  functionName: string,
  args: readonly unknown[],
  walletAddress: `0x${string}`,
) {
  if (functionName === "cancelReservedSubmission" || functionName === "reserveSubmission") {
    return true;
  }

  if (functionName === "submitQuestion" || functionName === "submitQuestionWithRewardAndRoundConfig") {
    const question = readSponsoredSubmissionQuestionFromArgs(args);
    return question ? validateSponsoredSubmissionQuestion(question, walletAddress) : false;
  }

  if (functionName === "submitQuestionBundleWithRewardAndRoundConfig") {
    const questions = args[0];
    if (!Array.isArray(questions) || questions.length === 0) return false;

    for (const value of questions) {
      const question = readSponsoredSubmissionQuestionFromTuple(value);
      if (!question || !(await validateSponsoredSubmissionQuestion(question, walletAddress))) {
        return false;
      }
    }

    return true;
  }

  return false;
}

async function validateSponsoredCalls(
  chainId: number,
  calls: readonly NormalizedVerifierCall[],
  walletAddress: `0x${string}`,
): Promise<{ ok: true } | { ok: false; debugCode: "target_not_allowlisted" | "unsupported_operation" }> {
  const contracts = getContractsForChain(chainId);
  const contractsByAddress = getContractsByAddress(chainId);
  const frontendRegistry = contracts?.FrontendRegistry;
  const rewardEscrow = contracts?.QuestionRewardPoolEscrow;
  const votingEngine = contracts?.RoundVotingEngine;
  const allowedApproveSpenders = new Set(
    [frontendRegistry?.address, rewardEscrow?.address, votingEngine?.address]
      .filter((value): value is Address => Boolean(value))
      .map(value => value.toLowerCase()),
  );
  const allowedApproveTokenNames = new Set(["LoopReputation", "MockERC20"]);

  for (const call of calls) {
    if (!isZeroCallValue(call.value)) {
      return { ok: false, debugCode: "unsupported_operation" };
    }

    const contract = contractsByAddress.get(call.to.toLowerCase());
    if (!contract) {
      return { ok: false, debugCode: "target_not_allowlisted" };
    }

    let decoded: { functionName: string; args: readonly unknown[] | undefined };
    try {
      decoded = decodeFunctionData({
        abi: contract.abi,
        data: call.data,
      }) as { functionName: string; args: readonly unknown[] | undefined };
    } catch {
      if (contract.name === "RoundVotingEngine") {
        const commitVoteData = stripAppendedPermitSuffix(call.data);
        if (!commitVoteData) {
          return { ok: false, debugCode: "unsupported_operation" };
        }
        try {
          decoded = decodeFunctionData({
            abi: contract.abi,
            data: commitVoteData,
          }) as { functionName: string; args: readonly unknown[] | undefined };
        } catch {
          return { ok: false, debugCode: "unsupported_operation" };
        }
      } else if (contract.name === "ContentRegistry") {
        try {
          decoded = decodeContentRegistryCallData(call.data);
        } catch {
          return { ok: false, debugCode: "unsupported_operation" };
        }
      } else {
        return { ok: false, debugCode: "unsupported_operation" };
      }
    }

    const args = decoded.args ?? [];
    const functionName = decoded.functionName;
    if (functionName === "approve") {
      const spender = normalizeAddressArg(args[0]);
      if (allowedApproveTokenNames.has(contract.name) && spender && allowedApproveSpenders.has(spender.toLowerCase())) {
        continue;
      }
    }

    switch (contract.name) {
      case "LoopReputation":
        return { ok: false, debugCode: "unsupported_operation" };
      case "ContentRegistry":
        if (await validateSponsoredContentRegistryCall(functionName, args, walletAddress)) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "FrontendRegistry":
        if (
          functionName === "register" ||
          functionName === "requestDeregister" ||
          functionName === "completeDeregister" ||
          functionName === "claimFees" ||
          functionName === "setSnapshotProposer" ||
          functionName === "clearSnapshotProposer"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "ProfileRegistry":
        if (
          functionName === "setProfile" ||
          functionName === "setAvatarAccent" ||
          functionName === "clearAvatarAccent"
        ) {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RaterRegistry":
        if (functionName === "setProfile") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RoundVotingEngine":
        if (functionName === "claimCancelledRoundRefund" || functionName === "commitVote") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "AdvisoryVoteRecorder":
        if (functionName === "recordAdvisoryVote") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "RoundRewardDistributor":
        if (functionName === "claimFrontendFee" || functionName === "claimReward") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      case "QuestionRewardPoolEscrow":
        if (functionName === "claimQuestionReward" || functionName === "claimQuestionBundleReward") {
          continue;
        }
        return { ok: false, debugCode: "unsupported_operation" };
      default:
        return { ok: false, debugCode: "target_not_allowlisted" };
    }
  }

  return { ok: true };
}

async function getActivePendingReservationCount(
  database: FreeTransactionDbWrite,
  params: { identityKey: string; now: Date },
) {
  const [row] = await database
    .select({
      pendingCount: sql<number>`count(*)`,
    })
    .from(freeTransactionReservations)
    .where(
      and(
        eq(freeTransactionReservations.identityKey, params.identityKey),
        eq(freeTransactionReservations.status, "pending"),
        sql`${freeTransactionReservations.expiresAt} > ${params.now}`,
      ),
    )
    .limit(1);

  return Number(row?.pendingCount ?? 0);
}

function logsIncludeWalletUserOperationSender(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  const normalizedWalletAddress = params.walletAddress.toLowerCase();

  return parseEventLogs({
    abi: USER_OPERATION_RECEIPT_EVENT_ABI,
    logs: normalizeReceiptLogsForEventParsing(params.logs),
    strict: false,
  }).some(event => {
    const sender = event.args.sender;
    return typeof sender === "string" && sender.toLowerCase() === normalizedWalletAddress;
  });
}

function logsIncludeWalletExecutedEvent(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  const normalizedWalletAddress = params.walletAddress.toLowerCase();

  return parseEventLogs({
    abi: EXECUTED_RECEIPT_EVENT_ABI,
    logs: normalizeReceiptLogsForEventParsing(params.logs),
    strict: false,
  }).some(event => {
    const user = event.args.user;
    return typeof user === "string" && user.toLowerCase() === normalizedWalletAddress;
  });
}

function logsIncludeWalletExecutionProof(params: {
  logs: readonly TransactionVerificationLog[];
  walletAddress: `0x${string}`;
}) {
  return logsIncludeWalletUserOperationSender(params) || logsIncludeWalletExecutedEvent(params);
}

function normalizeReceiptLogsForEventParsing(logs: readonly TransactionVerificationLog[]) {
  return logs.map(log => ({
    ...log,
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    removed: false,
    topics: [...log.topics],
    transactionHash: null,
    transactionIndex: null,
  })) as Parameters<typeof parseEventLogs>[0]["logs"];
}

async function allTransactionHashesSucceeded(params: {
  chainId: number;
  transactionHashes: Hash[];
  walletAddress: `0x${string}`;
}) {
  const client = await getTransactionVerificationClient(params.chainId);
  if (!client || params.transactionHashes.length === 0) {
    return false;
  }

  const receipts = await Promise.all(
    params.transactionHashes.map(async hash => {
      try {
        const [receipt, transaction] = await Promise.all([
          client.getTransactionReceipt({ hash }),
          client.getTransaction({ hash }),
        ]);

        return {
          ok: receipt.status === "success" && Number(transaction.chainId) === params.chainId,
          from: transaction.from.toLowerCase(),
          matchesWallet:
            transaction.from.toLowerCase() === params.walletAddress.toLowerCase() ||
            logsIncludeWalletExecutionProof({
              logs: receipt.logs,
              walletAddress: params.walletAddress,
            }),
        };
      } catch {
        return { matchesWallet: false, ok: false };
      }
    }),
  );

  const hasWalletMismatch = receipts.some(receipt => receipt.ok && !receipt.matchesWallet);
  if (hasWalletMismatch) {
    console.warn("[thirdweb-free-tx] rejected sponsored transaction without wallet execution proof", {
      chainId: params.chainId,
      transactionHashes: params.transactionHashes,
      walletAddress: params.walletAddress,
    });
    return false;
  }

  return receipts.every(receipt => receipt.ok && receipt.matchesWallet);
}

export async function ensureFreeTransactionQuotaTable() {
  if (!ensureFreeTransactionQuotaTablePromise) {
    ensureFreeTransactionQuotaTablePromise = Promise.resolve();
  }

  await ensureFreeTransactionQuotaTablePromise;
}

export async function getFreeTransactionAllowanceSummary(params: { address: string; chainId: number }) {
  await ensureFreeTransactionQuotaTable();

  if (!isAddress(params.address)) {
    throw new Error("Invalid address");
  }

  const walletAddress = normalizeAddress(params.address);
  const raterIdentityKey = await (freeTransactionTestOverrides?.resolveRaterIdentityKey ?? resolveRaterIdentityKey)(
    walletAddress,
    params.chainId,
  );

  if (!raterIdentityKey) {
    return buildUnverifiedSummary({
      chainId: params.chainId,
      walletAddress,
    });
  }

  try {
    const summary = await readQuotaSummary({
      chainId: params.chainId,
      environment: getServerEnvironmentScope(),
      raterIdentityKey,
      walletAddress,
    });

    if (!summary) {
      throw new Error("Failed to read free transaction quota summary.");
    }

    return summary;
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during summary lookup; using self-funded fallback.", {
        address: walletAddress,
        chainId: params.chainId,
        raterIdentityKey,
      });
    }

    throw error;
  }
}

export async function evaluateFreeTransactionAllowance(
  body: ThirdwebVerifierRequest,
): Promise<FreeTransactionAllowanceDecision> {
  await ensureFreeTransactionQuotaTable();

  if (typeof body.chainId !== "number") {
    return {
      isAllowed: false,
      debugCode: "invalid_chain",
      reason: DEFAULT_DENY_REASON,
    };
  }

  const sender = body.userOp?.sender;
  if (!sender || !isAddress(sender)) {
    return {
      isAllowed: false,
      debugCode: "invalid_sender",
      reason: DEFAULT_DENY_REASON,
    };
  }

  const calls = extractOperationCalls(body);
  if (!calls || calls.length === 0) {
    return {
      isAllowed: false,
      debugCode: "invalid_targets",
      reason: DEFAULT_DENY_REASON,
    };
  }

  const walletAddress = normalizeAddress(sender);
  const validatedCalls = await validateSponsoredCalls(body.chainId, calls, walletAddress);
  if (!validatedCalls.ok) {
    return {
      isAllowed: false,
      debugCode: validatedCalls.debugCode,
      reason: DEFAULT_DENY_REASON,
    };
  }

  const operationKey = extractOperationKey(body, calls);
  if (!operationKey) {
    return {
      isAllowed: false,
      debugCode: "invalid_operation_key",
      reason: DEFAULT_DENY_REASON,
    };
  }

  const raterIdentityKey = await (freeTransactionTestOverrides?.resolveRaterIdentityKey ?? resolveRaterIdentityKey)(
    walletAddress,
    body.chainId,
  );

  if (!raterIdentityKey) {
    return {
      isAllowed: false,
      debugCode: "missing_rater_identity",
      reason: NO_RATER_IDENTITY_REASON,
      summary: buildUnverifiedSummary({
        chainId: body.chainId,
        walletAddress,
      }),
    };
  }

  const environment = getServerEnvironmentScope();

  try {
    return await db.transaction(async tx => {
      const identityKey = await ensureQuotaRow(tx, {
        chainId: body.chainId!,
        environment,
        raterIdentityKey,
        walletAddress,
      });
      const now = new Date();
      const expiresAt = new Date(now.getTime() + FREE_TRANSACTION_RESERVATION_TTL_MS);
      const [quotaRow] = await tx
        .select()
        .from(freeTransactionQuotas)
        .where(eq(freeTransactionQuotas.identityKey, identityKey))
        .limit(1)
        .for("update");

      const normalizedQuotaRow = normalizeQuotaRow(quotaRow);
      if (!normalizedQuotaRow) {
        throw new Error("Failed to read free transaction quota.");
      }

      const activePendingReservations = await getActivePendingReservationCount(tx, {
        identityKey,
        now,
      });

      const [existingReservation] = await tx
        .select()
        .from(freeTransactionReservations)
        .where(eq(freeTransactionReservations.operationKey, operationKey))
        .limit(1);
      const normalizedReservation = normalizeReservationRow(existingReservation);

      const idempotentConfirmed =
        normalizedReservation?.status === "confirmed" &&
        normalizedReservation.confirmedAt &&
        now.getTime() - getTimestampMs(normalizedReservation.confirmedAt) <= FREE_TRANSACTION_IDEMPOTENCY_WINDOW_MS;

      if (
        normalizedReservation?.status === "pending" &&
        normalizedReservation.expiresAt &&
        getTimestampMs(normalizedReservation.expiresAt) > now.getTime()
      ) {
        return {
          isAllowed: true,
          summary: buildQuotaSummary({
            chainId: normalizedQuotaRow.chainId,
            environment: normalizedQuotaRow.environment,
            freeTxLimit: normalizedQuotaRow.freeTxLimit,
            freeTxUsed: normalizedQuotaRow.freeTxUsed,
            pendingReservations: activePendingReservations,
            raterIdentityKey: normalizedQuotaRow.raterIdentityKey,
            walletAddress,
          }),
        };
      }

      if (idempotentConfirmed) {
        return {
          isAllowed: true,
          summary: buildQuotaSummary({
            chainId: normalizedQuotaRow.chainId,
            environment: normalizedQuotaRow.environment,
            freeTxLimit: normalizedQuotaRow.freeTxLimit,
            freeTxUsed: normalizedQuotaRow.freeTxUsed,
            pendingReservations: activePendingReservations,
            raterIdentityKey: normalizedQuotaRow.raterIdentityKey,
            walletAddress,
          }),
        };
      }

      if (normalizedQuotaRow.freeTxUsed + activePendingReservations >= normalizedQuotaRow.freeTxLimit) {
        const [latestQuotaRow] = await tx
          .select()
          .from(freeTransactionQuotas)
          .where(eq(freeTransactionQuotas.identityKey, identityKey))
          .limit(1);

        const normalizedLatestQuotaRow = normalizeQuotaRow(latestQuotaRow);
        if (!normalizedLatestQuotaRow) {
          throw new Error("Failed to read free transaction quota.");
        }

        return {
          isAllowed: false,
          debugCode: "free_tx_exhausted",
          reason: FREE_TX_EXHAUSTED_REASON,
          summary: buildQuotaSummary({
            chainId: normalizedLatestQuotaRow.chainId,
            environment: normalizedLatestQuotaRow.environment,
            freeTxLimit: normalizedLatestQuotaRow.freeTxLimit,
            freeTxUsed: normalizedLatestQuotaRow.freeTxUsed,
            pendingReservations: activePendingReservations,
            raterIdentityKey: normalizedLatestQuotaRow.raterIdentityKey,
            walletAddress,
          }),
        };
      }

      if (existingReservation) {
        await tx
          .update(freeTransactionReservations)
          .set({
            identityKey,
            voterIdTokenId: raterIdentityKey,
            chainId: body.chainId!,
            environment,
            walletAddress,
            status: "pending",
            txHashes: null,
            reservedAt: now,
            expiresAt,
            confirmedAt: null,
            releasedAt: null,
            updatedAt: now,
          })
          .where(eq(freeTransactionReservations.operationKey, operationKey));
      } else {
        await tx.insert(freeTransactionReservations).values({
          operationKey,
          identityKey,
          voterIdTokenId: raterIdentityKey,
          chainId: body.chainId!,
          environment,
          walletAddress,
          status: "pending",
          txHashes: null,
          reservedAt: now,
          expiresAt,
          confirmedAt: null,
          releasedAt: null,
          updatedAt: now,
        });
      }

      return {
        isAllowed: true,
        summary: buildQuotaSummary({
          chainId: normalizedQuotaRow.chainId,
          environment: normalizedQuotaRow.environment,
          freeTxLimit: normalizedQuotaRow.freeTxLimit,
          freeTxUsed: normalizedQuotaRow.freeTxUsed,
          pendingReservations: activePendingReservations + 1,
          raterIdentityKey: normalizedQuotaRow.raterIdentityKey,
          walletAddress,
        }),
      };
    });
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during verifier check; failing closed.", {
        chainId: body.chainId,
        sender: walletAddress,
        raterIdentityKey,
      });
      return {
        isAllowed: false,
        debugCode: "quota_store_unavailable",
        reason: DEFAULT_DENY_REASON,
      };
    }

    throw error;
  }
}

export async function confirmFreeTransactionReservation(params: {
  address: string;
  chainId: number;
  operationKey: string;
  transactionHashes: string[];
}) {
  if (!isAddress(params.address) || !Number.isFinite(params.chainId) || !isHash(params.operationKey)) {
    throw new Error("Invalid free transaction confirmation payload");
  }

  const normalizedTransactionHashes = [...new Set(params.transactionHashes.filter(isHash))] as Hash[];
  if (normalizedTransactionHashes.length === 0) {
    throw new Error("At least one transaction hash is required");
  }

  const walletAddress = normalizeAddress(params.address);
  const allSucceeded = await (
    freeTransactionTestOverrides?.allTransactionHashesSucceeded ?? allTransactionHashesSucceeded
  )({
    chainId: params.chainId,
    transactionHashes: normalizedTransactionHashes,
    walletAddress,
  });

  if (!allSucceeded) {
    throw new Error("Sponsored transaction receipts could not be verified");
  }

  try {
    await ensureFreeTransactionQuotaTable();

    await db.transaction(async tx => {
      const [reservation] = await tx
        .select()
        .from(freeTransactionReservations)
        .where(eq(freeTransactionReservations.operationKey, params.operationKey as Hash))
        .limit(1);
      const normalizedReservation = normalizeReservationRow(reservation);

      if (!normalizedReservation) {
        return;
      }

      if (
        normalizedReservation.chainId !== params.chainId ||
        normalizedReservation.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
      ) {
        throw new Error("Sponsored transaction reservation does not match the current wallet");
      }

      if (normalizedReservation.status === "confirmed") {
        return;
      }

      if (normalizedReservation.status !== "pending") {
        return;
      }

      const now = new Date();
      const updatedReservations = await tx
        .update(freeTransactionReservations)
        .set({
          status: "confirmed",
          txHashes: JSON.stringify(normalizedTransactionHashes),
          confirmedAt: now,
          releasedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(freeTransactionReservations.operationKey, params.operationKey as Hash),
            eq(freeTransactionReservations.status, "pending"),
          ),
        )
        .returning({
          identityKey: freeTransactionReservations.identityKey,
        });

      if (updatedReservations.length === 0) {
        return;
      }

      const updatedIdentityKey =
        updatedReservations[0]?.identityKey ??
        (updatedReservations[0] as { identity_key?: string; identitykey?: string } | undefined)?.identity_key ??
        (updatedReservations[0] as { identity_key?: string; identitykey?: string } | undefined)?.identitykey;
      if (!updatedIdentityKey) {
        return;
      }

      await tx
        .update(freeTransactionQuotas)
        .set({
          lastWalletAddress: walletAddress,
          freeTxUsed: sql`${freeTransactionQuotas.freeTxUsed} + 1`,
          exhaustedAt: sql`
            CASE
              WHEN ${freeTransactionQuotas.freeTxUsed} + 1 >= ${freeTransactionQuotas.freeTxLimit}
              THEN ${now}
              ELSE ${freeTransactionQuotas.exhaustedAt}
            END
          `,
          updatedAt: now,
        })
        .where(eq(freeTransactionQuotas.identityKey, updatedIdentityKey));
    });
  } catch (error) {
    if (isFreeTransactionStoreUnavailableError(error)) {
      console.warn("[thirdweb-free-tx] quota store unavailable during confirmation; failing closed.", {
        address: walletAddress,
        chainId: params.chainId,
        operationKey: params.operationKey,
      });
      throw error;
    }

    throw error;
  }
}
