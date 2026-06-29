import { ContentRegistryAbi, FeedbackBonusEscrowAbi, ProtocolConfigAbi } from "@rateloop/contracts/abis";
import { getSharedDeploymentAddress } from "@rateloop/contracts/deployments";
import { getUsdcEip712DomainName } from "@rateloop/contracts/protocol";
import { canonicalJsonHash } from "@rateloop/node-utils/json";
import { type TargetAudience, normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import { createHash } from "crypto";
import "server-only";
import {
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
  keccak256,
  parseSignature,
  toBytes,
} from "viem";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import {
  attachImagesToContent,
  getImageAttachmentSubmissionValidationError,
  markImagesRequireGatedAccess,
} from "~~/lib/attachments/imageAttachments";
import {
  attachQuestionDetailsToContent,
  markQuestionDetailsRequiresGatedAccess,
} from "~~/lib/attachments/questionDetails";
import { upsertQuestionConfidentialityFromMetadata } from "~~/lib/confidentiality/context";
import { dbClient } from "~~/lib/db";
import {
  getPrimaryServerTargetNetwork,
  getServerTargetNetworkById,
  getX402UsdcAddressOverride,
} from "~~/lib/env/server";
import { resolveContentDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import {
  getContentRegistrySubmissionRewardMinimum,
  getSubmissionRewardCoverageMinimum,
} from "~~/lib/questionRewardMinimums";
import {
  questionRoundConfigToAbi,
  requiredQuestionRewardVotersForAmount,
  serializeQuestionRoundConfig,
} from "~~/lib/questionRoundConfig";
import {
  CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  buildQuestionBundleSubmissionRevealCommitment,
  buildQuestionConfidentialityHash,
  buildQuestionMetadataUri,
  buildQuestionSubmissionKey,
  buildQuestionSubmissionRevealCommitment,
} from "~~/lib/questionSubmissionCommitment";
import {
  X402QuestionInputError,
  type X402QuestionOperation,
  type X402QuestionPayload,
  X402_CONFIDENTIALITY_BOND_UINT64_MAX,
  X402_SUBMISSION_REWARD_ASSET_LREP,
  X402_SUBMISSION_REWARD_ASSET_USDC,
  X402_USDC_BY_CHAIN_ID,
  X402_USDC_DECIMALS,
  assertSupportedX402BundleBounty,
  buildX402QuestionOperation,
} from "~~/lib/x402/questionPayload";
import { ponderApi } from "~~/services/ponder/client";
import { isBasePreconfRpcChain } from "~~/utils/rpcUrls";

const TX_RECEIPT_TIMEOUT_MS = 180_000;
const MAX_X402_AUTHORIZATION_VALIDITY_SECONDS = 24n * 60n * 60n;
const FEEDBACK_BONUS_ASSET_LREP = 0;
const SUBMISSION_REWARD_DECIMALS = 6;
const QUESTION_CONTEXT_DOMAIN = keccak256(toBytes("rateloop-question-context-v5"));
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as const;
const BASE_SEPOLIA_STALE_X402_SUBMITTER_ADDRESS =
  "0x24ab19e0d8052dec62bec59e986e336adc4721f3" as const satisfies Lowercase<Address>;
type FeedbackBonusAsset = "LREP" | "USDC";
type SubmissionRewardAsset = X402QuestionPayload["bounty"]["asset"];

function questionDetailsTuple(question: Pick<X402QuestionPayload["questions"][number], "detailsHash" | "detailsUrl">) {
  return {
    detailsUrl: question.detailsUrl,
    detailsHash: question.detailsHash,
  };
}

function buildSubmissionDetailsHash(detailsUrl: string, detailsHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [detailsUrl, detailsHash]));
}

export type X402QuestionSubmissionStatus = "awaiting_wallet_signature" | "submitted" | "failed";

type WalletSubmissionReceiptMode =
  | "agent-wallet-plan"
  | "native-x402-authorization"
  | "permissionless-wallet-plan"
  | "permissionless-x402-authorization";

type AttachmentSubmissionIdentity = {
  agentId?: string | null;
  ownerWalletAddress?: string | null;
};

type StoredWalletSubmissionPlanReceipt = {
  agentId?: string;
  expectedContentHashes?: Hex[];
  expectedContextUrls?: string[];
  feedbackBonus?: StoredFeedbackBonusRequest;
  pendingCallback?: StoredPendingAgentCallback;
  expectedRewardTerms?: StoredQuestionRewardTerms;
  expectedRoundConfig?: ReturnType<typeof serializeQuestionRoundConfig>;
  mode?: WalletSubmissionReceiptMode;
  operationKey?: string;
  originalClientRequestId?: string;
  questionAttachments?: StoredQuestionAttachmentRefs[];
  questionMetadata?: StoredQuestionMetadata[];
  revealCommitment?: Hex;
  walletAddress?: Address;
};

type StoredQuestionAttachmentRefs = {
  detailsHash: Hex;
  detailsUrl: string;
  gated: boolean;
  imageUrls: string[];
};

type StoredQuestionMetadata = {
  questionMetadata?: unknown;
  questionMetadataHash: Hex;
  questionMetadataUri?: string;
  resultSpecHash: Hex;
  targetAudience: TargetAudience | null;
};

function questionConfidentialityConfig(question: Pick<X402QuestionPayload["questions"][number], "confidentiality">) {
  const gated = question.confidentiality?.visibility === "gated";
  const privateForever = gated && question.confidentiality?.disclosurePolicy === "private_forever";
  const bondAmount = gated ? BigInt(question.confidentiality?.bond?.amount ?? "0") : 0n;
  if (bondAmount > X402_CONFIDENTIALITY_BOND_UINT64_MAX) {
    throw new X402QuestionInputError(
      `question.confidentiality.bond.amount must be at most ${X402_CONFIDENTIALITY_BOND_UINT64_MAX}.`,
    );
  }
  return {
    gated,
    bondAsset: gated && question.confidentiality?.bond?.asset === "USDC" ? 1 : 0,
    bondAmount,
    flags: privateForever ? CONFIDENTIALITY_FLAG_PRIVATE_FOREVER : 0,
  } as const;
}

function onChainQuestion(question: X402QuestionPayload["questions"][number]): X402QuestionPayload["questions"][number] {
  if (question.confidentiality?.visibility !== "gated") return question;
  return {
    ...question,
    contextUrl: "",
    detailsUrl: "",
    imageUrls: [],
    videoUrl: "",
  };
}

export type StoredPendingAgentCallback = {
  agentId: string;
  callbackUrl: string;
  eventTypes: string[];
  secret: string;
};

type StoredQuestionRewardTerms = {
  amount: string;
  asset: string;
  bountyStartBy: string;
  bountyWindowSeconds: string;
  feedbackWindowSeconds: string;
  bountyEligibility: string;
  requiredSettledRounds: string;
  requiredVoters: string;
};

type SubmittedQuestionContent = {
  contentHash: Hex;
  contentId: bigint;
  imageUrls: string[];
  questionMetadataHash: Hex | null;
  resultSpecHash: Hex | null;
  submitter: Address;
  videoUrl: string;
};

type SubmittedQuestionDetails = {
  contentId: bigint;
  detailsHash: Hex;
  detailsUrl: string;
};

type SubmittedBundleContentLink = {
  bundleId: bigint;
  bundleIndex: bigint;
  contentId: bigint;
};

type SubmittedRoundConfig = ReturnType<typeof serializeQuestionRoundConfig>;

type SubmittedRewardAttachment = StoredQuestionRewardTerms & {
  bundleId: bigint | null;
  contentId: bigint | null;
  questionCount: string | null;
  rewardPoolId: bigint | null;
  submitter: Address;
};

type AgentWalletTransactionPhase =
  | "approve_lrep"
  | "approve_usdc"
  | "reserve_submission"
  | "submit_question"
  | "submit_x402_question";

type AgentWalletTransactionCall = {
  data: Hex;
  description: string;
  functionName: string;
  id: string;
  phase: AgentWalletTransactionPhase;
  to: Address;
  value: "0";
  waitAfterMs?: number;
};

type AgentWalletQuestionSubmissionPlan = {
  chainId: number;
  calls: AgentWalletTransactionCall[];
  operationKey: `0x${string}`;
  payment: {
    amount: string;
    asset: SubmissionRewardAsset;
    bountyAmount: string;
    decimals: number;
    spender: Address;
    tokenAddress: Address;
  };
  payloadHash: string;
  questionCount: number;
  requiresOrderedExecution: true;
  revealCommitment: Hex;
  roundConfig: ReturnType<typeof serializeQuestionRoundConfig>;
  submissionKeys: Hex[];
  walletAddress: Address;
};

export type X402FeedbackBonusRequest = {
  amount: bigint;
  asset: FeedbackBonusAsset;
  awarder: Address;
};

type X402FeedbackBonusTerms = {
  amount: bigint;
  awarder: Address;
};

type StoredFeedbackBonusStatus = "requested" | "pending_question_confirmation" | "funded" | "failed";

type StoredFeedbackBonusRequest = {
  amount: string;
  asset: FeedbackBonusAsset;
  awarder: Address;
  error?: string;
  feedbackClosesAt?: string;
  fundedAt?: string;
  poolId?: string;
  preparedAt?: string;
  roundId?: string;
  status?: StoredFeedbackBonusStatus;
  transactionHashes?: Hex[];
};

type NativeX402PaymentAuthorization = {
  from: Address;
  nonce: Hex;
  signature?: Hex;
  to: Address;
  validAfter: string;
  validBefore: string;
  value: string;
};

type NativeX402QuestionSubmissionPlan = {
  authorization: NativeX402PaymentAuthorization;
  chainId: number;
  calls: AgentWalletTransactionCall[];
  operationKey: `0x${string}`;
  payment: AgentWalletQuestionSubmissionPlan["payment"];
  payloadHash: string;
  questionCount: number;
  requiresOrderedExecution: true;
  revealCommitment: Hex;
  roundConfig: ReturnType<typeof serializeQuestionRoundConfig>;
  submissionKey: Hex;
  walletAddress: Address;
};

export type X402QuestionSubmissionRecord = {
  operationKey: `0x${string}`;
  clientRequestId: string;
  payloadHash: string;
  chainId: number;
  payerAddress: string | null;
  paymentAsset: string;
  paymentAmount: string;
  bountyAmount: string;
  status: X402QuestionSubmissionStatus;
  bundleId: string | null;
  contentId: string | null;
  contentIds: string | null;
  questionCount: number;
  rewardPoolId: string | null;
  transactionHashes: string | null;
  paymentReceipt: string | null;
  error: string | null;
  updatedAt: Date;
};

function normalizedAddress(value: Address): Lowercase<Address> {
  return value.toLowerCase() as Lowercase<Address>;
}

function isBytes32Hex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function toDecimalString(value: unknown): string {
  return typeof value === "bigint" || typeof value === "number" || typeof value === "string"
    ? BigInt(value).toString()
    : "";
}

function normalizeFeedbackBonusAsset(value: unknown): FeedbackBonusAsset {
  return typeof value === "string" && value.trim().toUpperCase() === "LREP" ? "LREP" : "USDC";
}

function submissionRewardAssetId(asset: SubmissionRewardAsset) {
  return asset === "LREP" ? X402_SUBMISSION_REWARD_ASSET_LREP : X402_SUBMISSION_REWARD_ASSET_USDC;
}

function submissionRewardAssetLabel(asset: unknown): SubmissionRewardAsset {
  return toDecimalString(asset) === String(X402_SUBMISSION_REWARD_ASSET_LREP) ? "LREP" : "USDC";
}

function submissionRewardTokenAddress(
  config: X402QuestionSubmissionConfig,
  asset: SubmissionRewardAsset,
): Address | null {
  return asset === "LREP" ? (config.lrepAddress ?? null) : config.usdcAddress;
}

function feedbackBonusUsdcPaymentAmount(feedbackBonus: X402FeedbackBonusRequest | null | undefined) {
  return feedbackBonus?.asset === "USDC" ? feedbackBonus.amount : 0n;
}

function x402NativePaymentAmount(
  payload: X402QuestionPayload,
  feedbackBonus: X402FeedbackBonusRequest | null | undefined,
) {
  return payload.bounty.amount + feedbackBonusUsdcPaymentAmount(feedbackBonus);
}

function shouldUseOneShotX402Payment(feedbackBonus: X402FeedbackBonusRequest | null | undefined) {
  return feedbackBonus?.asset === "USDC" && feedbackBonus.amount > 0n;
}

function supportsX402OneShotFeedbackBonus(config: {
  chainId: number;
  x402QuestionSubmitterAddress?: Address;
}): boolean {
  return !(
    config.chainId === 84532 &&
    config.x402QuestionSubmitterAddress &&
    normalizedAddress(config.x402QuestionSubmitterAddress) === BASE_SEPOLIA_STALE_X402_SUBMITTER_ADDRESS
  );
}

function oneShotFeedbackBonusTerms(feedbackBonus: X402FeedbackBonusRequest | null | undefined): X402FeedbackBonusTerms {
  if (!feedbackBonus || !shouldUseOneShotX402Payment(feedbackBonus)) {
    return {
      amount: 0n,
      awarder: ZERO_ADDRESS,
    };
  }
  return {
    amount: feedbackBonus.amount,
    awarder: feedbackBonus.awarder,
  };
}

function buildQuestionContentHash(question: X402QuestionPayload["questions"][number]): Hex {
  const submittedQuestion = onChainQuestion(question);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "string[]" },
        { type: "string" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        submittedQuestion.contextUrl,
        submittedQuestion.imageUrls,
        submittedQuestion.videoUrl,
        buildSubmissionDetailsHash(submittedQuestion.detailsUrl, submittedQuestion.detailsHash),
        submittedQuestion.title,
        submittedQuestion.tags,
        submittedQuestion.categoryId,
        submittedQuestion.questionMetadataHash,
        submittedQuestion.resultSpecHash,
      ],
    ),
  );
}

function getQuestionImageUrls(payload: X402QuestionPayload): string[] {
  return payload.questions.flatMap(question => question.imageUrls);
}

async function assertApprovedImageAttachmentsForSubmission(
  payload: X402QuestionPayload,
  identity: AttachmentSubmissionIdentity,
) {
  const error = await getImageAttachmentSubmissionValidationError({
    agentId: identity.agentId,
    imageUrls: getQuestionImageUrls(payload),
    ownerWalletAddress: identity.ownerWalletAddress,
  });
  if (error) {
    throw new X402QuestionInputError(error);
  }
}

async function assertApprovedAttachmentsForSubmission(
  payload: X402QuestionPayload,
  identity: AttachmentSubmissionIdentity,
) {
  await assertApprovedImageAttachmentsForSubmission(payload, identity);
}

async function markGatedHostedAttachmentsForSubmission(
  payload: X402QuestionPayload,
  identity: AttachmentSubmissionIdentity,
) {
  for (const question of payload.questions) {
    if (question.confidentiality.visibility !== "gated") continue;
    if (question.detailsUrl) {
      await markQuestionDetailsRequiresGatedAccess({
        agentId: identity.agentId,
        detailsUrl: question.detailsUrl,
        ownerWalletAddress: identity.ownerWalletAddress,
      });
    }
    if (question.imageUrls.length > 0) {
      await markImagesRequireGatedAccess({
        agentId: identity.agentId,
        imageUrls: question.imageUrls,
        ownerWalletAddress: identity.ownerWalletAddress,
      });
    }
  }
}

function buildExpectedQuestionContentHashes(payload: X402QuestionPayload): Hex[] {
  return payload.questions.map(question => buildQuestionContentHash(question));
}

function buildExpectedQuestionContextUrls(payload: X402QuestionPayload): string[] {
  return payload.questions.map(question => onChainQuestion(question).contextUrl);
}

function serializeExpectedRewardTerms(payload: X402QuestionPayload): StoredQuestionRewardTerms {
  return {
    amount: payload.bounty.amount.toString(),
    asset: submissionRewardAssetId(payload.bounty.asset).toString(),
    bountyStartBy: payload.bounty.bountyStartBy.toString(),
    bountyWindowSeconds: payload.bounty.bountyWindowSeconds.toString(),
    feedbackWindowSeconds: payload.bounty.feedbackWindowSeconds.toString(),
    bountyEligibility: payload.bounty.bountyEligibility.toString(),
    requiredSettledRounds: payload.bounty.requiredSettledRounds.toString(),
    requiredVoters: payload.bounty.requiredVoters.toString(),
  };
}

function serializeQuestionMetadata(payload: X402QuestionPayload): StoredQuestionMetadata[] {
  return payload.questions.map(question => ({
    questionMetadata: question.questionMetadata,
    questionMetadataHash: question.questionMetadataHash,
    questionMetadataUri: question.questionMetadataUri,
    resultSpecHash: question.resultSpecHash,
    targetAudience: normalizeTargetAudience(question.targetAudience),
  }));
}

function serializeQuestionAttachmentRefs(payload: X402QuestionPayload): StoredQuestionAttachmentRefs[] {
  return payload.questions.map(question => ({
    detailsHash: question.detailsHash,
    detailsUrl: question.detailsUrl,
    gated: question.confidentiality?.visibility === "gated",
    imageUrls: question.imageUrls,
  }));
}

function parseStoredQuestionAttachmentRefs(value: unknown): StoredQuestionAttachmentRefs[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (!isBytes32Hex(record.detailsHash)) return [];
    const imageUrls = Array.isArray(record.imageUrls)
      ? record.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
      : [];
    return [
      {
        detailsHash: record.detailsHash.toLowerCase() as Hex,
        detailsUrl: typeof record.detailsUrl === "string" ? record.detailsUrl.trim() : "",
        gated: record.gated === true,
        imageUrls,
      },
    ];
  });
  return items.length > 0 ? items : undefined;
}

function parseStoredQuestionMetadata(value: unknown): StoredQuestionMetadata[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (!isBytes32Hex(record.questionMetadataHash) || !isBytes32Hex(record.resultSpecHash)) return [];
    const questionMetadata = record.questionMetadata;
    if (questionMetadata !== undefined && questionMetadata !== null) {
      try {
        if (canonicalJsonHash(questionMetadata).toLowerCase() !== record.questionMetadataHash.toLowerCase()) return [];
      } catch {
        return [];
      }
    }
    let targetAudience: TargetAudience | null;
    try {
      targetAudience = normalizeTargetAudience(record.targetAudience);
    } catch {
      return [];
    }
    return [
      {
        ...(questionMetadata === undefined ? {} : { questionMetadata }),
        questionMetadataHash: record.questionMetadataHash.toLowerCase() as Hex,
        questionMetadataUri:
          typeof record.questionMetadataUri === "string" && record.questionMetadataUri.trim()
            ? record.questionMetadataUri.trim()
            : undefined,
        resultSpecHash: record.resultSpecHash.toLowerCase() as Hex,
        targetAudience,
      },
    ];
  });
  return items.length > 0 ? items : undefined;
}

function serializeFeedbackBonusRequest(
  feedbackBonus: X402FeedbackBonusRequest | null | undefined,
): StoredFeedbackBonusRequest | undefined {
  if (!feedbackBonus) return undefined;
  return {
    amount: feedbackBonus.amount.toString(),
    asset: feedbackBonus.asset,
    awarder: feedbackBonus.awarder,
    status: "pending_question_confirmation",
  };
}

function parseStoredFeedbackBonusRequest(value: unknown): StoredFeedbackBonusRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parsed = value as Record<string, unknown>;
  const amount = typeof parsed.amount === "string" && /^\d+$/.test(parsed.amount) ? parsed.amount : null;
  const awarder = typeof parsed.awarder === "string" && isAddress(parsed.awarder) ? (parsed.awarder as Address) : null;
  const asset = normalizeFeedbackBonusAsset(parsed.asset);
  if (!amount || !awarder) return undefined;
  const rawStatus = typeof parsed.status === "string" ? parsed.status : "requested";
  const status: StoredFeedbackBonusStatus =
    rawStatus === "requested" ||
    rawStatus === "pending_question_confirmation" ||
    rawStatus === "funded" ||
    rawStatus === "failed"
      ? rawStatus
      : "requested";
  const transactionHashes = Array.isArray(parsed.transactionHashes)
    ? parsed.transactionHashes.filter(
        (hash): hash is Hex => typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash),
      )
    : undefined;
  return {
    amount,
    asset,
    awarder,
    error: typeof parsed.error === "string" ? parsed.error : undefined,
    feedbackClosesAt:
      typeof parsed.feedbackClosesAt === "string" && /^\d+$/.test(parsed.feedbackClosesAt)
        ? parsed.feedbackClosesAt
        : undefined,
    fundedAt: typeof parsed.fundedAt === "string" ? parsed.fundedAt : undefined,
    poolId: typeof parsed.poolId === "string" ? parsed.poolId : undefined,
    preparedAt: typeof parsed.preparedAt === "string" ? parsed.preparedAt : undefined,
    roundId: typeof parsed.roundId === "string" && /^\d+$/.test(parsed.roundId) ? parsed.roundId : undefined,
    status,
    transactionHashes,
  };
}

function parseStoredPendingAgentCallback(value: unknown): StoredPendingAgentCallback | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parsed = value as Record<string, unknown>;
  const agentId = typeof parsed.agentId === "string" ? parsed.agentId.trim() : "";
  const callbackUrl = typeof parsed.callbackUrl === "string" ? parsed.callbackUrl.trim() : "";
  const secret = typeof parsed.secret === "string" ? parsed.secret : "";
  const eventTypes = Array.isArray(parsed.eventTypes)
    ? parsed.eventTypes.filter(
        (eventType): eventType is string => typeof eventType === "string" && eventType.trim().length > 0,
      )
    : [];
  if (!agentId || !callbackUrl || !secret || eventTypes.length === 0) return undefined;
  return {
    agentId,
    callbackUrl,
    eventTypes,
    secret,
  };
}

function parseStoredSubmissionPlanReceipt(value: string | null): StoredWalletSubmissionPlanReceipt | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const expectedContentHashes = Array.isArray(parsed.expectedContentHashes)
      ? parsed.expectedContentHashes.filter(isBytes32Hex).map(hash => hash.toLowerCase() as Hex)
      : undefined;
    const expectedContextUrls = Array.isArray(parsed.expectedContextUrls)
      ? parsed.expectedContextUrls.filter((url): url is string => typeof url === "string")
      : undefined;
    const expectedRewardTerms =
      parsed.expectedRewardTerms && typeof parsed.expectedRewardTerms === "object"
        ? (parsed.expectedRewardTerms as StoredQuestionRewardTerms)
        : undefined;
    const expectedRoundConfig =
      parsed.expectedRoundConfig && typeof parsed.expectedRoundConfig === "object"
        ? (parsed.expectedRoundConfig as ReturnType<typeof serializeQuestionRoundConfig>)
        : undefined;

    return {
      agentId: typeof parsed.agentId === "string" && parsed.agentId ? parsed.agentId : undefined,
      expectedContentHashes,
      expectedContextUrls,
      feedbackBonus: parseStoredFeedbackBonusRequest(parsed.feedbackBonus),
      pendingCallback: parseStoredPendingAgentCallback(parsed.pendingCallback),
      expectedRewardTerms,
      expectedRoundConfig,
      mode:
        parsed.mode === "agent-wallet-plan" ||
        parsed.mode === "native-x402-authorization" ||
        parsed.mode === "permissionless-wallet-plan" ||
        parsed.mode === "permissionless-x402-authorization"
          ? parsed.mode
          : undefined,
      operationKey: typeof parsed.operationKey === "string" ? parsed.operationKey : undefined,
      originalClientRequestId:
        typeof parsed.originalClientRequestId === "string" ? parsed.originalClientRequestId : undefined,
      questionAttachments: parseStoredQuestionAttachmentRefs(parsed.questionAttachments),
      questionMetadata: parseStoredQuestionMetadata(parsed.questionMetadata),
      revealCommitment: isBytes32Hex(parsed.revealCommitment) ? parsed.revealCommitment : undefined,
      walletAddress:
        typeof parsed.walletAddress === "string" && isAddress(parsed.walletAddress)
          ? (parsed.walletAddress as Address)
          : undefined,
    };
  } catch {
    return null;
  }
}

export function readPendingAgentCallbackFromSubmissionRecord(
  record: X402QuestionSubmissionRecord | null,
): StoredPendingAgentCallback | null {
  return parseStoredSubmissionPlanReceipt(record?.paymentReceipt ?? null)?.pendingCallback ?? null;
}

export function isPublicPermissionlessQuestionSubmissionRecord(record: X402QuestionSubmissionRecord | null) {
  if (!record) return false;
  const receipt = parseStoredSubmissionPlanReceipt(record.paymentReceipt);
  if (!receipt) {
    return record.clientRequestId.startsWith("wallet:") && Boolean(record.payerAddress);
  }
  if (receipt.agentId) return false;
  if (receipt.mode === "permissionless-wallet-plan" || receipt.mode === "permissionless-x402-authorization") {
    return true;
  }
  return !receipt.mode && record.clientRequestId.startsWith("wallet:") && Boolean(record.payerAddress);
}

function sameRewardTerms(left: StoredQuestionRewardTerms | undefined, right: StoredQuestionRewardTerms | undefined) {
  return (
    !!left &&
    !!right &&
    left.asset === right.asset &&
    left.amount === right.amount &&
    left.requiredVoters === right.requiredVoters &&
    left.requiredSettledRounds === right.requiredSettledRounds &&
    left.bountyStartBy === right.bountyStartBy &&
    left.bountyWindowSeconds === right.bountyWindowSeconds &&
    left.feedbackWindowSeconds === right.feedbackWindowSeconds &&
    left.bountyEligibility === right.bountyEligibility
  );
}

function sameRoundConfig(left: SubmittedRoundConfig | undefined, right: SubmittedRoundConfig | undefined) {
  return (
    !!left &&
    !!right &&
    left.questionDurationSeconds === right.questionDurationSeconds &&
    left.minVoters === right.minVoters &&
    left.maxVoters === right.maxVoters
  );
}

export function buildPermissionlessWalletClientRequestId(params: {
  chainId: number;
  clientRequestId: string;
  walletAddress: Address;
}) {
  const walletAddress = normalizedAddress(params.walletAddress);
  return `wallet:${createHash("sha256")
    .update(`${params.chainId}:${walletAddress}:${params.clientRequestId}`)
    .digest("hex")
    .slice(0, 48)}`;
}

export function toPermissionlessWalletPayload(
  payload: X402QuestionPayload,
  walletAddress: Address,
): X402QuestionPayload {
  return {
    ...payload,
    clientRequestId: buildPermissionlessWalletClientRequestId({
      chainId: payload.chainId,
      clientRequestId: payload.clientRequestId,
      walletAddress,
    }),
  };
}

type X402QuestionSubmissionTestOverrides = {
  buildAgentWalletQuestionSubmissionPlan?: typeof buildAgentWalletQuestionSubmissionPlan;
  buildNativeX402QuestionSubmissionPlan?: typeof buildNativeX402QuestionSubmissionPlan;
  createPublicQuestionClient?: typeof createPublicQuestionClient;
  preflightX402QuestionSubmission?: typeof preflightX402QuestionSubmission;
  resolveX402QuestionConfig?: typeof resolveX402QuestionConfig;
  waitForSuccessfulReceipt?: typeof waitForSuccessfulReceipt;
};

type X402QuestionSubmissionConfig = {
  chainId: number;
  contentRegistryAddress: Address;
  contentRegistryDeploymentKey: string;
  feedbackBonusEscrowAddress?: Address;
  lrepAddress?: Address;
  questionRewardPoolEscrowAddress: Address;
  rpcUrl: string;
  targetNetwork: NonNullable<ReturnType<typeof getPrimaryServerTargetNetwork>>;
  usdcAddress: Address;
  x402OneShotFeedbackBonusSupported?: boolean;
  x402QuestionSubmitterAddress?: Address;
};

export class X402QuestionConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "X402QuestionConfigError";
  }
}

export class X402QuestionConflictError extends Error {
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "X402QuestionConflictError";
  }
}

let x402QuestionSubmissionTestOverrides: X402QuestionSubmissionTestOverrides | null = null;

const X402QuestionSubmitterAbi = [
  {
    inputs: [
      {
        components: [
          { name: "url", type: "string" },
          { name: "title", type: "string" },
          { name: "tags", type: "string" },
          { name: "categoryId", type: "uint256" },
        ],
        name: "metadata",
        type: "tuple",
      },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
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
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
    ],
    name: "computeX402QuestionPaymentNonce",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { name: "url", type: "string" },
          { name: "title", type: "string" },
          { name: "tags", type: "string" },
          { name: "categoryId", type: "uint256" },
        ],
        name: "metadata",
        type: "tuple",
      },
      { name: "imageUrls", type: "string[]" },
      { name: "videoUrl", type: "string" },
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
      { name: "payer", type: "address" },
      { name: "payee", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
    ],
    name: "computeX402QuestionOneShotPaymentNonce",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
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
    name: "submitQuestionWithX402Payment",
    outputs: [{ name: "contentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
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

const ContentRegistrySubmitQuestionWithConfidentialityAbi = ContentRegistryAbi.filter(
  item =>
    item.type === "function" && item.name === "submitQuestionWithRewardAndRoundConfig" && item.inputs.length === 12,
) as Abi;

function rowToRecord(row: Record<string, unknown> | undefined): X402QuestionSubmissionRecord | null {
  if (!row) return null;
  return {
    bountyAmount: String(row.bounty_amount),
    bundleId: typeof row.bundle_id === "string" ? row.bundle_id : null,
    chainId: Number(row.chain_id),
    clientRequestId: String(row.client_request_id),
    contentId: typeof row.content_id === "string" ? row.content_id : null,
    contentIds: typeof row.content_ids === "string" ? row.content_ids : null,
    error: typeof row.error === "string" ? row.error : null,
    operationKey: String(row.operation_key) as `0x${string}`,
    payerAddress: typeof row.payer_address === "string" ? row.payer_address : null,
    payloadHash: String(row.payload_hash),
    paymentAmount: String(row.payment_amount),
    paymentAsset: String(row.payment_asset),
    paymentReceipt: typeof row.payment_receipt === "string" ? row.payment_receipt : null,
    questionCount: Number(row.question_count ?? 1),
    rewardPoolId: typeof row.reward_pool_id === "string" ? row.reward_pool_id : null,
    status: String(row.status) as X402QuestionSubmissionStatus,
    transactionHashes: typeof row.transaction_hashes === "string" ? row.transaction_hashes : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

export async function getX402QuestionSubmissionByClientRequest(params: {
  chainId: number;
  clientRequestId: string;
}): Promise<X402QuestionSubmissionRecord | null> {
  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM x402_question_submissions
      WHERE chain_id = ? AND client_request_id = ?
      LIMIT 1
    `,
    args: [params.chainId, params.clientRequestId],
  });

  return rowToRecord(result.rows[0]);
}

export async function getX402QuestionSubmissionByOperationKey(
  operationKey: `0x${string}`,
): Promise<X402QuestionSubmissionRecord | null> {
  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM x402_question_submissions
      WHERE operation_key = ?
      LIMIT 1
    `,
    args: [operationKey],
  });

  return rowToRecord(result.rows[0]);
}

async function updateSubmissionStatus(params: {
  operationKey: `0x${string}`;
  status: X402QuestionSubmissionStatus;
  bundleId?: bigint | null;
  contentId?: bigint | null;
  contentIds?: bigint[];
  rewardPoolId?: bigint | null;
  transactionHashes?: Hex[];
  error?: string | null;
}) {
  const now = new Date();
  await dbClient.execute({
    sql: `
      UPDATE x402_question_submissions
      SET status = ?,
          bundle_id = ?,
          content_id = ?,
          content_ids = ?,
          reward_pool_id = ?,
          transaction_hashes = ?,
          error = ?,
          submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE submitted_at END,
          updated_at = ?
      WHERE operation_key = ?
    `,
    args: [
      params.status,
      params.bundleId === undefined ? null : (params.bundleId?.toString() ?? null),
      params.contentId === undefined ? null : (params.contentId?.toString() ?? null),
      params.contentIds === undefined ? null : JSON.stringify(params.contentIds.map(contentId => contentId.toString())),
      params.rewardPoolId === undefined ? null : (params.rewardPoolId?.toString() ?? null),
      params.transactionHashes === undefined ? null : JSON.stringify(params.transactionHashes),
      params.error ?? null,
      params.status,
      now,
      now,
      params.operationKey,
    ],
  });
}

function parseStoredTransactionHashes(value: string | null): Hex[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is Hex => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function parseStoredContentIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function getRpcUrl(config: X402QuestionSubmissionConfig["targetNetwork"]): string | null {
  return config.rpcUrls.default.http[0] ?? null;
}

export function resolveX402QuestionConfig(chainId: number): X402QuestionSubmissionConfig {
  const targetNetwork = getServerTargetNetworkById(chainId);
  if (!targetNetwork) {
    throw new X402QuestionConfigError(`Chain ${chainId} is not configured for this server.`);
  }

  const usdcAddress =
    getX402UsdcAddressOverride(chainId) ??
    getSharedDeploymentAddress(chainId, "MockERC20") ??
    X402_USDC_BY_CHAIN_ID[chainId];
  if (!usdcAddress || !isAddress(usdcAddress)) {
    throw new X402QuestionConfigError("x402 question submissions require a configured USDC address for this chain.");
  }

  const contentDeploymentScope = resolveContentDeploymentScope(chainId);
  const contentRegistryAddress =
    contentDeploymentScope?.contentRegistryAddress ?? getSharedDeploymentAddress(chainId, "ContentRegistry");
  const feedbackBonusEscrowAddress = getSharedDeploymentAddress(chainId, "FeedbackBonusEscrow");
  const lrepAddress = getSharedDeploymentAddress(chainId, "LoopReputation");
  const questionRewardPoolEscrowAddress = getSharedDeploymentAddress(chainId, "QuestionRewardPoolEscrow");
  const x402QuestionSubmitterAddress = getSharedDeploymentAddress(chainId, "X402QuestionSubmitter");
  if (
    !contentDeploymentScope ||
    !contentRegistryAddress ||
    !questionRewardPoolEscrowAddress ||
    !x402QuestionSubmitterAddress
  ) {
    throw new X402QuestionConfigError("RateLoop contracts are not deployed for the requested chain.");
  }

  const rpcUrl = getRpcUrl(targetNetwork);
  if (!rpcUrl) {
    throw new X402QuestionConfigError(`No RPC URL is configured for chain ${chainId}.`);
  }

  return {
    chainId,
    contentRegistryAddress,
    contentRegistryDeploymentKey: contentDeploymentScope.deploymentKey,
    ...(feedbackBonusEscrowAddress ? { feedbackBonusEscrowAddress } : {}),
    ...(lrepAddress ? { lrepAddress } : {}),
    questionRewardPoolEscrowAddress,
    rpcUrl,
    targetNetwork,
    usdcAddress,
    x402OneShotFeedbackBonusSupported: supportsX402OneShotFeedbackBonus({
      chainId,
      x402QuestionSubmitterAddress,
    }),
    x402QuestionSubmitterAddress,
  };
}

function getQuestionSubmissionDependencies() {
  return {
    buildAgentWalletQuestionSubmissionPlan:
      x402QuestionSubmissionTestOverrides?.buildAgentWalletQuestionSubmissionPlan ??
      buildAgentWalletQuestionSubmissionPlan,
    buildNativeX402QuestionSubmissionPlan:
      x402QuestionSubmissionTestOverrides?.buildNativeX402QuestionSubmissionPlan ??
      buildNativeX402QuestionSubmissionPlan,
    preflightX402QuestionSubmission:
      x402QuestionSubmissionTestOverrides?.preflightX402QuestionSubmission ?? preflightX402QuestionSubmission,
    resolveX402QuestionConfig:
      x402QuestionSubmissionTestOverrides?.resolveX402QuestionConfig ?? resolveX402QuestionConfig,
    createPublicQuestionClient:
      x402QuestionSubmissionTestOverrides?.createPublicQuestionClient ?? createPublicQuestionClient,
    waitForSuccessfulReceipt: x402QuestionSubmissionTestOverrides?.waitForSuccessfulReceipt ?? waitForSuccessfulReceipt,
  };
}

function createPublicQuestionClient(config: X402QuestionSubmissionConfig) {
  return createPublicClient({ chain: config.targetNetwork, transport: http(config.rpcUrl) });
}

function createSubmissionPublicClient(config: X402QuestionSubmissionConfig) {
  return (
    x402QuestionSubmissionTestOverrides?.createPublicQuestionClient?.(config) ?? createPublicQuestionClient(config)
  );
}

type X402PublicClient = ReturnType<typeof createPublicQuestionClient>;

async function resolveSubmissionMediaValidator(
  publicClient: X402PublicClient,
  contentRegistryAddress: Address,
): Promise<Address | null> {
  let address: unknown;
  try {
    address = await publicClient.readContract({
      abi: ContentRegistryAbi,
      address: contentRegistryAddress,
      functionName: "submissionMediaValidator",
    });
  } catch {
    throw new X402QuestionConflictError("Could not confirm submitted question media attachments. Try again.");
  }
  if (typeof address !== "string" || !isAddress(address)) {
    throw new X402QuestionConflictError("Content registry returned an invalid media validator address.");
  }
  return address;
}

async function waitForSuccessfulReceipt(publicClient: X402PublicClient, hash: Hex): Promise<TransactionReceipt> {
  const chain = publicClient.chain;
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: getTransactionReceiptPollingInterval(chain?.id, {
      preconfirmation: chain ? isBasePreconfRpcChain(chain) : false,
    }),
    timeout: TX_RECEIPT_TIMEOUT_MS,
  });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }

  return receipt;
}

async function assertBountyMeetsProtocolMinimum(params: {
  config: X402QuestionSubmissionConfig;
  payload: X402QuestionPayload;
  publicClient: X402PublicClient;
}) {
  assertSupportedX402BundleBounty(params.payload.bounty);

  const protocolConfigAddress = (await params.publicClient.readContract({
    address: params.config.contentRegistryAddress,
    abi: ContentRegistryAbi,
    functionName: "protocolConfig",
  })) as Address;
  const minimumFunction = params.payload.bounty.asset === "LREP" ? "minSubmissionLrepPool" : "minSubmissionUsdcPool";
  const minimum = (await params.publicClient.readContract({
    address: protocolConfigAddress,
    abi: ProtocolConfigAbi,
    functionName: minimumFunction,
  })) as bigint;
  const protocolRoundConfig = (await params.publicClient.readContract({
    address: protocolConfigAddress,
    abi: ProtocolConfigAbi,
    functionName: "config",
  })) as any;
  const defaultMaxVoters = BigInt(protocolRoundConfig?.maxVoters ?? protocolRoundConfig?.[3] ?? 0);
  const submissionMinimum = getContentRegistrySubmissionRewardMinimum({
    configuredMinimum: minimum,
    defaultMaxVoters,
  });

  if (params.payload.bounty.amount < submissionMinimum) {
    throw new X402QuestionConflictError(
      `Bounty is below the on-chain ${params.payload.bounty.asset} minimum (${submissionMinimum.toString()} atomic units).`,
    );
  }

  const coverageMinimum = getSubmissionRewardCoverageMinimum({
    maxVoters: params.payload.roundConfig.maxVoters,
    requiredVoters: params.payload.bounty.requiredVoters,
  });

  if (params.payload.bounty.amount < coverageMinimum) {
    throw new X402QuestionConflictError(
      `Bounty is below the selected voter-cap minimum (${coverageMinimum.toString()} atomic units).`,
    );
  }

  const requiredVoterFloor = requiredQuestionRewardVotersForAmount(params.payload.bounty.amount);
  if (params.payload.bounty.requiredVoters < requiredVoterFloor) {
    throw new X402QuestionConflictError(
      `Bounty requires at least ${requiredVoterFloor.toString()} voters for this amount.`,
    );
  }

  if (params.payload.bounty.requiredVoters !== params.payload.roundConfig.minVoters) {
    throw new X402QuestionConflictError("Bounty voter requirement must match the selected round settlement voters.");
  }

  if (params.payload.bounty.requiredVoters > params.payload.roundConfig.maxVoters) {
    throw new X402QuestionConflictError("Bounty voter requirement exceeds the selected question voter cap.");
  }

  await params.publicClient.readContract({
    address: protocolConfigAddress,
    abi: ProtocolConfigAbi,
    functionName: "validateRoundConfig",
    args: [
      params.payload.roundConfig.epochDuration,
      params.payload.roundConfig.maxDuration,
      params.payload.roundConfig.minVoters,
      params.payload.roundConfig.maxVoters,
    ],
  });
}

async function preflightX402QuestionSubmissionWithClient(params: {
  attachmentIdentity?: AttachmentSubmissionIdentity;
  config: X402QuestionSubmissionConfig;
  payload: X402QuestionPayload;
  publicClient: X402PublicClient;
}): Promise<{ resolvedCategoryIds: bigint[]; submissionKeys: Hex[] }> {
  await assertApprovedAttachmentsForSubmission(params.payload, params.attachmentIdentity ?? {});
  await assertBountyMeetsProtocolMinimum(params);

  const resolvedCategoryIds: bigint[] = [];
  const submissionKeys: Hex[] = [];
  const seenSubmissionKeys = new Set<Hex>();

  for (const [index, question] of params.payload.questions.entries()) {
    const submittedQuestion = onChainQuestion(question);
    const resolvedCategoryId = question.categoryId;
    const submissionKey = buildQuestionSubmissionKey({
      categoryId: resolvedCategoryId,
      contextUrl: submittedQuestion.contextUrl,
      detailsHash: submittedQuestion.detailsHash,
      detailsUrl: submittedQuestion.detailsUrl,
      imageUrls: submittedQuestion.imageUrls,
      title: submittedQuestion.title,
      tags: submittedQuestion.tags,
      videoUrl: submittedQuestion.videoUrl,
    });

    const submissionKeyUsed = (await params.publicClient.readContract({
      address: params.config.contentRegistryAddress,
      abi: ContentRegistryAbi,
      functionName: "submissionKeyUsed",
      args: [submissionKey],
    })) as boolean;
    if (submissionKeyUsed || seenSubmissionKeys.has(submissionKey)) {
      throw new X402QuestionConflictError(`Question ${index + 1} has already been submitted.`);
    }

    resolvedCategoryIds.push(resolvedCategoryId);
    submissionKeys.push(submissionKey);
    seenSubmissionKeys.add(submissionKey);
  }

  return { resolvedCategoryIds, submissionKeys };
}

export async function preflightX402QuestionSubmission(params: {
  agentId?: string | null;
  config: X402QuestionSubmissionConfig;
  ownerWalletAddress?: string | null;
  payload: X402QuestionPayload;
}): Promise<{
  operation: X402QuestionOperation;
  paymentAmount: bigint;
  resolvedCategoryIds: bigint[];
  submissionKeys: Hex[];
}> {
  const operation = buildX402QuestionOperation(params.payload);
  const publicClient = createSubmissionPublicClient(params.config);
  const preflight = await preflightX402QuestionSubmissionWithClient({
    attachmentIdentity: {
      agentId: params.agentId,
      ownerWalletAddress: params.ownerWalletAddress,
    },
    config: params.config,
    payload: params.payload,
    publicClient,
  });

  return {
    operation,
    paymentAmount: params.payload.bounty.amount,
    ...preflight,
  };
}

function buildDeterministicQuestionSalt(params: {
  index: number;
  operationKey: Hex;
  payloadHash: string;
  submissionKey: Hex;
  walletAddress: Address;
}) {
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

function buildQuestionSubmissionCallContext(params: {
  payload: X402QuestionPayload;
  salts: Hex[];
  submissionKeys: Hex[];
  submitter: Address;
}) {
  const questions = params.payload.questions.map((question, index) => {
    const submittedQuestion = onChainQuestion(question);
    return {
      categoryId: question.categoryId,
      confidentiality: question.confidentiality,
      contextUrl: submittedQuestion.contextUrl,
      detailsHash: submittedQuestion.detailsHash,
      detailsUrl: submittedQuestion.detailsUrl,
      imageUrls: submittedQuestion.imageUrls,
      salt: params.salts[index],
      spec: {
        questionMetadataHash: question.questionMetadataHash,
        resultSpecHash: question.resultSpecHash,
      },
      tags: question.tags,
      title: question.title,
      videoUrl: submittedQuestion.videoUrl,
    };
  });
  const rewardAsset = submissionRewardAssetId(params.payload.bounty.asset);
  const rewardTerms = {
    asset: rewardAsset,
    amount: params.payload.bounty.amount,
    requiredVoters: params.payload.bounty.requiredVoters,
    bountyEligibility: params.payload.bounty.bountyEligibility,
  } as const;
  const roundConfigAbi = questionRoundConfigToAbi(params.payload.roundConfig);
  const isBundleSubmission = questions.length > 1;
  const primaryQuestion = questions[0];
  const primarySubmissionKey = params.submissionKeys[0];
  if (!primaryQuestion || !primarySubmissionKey) {
    throw new Error("Question payload is empty.");
  }

  const revealCommitment = isBundleSubmission
    ? buildQuestionBundleSubmissionRevealCommitment({
        questions,
        rewardAmount: params.payload.bounty.amount,
        rewardAsset,
        requiredVoters: params.payload.bounty.requiredVoters,
        bountyEligibility: params.payload.bounty.bountyEligibility,
        roundConfig: params.payload.roundConfig,
        submitter: params.submitter,
      })
    : buildQuestionSubmissionRevealCommitment({
        categoryId: primaryQuestion.categoryId,
        detailsHash: primaryQuestion.detailsHash,
        detailsUrl: primaryQuestion.detailsUrl,
        imageUrls: primaryQuestion.imageUrls,
        questionMetadataHash: primaryQuestion.spec.questionMetadataHash,
        rewardAmount: params.payload.bounty.amount,
        rewardAsset,
        requiredVoters: params.payload.bounty.requiredVoters,
        resultSpecHash: primaryQuestion.spec.resultSpecHash,
        bountyEligibility: params.payload.bounty.bountyEligibility,
        roundConfig: params.payload.roundConfig,
        salt: primaryQuestion.salt,
        submissionKey: primarySubmissionKey,
        submitter: params.submitter,
        tags: primaryQuestion.tags,
        title: primaryQuestion.title,
        videoUrl: primaryQuestion.videoUrl,
        confidentialityHash: buildQuestionConfidentialityHash(questionConfidentialityConfig(primaryQuestion)),
      });

  const submitFunctionName: "submitQuestionBundleWithRewardAndRoundConfig" | "submitQuestionWithRewardAndRoundConfig" =
    isBundleSubmission ? "submitQuestionBundleWithRewardAndRoundConfig" : "submitQuestionWithRewardAndRoundConfig";
  const submitArgs = isBundleSubmission
    ? ([questions, rewardTerms, roundConfigAbi] as const)
    : ([
        primaryQuestion.contextUrl,
        primaryQuestion.imageUrls,
        primaryQuestion.videoUrl,
        primaryQuestion.title,
        primaryQuestion.tags,
        primaryQuestion.categoryId,
        questionDetailsTuple(primaryQuestion),
        primaryQuestion.salt,
        rewardTerms,
        roundConfigAbi,
        primaryQuestion.spec,
        questionConfidentialityConfig(primaryQuestion),
      ] as const);

  return {
    isBundleSubmission,
    primaryQuestion,
    primarySubmissionKey,
    questions,
    revealCommitment,
    rewardTerms,
    roundConfigAbi,
    submitArgs,
    submitFunctionName,
  };
}

async function buildAgentWalletQuestionSubmissionPlan(params: {
  agentId?: string | null;
  config: X402QuestionSubmissionConfig;
  payload: X402QuestionPayload;
  walletAddress: Address;
}): Promise<AgentWalletQuestionSubmissionPlan> {
  const publicClient = createSubmissionPublicClient(params.config);
  const operation = buildX402QuestionOperation(params.payload);
  const preflight = await preflightX402QuestionSubmissionWithClient({
    attachmentIdentity: {
      agentId: params.agentId,
      ownerWalletAddress: params.walletAddress,
    },
    config: params.config,
    payload: params.payload,
    publicClient,
  });
  const salts = preflight.submissionKeys.map((submissionKey, index) =>
    buildDeterministicQuestionSalt({
      index,
      operationKey: operation.operationKey,
      payloadHash: operation.payloadHash,
      submissionKey,
      walletAddress: params.walletAddress,
    }),
  );
  const context = buildQuestionSubmissionCallContext({
    payload: params.payload,
    salts,
    submissionKeys: preflight.submissionKeys,
    submitter: params.walletAddress,
  });
  const rewardTokenAddress = submissionRewardTokenAddress(params.config, params.payload.bounty.asset);
  if (!rewardTokenAddress) {
    throw new X402QuestionConfigError(`${params.payload.bounty.asset} is not deployed for bounty funding.`);
  }
  const rewardAssetLabel = params.payload.bounty.asset;
  const submitDescription =
    params.payload.questions.length > 1
      ? `Submit ${params.payload.questions.length} question bundle and fund protocol escrow`
      : "Submit question and fund protocol escrow";

  return {
    calls: [
      {
        data: encodeFunctionData({
          abi: ContentRegistryAbi,
          functionName: "reserveSubmission",
          args: [context.revealCommitment],
        }),
        description: "Reserve the deterministic question commitment from the wallet signer",
        functionName: "reserveSubmission",
        id: "reserve-submission",
        phase: "reserve_submission",
        to: params.config.contentRegistryAddress,
        value: "0",
      },
      {
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [params.config.questionRewardPoolEscrowAddress, params.payload.bounty.amount],
        }),
        description: `Approve protocol escrow to pull the exact ${rewardAssetLabel} bounty amount`,
        functionName: "approve",
        id: `approve-${rewardAssetLabel.toLowerCase()}`,
        phase: rewardAssetLabel === "LREP" ? "approve_lrep" : "approve_usdc",
        to: rewardTokenAddress,
        value: "0",
      },
      {
        data: encodeFunctionData({
          abi: context.isBundleSubmission ? ContentRegistryAbi : ContentRegistrySubmitQuestionWithConfidentialityAbi,
          functionName: context.submitFunctionName,
          args: context.submitArgs as never,
        }),
        description: submitDescription,
        functionName: context.submitFunctionName,
        id: "submit-question",
        phase: "submit_question",
        to: params.config.contentRegistryAddress,
        value: "0",
      },
    ],
    chainId: params.payload.chainId,
    operationKey: operation.operationKey,
    payment: {
      amount: params.payload.bounty.amount.toString(),
      asset: rewardAssetLabel,
      bountyAmount: params.payload.bounty.amount.toString(),
      decimals: SUBMISSION_REWARD_DECIMALS,
      spender: params.config.questionRewardPoolEscrowAddress,
      tokenAddress: rewardTokenAddress,
    },
    payloadHash: operation.payloadHash,
    questionCount: params.payload.questions.length,
    requiresOrderedExecution: true,
    revealCommitment: context.revealCommitment,
    roundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    submissionKeys: preflight.submissionKeys,
    walletAddress: params.walletAddress,
  };
}

type NativeX402PaymentAuthorizationInput = {
  from?: unknown;
  nonce?: unknown;
  signature?: unknown;
  to?: unknown;
  validAfter?: unknown;
  validBefore?: unknown;
  value?: unknown;
};

function parseUnsignedBigInt(value: unknown, fieldName: string): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new X402QuestionConflictError(`${fieldName} must be a non-negative integer.`);
}

function parseHexBytes(value: unknown, fieldName: string): Hex | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value)) return value as Hex;
  throw new X402QuestionConflictError(`${fieldName} must be hex bytes.`);
}

function parseAddressField(value: unknown, fieldName: string): Address | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && isAddress(value, { strict: false })) return value as Address;
  throw new X402QuestionConflictError(`${fieldName} must be an EVM address.`);
}

function normalizeNativeX402AuthorizationInput(
  value: NativeX402PaymentAuthorizationInput | null | undefined,
): Partial<NativeX402PaymentAuthorization> {
  if (!value) return {};
  return {
    from: parseAddressField(value.from, "paymentAuthorization.from") ?? undefined,
    nonce: parseHexBytes(value.nonce, "paymentAuthorization.nonce") ?? undefined,
    signature: parseHexBytes(value.signature, "paymentAuthorization.signature") ?? undefined,
    to: parseAddressField(value.to, "paymentAuthorization.to") ?? undefined,
    validAfter: parseUnsignedBigInt(value.validAfter, "paymentAuthorization.validAfter")?.toString(),
    validBefore: parseUnsignedBigInt(value.validBefore, "paymentAuthorization.validBefore")?.toString(),
    value: parseUnsignedBigInt(value.value, "paymentAuthorization.value")?.toString(),
  };
}

function defaultNativeX402ValidBefore() {
  return BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
}

function assertNativeX402ValidityWindow(validAfter: bigint, validBefore: bigint) {
  if (validBefore <= validAfter) {
    throw new X402QuestionConflictError("paymentAuthorization.validBefore must be greater than validAfter.");
  }
  const maxValidBefore = BigInt(Math.floor(Date.now() / 1000)) + MAX_X402_AUTHORIZATION_VALIDITY_SECONDS;
  if (validBefore > maxValidBefore) {
    throw new X402QuestionConflictError(
      `paymentAuthorization.validBefore must be within ${MAX_X402_AUTHORIZATION_VALIDITY_SECONDS.toString()} seconds (24 hours) of now.`,
    );
  }
}

function getEip3009SignatureParts(signature: Hex) {
  if (signature.length !== 132) {
    throw new X402QuestionConflictError("paymentAuthorization.signature must be a 65-byte EIP-3009 signature.");
  }
  const parsed = parseSignature(signature);
  return {
    r: parsed.r,
    s: parsed.s,
    v: Number(parsed.v ?? BigInt(parsed.yParity + 27)),
  };
}

function buildNativeX402TypedData(params: {
  authorization: NativeX402PaymentAuthorization;
  chainId: number;
  tokenAddress: Address;
}) {
  return {
    domain: {
      chainId: params.chainId,
      name: getUsdcEip712DomainName(params.chainId),
      verifyingContract: params.tokenAddress,
      version: "2",
    },
    message: {
      from: params.authorization.from,
      nonce: params.authorization.nonce,
      to: params.authorization.to,
      validAfter: params.authorization.validAfter,
      validBefore: params.authorization.validBefore,
      value: params.authorization.value,
    },
    primaryType: "ReceiveWithAuthorization",
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
  };
}

async function buildNativeX402QuestionSubmissionPlan(params: {
  agentId?: string | null;
  config: X402QuestionSubmissionConfig;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  payload: X402QuestionPayload;
  paymentAuthorization?: NativeX402PaymentAuthorizationInput | null;
  walletAddress: Address;
}): Promise<NativeX402QuestionSubmissionPlan> {
  if (params.payload.bounty.asset !== "USDC") {
    throw new X402QuestionInputError("LREP bounties require wallet_calls funding mode.");
  }
  if (params.payload.questions.length !== 1) {
    throw new X402QuestionConflictError("EIP-3009 USDC authorization currently supports single-question asks only.");
  }
  if (!params.config.x402QuestionSubmitterAddress) {
    throw new X402QuestionConfigError("EIP-3009 USDC question submissions require the submitter deployment.");
  }
  const oneShot = shouldUseOneShotX402Payment(params.feedbackBonus);
  if (oneShot && !params.config.feedbackBonusEscrowAddress) {
    throw new X402QuestionConfigError("USDC Feedback Bonus one-shot submissions require the escrow deployment.");
  }
  if (oneShot && params.config.x402OneShotFeedbackBonusSupported === false) {
    throw new X402QuestionConfigError(
      "USDC Feedback Bonus one-shot submissions are not enabled for this chain deployment.",
    );
  }

  const inputAuthorization = normalizeNativeX402AuthorizationInput(params.paymentAuthorization);
  const validAfter = BigInt(inputAuthorization.validAfter ?? "0");
  const validBefore = BigInt(inputAuthorization.validBefore ?? defaultNativeX402ValidBefore().toString());
  assertNativeX402ValidityWindow(validAfter, validBefore);

  const publicClient = createSubmissionPublicClient(params.config);
  const operation = buildX402QuestionOperation(params.payload);
  const preflight = await preflightX402QuestionSubmissionWithClient({
    attachmentIdentity: {
      agentId: params.agentId,
      ownerWalletAddress: params.walletAddress,
    },
    config: params.config,
    payload: params.payload,
    publicClient,
  });
  const submissionKey = preflight.submissionKeys[0];
  if (!submissionKey) throw new X402QuestionConflictError("Question submission key was not available.");

  const salt = buildDeterministicQuestionSalt({
    index: 0,
    operationKey: operation.operationKey,
    payloadHash: operation.payloadHash,
    submissionKey,
    walletAddress: params.walletAddress,
  });
  const context = buildQuestionSubmissionCallContext({
    payload: params.payload,
    salts: [salt],
    submissionKeys: [submissionKey],
    submitter: params.walletAddress,
  });
  const question = context.primaryQuestion;
  const feedbackBonusTerms = oneShotFeedbackBonusTerms(params.feedbackBonus);
  const paymentAmount = x402NativePaymentAmount(params.payload, params.feedbackBonus);

  const nonceMetadata = {
    categoryId: question.categoryId,
    tags: question.tags,
    title: question.title,
    url: question.contextUrl,
  } as const;
  const computedNonce = oneShot
    ? ((await publicClient.readContract({
        address: params.config.x402QuestionSubmitterAddress,
        abi: X402QuestionSubmitterAbi,
        functionName: "computeX402QuestionOneShotPaymentNonce",
        args: [
          nonceMetadata,
          question.imageUrls,
          question.videoUrl,
          questionDetailsTuple(question),
          question.salt,
          context.rewardTerms,
          context.roundConfigAbi,
          question.spec,
          questionConfidentialityConfig(question),
          feedbackBonusTerms,
          params.walletAddress,
          params.config.x402QuestionSubmitterAddress,
          paymentAmount,
          validAfter,
          validBefore,
        ],
      })) as Hex)
    : ((await publicClient.readContract({
        address: params.config.x402QuestionSubmitterAddress,
        abi: X402QuestionSubmitterAbi,
        functionName: "computeX402QuestionPaymentNonce",
        args: [
          nonceMetadata,
          question.imageUrls,
          question.videoUrl,
          questionDetailsTuple(question),
          question.salt,
          context.rewardTerms,
          context.roundConfigAbi,
          question.spec,
          questionConfidentialityConfig(question),
          params.walletAddress,
          params.config.x402QuestionSubmitterAddress,
          paymentAmount,
          validAfter,
          validBefore,
        ],
      })) as Hex);
  if (inputAuthorization.nonce && inputAuthorization.nonce.toLowerCase() !== computedNonce.toLowerCase()) {
    throw new X402QuestionConflictError("paymentAuthorization.nonce does not match the RateLoop EIP-3009 ask payload.");
  }
  if (inputAuthorization.from && inputAuthorization.from.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw new X402QuestionConflictError("paymentAuthorization.from must match the agent wallet address.");
  }
  if (
    inputAuthorization.to &&
    inputAuthorization.to.toLowerCase() !== params.config.x402QuestionSubmitterAddress.toLowerCase()
  ) {
    throw new X402QuestionConflictError("paymentAuthorization.to must be the RateLoop EIP-3009 submitter.");
  }
  if (inputAuthorization.value && BigInt(inputAuthorization.value) !== paymentAmount) {
    throw new X402QuestionConflictError("paymentAuthorization.value must equal the EIP-3009 payment amount.");
  }

  const authorization: NativeX402PaymentAuthorization = {
    from: params.walletAddress,
    nonce: computedNonce,
    signature: inputAuthorization.signature,
    to: params.config.x402QuestionSubmitterAddress,
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    value: paymentAmount.toString(),
  };
  const calls: AgentWalletTransactionCall[] = authorization.signature
    ? (() => {
        const signatureParts = getEip3009SignatureParts(authorization.signature);
        const paymentAuthorization = {
          from: authorization.from,
          nonce: authorization.nonce,
          to: authorization.to,
          validAfter: BigInt(authorization.validAfter),
          validBefore: BigInt(authorization.validBefore),
          value: BigInt(authorization.value),
          v: signatureParts.v,
          r: signatureParts.r,
          s: signatureParts.s,
        } as const;
        return [
          {
            data: oneShot
              ? encodeFunctionData({
                  abi: X402QuestionSubmitterAbi,
                  functionName: "submitQuestionWithX402OneShotPayment",
                  args: [
                    question.contextUrl,
                    question.imageUrls,
                    question.videoUrl,
                    question.title,
                    question.tags,
                    question.categoryId,
                    questionDetailsTuple(question),
                    question.salt,
                    context.rewardTerms,
                    context.roundConfigAbi,
                    question.spec,
                    questionConfidentialityConfig(question),
                    feedbackBonusTerms,
                    paymentAuthorization,
                  ],
                })
              : encodeFunctionData({
                  abi: X402QuestionSubmitterAbi,
                  functionName: "submitQuestionWithX402Payment",
                  args: [
                    question.contextUrl,
                    question.imageUrls,
                    question.videoUrl,
                    question.title,
                    question.tags,
                    question.categoryId,
                    questionDetailsTuple(question),
                    question.salt,
                    context.rewardTerms,
                    context.roundConfigAbi,
                    question.spec,
                    questionConfidentialityConfig(question),
                    paymentAuthorization,
                  ],
                }),
            description: oneShot
              ? "Submit the question, fund protocol escrow, and attach the USDC Feedback Bonus with the signed EIP-3009 authorization"
              : "Submit the question and fund protocol escrow with the signed EIP-3009 USDC authorization",
            functionName: oneShot ? "submitQuestionWithX402OneShotPayment" : "submitQuestionWithX402Payment",
            id: oneShot ? "submit-x402-one-shot-question" : "submit-x402-question",
            phase: "submit_x402_question",
            to: params.config.x402QuestionSubmitterAddress,
            value: "0",
          },
        ];
      })()
    : [];

  return {
    authorization,
    calls,
    chainId: params.payload.chainId,
    operationKey: operation.operationKey,
    payment: {
      amount: paymentAmount.toString(),
      asset: "USDC",
      bountyAmount: params.payload.bounty.amount.toString(),
      decimals: X402_USDC_DECIMALS,
      spender: params.config.x402QuestionSubmitterAddress,
      tokenAddress: params.config.usdcAddress,
    },
    payloadHash: operation.payloadHash,
    questionCount: params.payload.questions.length,
    requiresOrderedExecution: true,
    revealCommitment: context.revealCommitment,
    roundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    submissionKey,
    walletAddress: params.walletAddress,
  };
}

function readSubmissionResult(
  receipt: TransactionReceipt,
  contentRegistryAddress: Address,
  mediaValidatorAddress?: Address | null,
): {
  bundleId: bigint | null;
  bundleContentLinks: SubmittedBundleContentLink[];
  contentIds: bigint[];
  rewardPoolId: bigint | null;
  rewardAttachments: SubmittedRewardAttachment[];
  roundConfigsByContentId: Map<string, SubmittedRoundConfig>;
  submittedContents: SubmittedQuestionContent[];
  submittedDetails: SubmittedQuestionDetails[];
  submitters: Address[];
} {
  const expectedEmitter = normalizedAddress(contentRegistryAddress);
  const expectedMediaValidatorEmitter = mediaValidatorAddress ? normalizedAddress(mediaValidatorAddress) : null;
  let bundleId: bigint | null = null;
  const bundleContentLinks: SubmittedBundleContentLink[] = [];
  const contentIds: bigint[] = [];
  let rewardPoolId: bigint | null = null;
  const rewardAttachments: SubmittedRewardAttachment[] = [];
  const roundConfigsByContentId = new Map<string, SubmittedRoundConfig>();
  const submittedContents: SubmittedQuestionContent[] = [];
  const submittedDetails: SubmittedQuestionDetails[] = [];
  const submitters = new Set<Address>();
  const imageUrlsByContentId = new Map<string, string[]>();

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: ContentRegistryAbi,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: Record<string, unknown> };

      const normalizedLogAddress = log.address.toLowerCase();
      if (normalizedLogAddress !== expectedEmitter && normalizedLogAddress !== expectedMediaValidatorEmitter) {
        continue;
      }

      if (
        decoded.eventName === "ContentSubmitted" &&
        normalizedLogAddress === expectedEmitter &&
        typeof decoded.args.contentId === "bigint"
      ) {
        contentIds.push(decoded.args.contentId);
        if (
          isBytes32Hex(decoded.args.contentHash) &&
          typeof decoded.args.submitter === "string" &&
          isAddress(decoded.args.submitter)
        ) {
          submittedContents.push({
            contentHash: decoded.args.contentHash.toLowerCase() as Hex,
            contentId: decoded.args.contentId,
            imageUrls: [],
            questionMetadataHash: null,
            resultSpecHash: null,
            submitter: decoded.args.submitter,
            videoUrl: "",
          });
        }
      }
      if (typeof decoded.args.submitter === "string" && isAddress(decoded.args.submitter)) {
        submitters.add(decoded.args.submitter);
      }
      if (
        decoded.eventName === "ContentDetailsSubmitted" &&
        normalizedLogAddress === expectedEmitter &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.detailsUrl === "string" &&
        isBytes32Hex(decoded.args.detailsHash)
      ) {
        submittedDetails.push({
          contentId: decoded.args.contentId,
          detailsHash: decoded.args.detailsHash.toLowerCase() as Hex,
          detailsUrl: decoded.args.detailsUrl,
        });
      }
      if (
        decoded.eventName === "QuestionBundleContentLinked" &&
        normalizedLogAddress === expectedEmitter &&
        typeof decoded.args.bundleId === "bigint" &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.bundleIndex === "bigint"
      ) {
        bundleContentLinks.push({
          bundleId: decoded.args.bundleId,
          bundleIndex: decoded.args.bundleIndex,
          contentId: decoded.args.contentId,
        });
      }
      if (
        decoded.eventName === "QuestionContentAnchored" &&
        normalizedLogAddress === expectedMediaValidatorEmitter &&
        typeof decoded.args.contentId === "bigint" &&
        decoded.args.mediaType === 1 &&
        typeof decoded.args.mediaIndex === "bigint" &&
        typeof decoded.args.url === "string"
      ) {
        const key = decoded.args.contentId.toString();
        const imageUrls = imageUrlsByContentId.get(key) ?? [];
        imageUrls[Number(decoded.args.mediaIndex)] = decoded.args.url;
        imageUrlsByContentId.set(key, imageUrls);
      }
      if (decoded.eventName === "QuestionBundleSubmitted" && normalizedLogAddress === expectedEmitter) {
        if (typeof decoded.args.bundleId === "bigint") {
          bundleId = decoded.args.bundleId;
        }
        if (typeof decoded.args.rewardPoolId === "bigint") {
          rewardPoolId = decoded.args.rewardPoolId;
        }
        if (typeof decoded.args.submitter === "string" && isAddress(decoded.args.submitter)) {
          rewardAttachments.push({
            amount: toDecimalString(decoded.args.amount),
            asset: toDecimalString(decoded.args.rewardAsset),
            bundleId: typeof decoded.args.bundleId === "bigint" ? decoded.args.bundleId : null,
            bountyStartBy: toDecimalString(decoded.args.bountyStartBy),
            contentId: null,
            bountyWindowSeconds: toDecimalString(decoded.args.bountyWindowSeconds),
            feedbackWindowSeconds: toDecimalString(decoded.args.feedbackWindowSeconds),
            bountyEligibility: toDecimalString(decoded.args.bountyEligibility),
            questionCount: toDecimalString(decoded.args.questionCount),
            rewardPoolId: typeof decoded.args.rewardPoolId === "bigint" ? decoded.args.rewardPoolId : null,
            requiredSettledRounds: "1",
            requiredVoters: toDecimalString(decoded.args.requiredCompleters),
            submitter: decoded.args.submitter,
          });
        }
      } else if (
        decoded.eventName === "SubmissionRewardPoolAttached" &&
        normalizedLogAddress === expectedEmitter &&
        typeof decoded.args.rewardPoolId === "bigint"
      ) {
        rewardPoolId = decoded.args.rewardPoolId;
        if (
          typeof decoded.args.contentId === "bigint" &&
          typeof decoded.args.submitter === "string" &&
          isAddress(decoded.args.submitter)
        ) {
          rewardAttachments.push({
            amount: toDecimalString(decoded.args.amount),
            asset: toDecimalString(decoded.args.rewardAsset),
            bundleId: null,
            bountyStartBy: toDecimalString(decoded.args.bountyStartBy),
            contentId: decoded.args.contentId,
            bountyWindowSeconds: toDecimalString(decoded.args.bountyWindowSeconds),
            feedbackWindowSeconds: toDecimalString(decoded.args.feedbackWindowSeconds),
            bountyEligibility: toDecimalString(decoded.args.bountyEligibility),
            questionCount: null,
            rewardPoolId: decoded.args.rewardPoolId,
            requiredSettledRounds: toDecimalString(decoded.args.requiredSettledRounds),
            requiredVoters: toDecimalString(decoded.args.requiredVoters),
            submitter: decoded.args.submitter,
          });
        }
      } else if (
        decoded.eventName === "ContentRoundConfigSet" &&
        normalizedLogAddress === expectedEmitter &&
        typeof decoded.args.contentId === "bigint"
      ) {
        roundConfigsByContentId.set(decoded.args.contentId.toString(), {
          questionDurationSeconds: toDecimalString(decoded.args.maxDuration),
          maxVoters: toDecimalString(decoded.args.maxVoters),
          minVoters: toDecimalString(decoded.args.minVoters),
        });
      }
    } catch {
      // Ignore logs from token transfers and other contracts in the same receipt.
    }
  }

  for (const content of submittedContents) {
    content.imageUrls = (imageUrlsByContentId.get(content.contentId.toString()) ?? []).filter(Boolean);
  }

  return {
    bundleId,
    bundleContentLinks,
    contentIds,
    rewardAttachments,
    rewardPoolId,
    roundConfigsByContentId,
    submittedContents,
    submittedDetails,
    submitters: Array.from(submitters),
  };
}

function readFeedbackBonusPoolCreated(
  receipt: TransactionReceipt,
  feedbackBonusEscrowAddress: Address,
): {
  amount: string;
  asset: FeedbackBonusAsset;
  awarder: Address;
  contentId: string;
  feedbackClosesAt: string;
  funder: Address;
  poolId: bigint;
  roundId: string;
} | null {
  const expectedEmitter = normalizedAddress(feedbackBonusEscrowAddress);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expectedEmitter) continue;

    try {
      const decoded = decodeEventLog({
        abi: FeedbackBonusEscrowAbi,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: Record<string, unknown> };
      if (
        decoded.eventName === "FeedbackBonusPoolCreated" &&
        typeof decoded.args.poolId === "bigint" &&
        typeof decoded.args.contentId === "bigint" &&
        typeof decoded.args.roundId === "bigint" &&
        typeof decoded.args.funder === "string" &&
        isAddress(decoded.args.funder) &&
        typeof decoded.args.awarder === "string" &&
        isAddress(decoded.args.awarder)
      ) {
        return {
          amount: toDecimalString(decoded.args.amount),
          asset: normalizeFeedbackBonusAsset(
            toDecimalString(decoded.args.asset) === String(FEEDBACK_BONUS_ASSET_LREP) ? "LREP" : "USDC",
          ),
          awarder: decoded.args.awarder,
          contentId: decoded.args.contentId.toString(),
          feedbackClosesAt: toDecimalString(decoded.args.feedbackClosesAt),
          funder: decoded.args.funder,
          poolId: decoded.args.poolId,
          roundId: decoded.args.roundId.toString(),
        };
      }
    } catch {
      // Ignore token approval logs and unrelated events in the same receipt.
    }
  }

  return null;
}

function assertFeedbackBonusPoolMatchesRequest(params: {
  contentId: string;
  createdPool: NonNullable<ReturnType<typeof readFeedbackBonusPoolCreated>>;
  expectedRoundId?: string | null;
  feedbackBonus: StoredFeedbackBonusRequest;
  funderAddress: Address;
}) {
  if (params.createdPool.contentId !== params.contentId) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus pool does not match the submitted question.");
  }
  if (params.expectedRoundId && params.createdPool.roundId !== params.expectedRoundId) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus round does not match the prepared round.");
  }
  if (params.createdPool.funder.toLowerCase() !== params.funderAddress.toLowerCase()) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus funder does not match the payer wallet.");
  }
  if (params.createdPool.amount !== params.feedbackBonus.amount) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus amount does not match the requested amount.");
  }
  if (params.createdPool.asset !== params.feedbackBonus.asset) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus asset does not match the requested asset.");
  }
  if (params.createdPool.awarder.toLowerCase() !== params.feedbackBonus.awarder.toLowerCase()) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus awarder does not match the requested awarder.");
  }
}

function submittedRecordContentIds(record: X402QuestionSubmissionRecord) {
  const storedContentIds = parseStoredContentIds(record.contentIds);
  if (storedContentIds.length > 0) return storedContentIds;
  return record.contentId ? [record.contentId] : [];
}

function assertConfirmedFeedbackBonusPool(params: {
  contentIds: Array<string | bigint>;
  createdPool: NonNullable<ReturnType<typeof readFeedbackBonusPoolCreated>>;
  expectedRoundId?: string | null;
  feedbackBonus: StoredFeedbackBonusRequest | undefined;
  funderAddress: Address;
}) {
  const { feedbackBonus } = params;
  if (!feedbackBonus) {
    throw new X402QuestionConflictError("Confirmed submission created an unexpected Feedback Bonus pool.");
  }
  const contentId = params.contentIds[0];
  if (contentId === undefined || params.contentIds.length !== 1) {
    throw new X402QuestionConflictError("Confirmed Feedback Bonus pool requires a single submitted question.");
  }
  assertFeedbackBonusPoolMatchesRequest({
    contentId: contentId.toString(),
    createdPool: params.createdPool,
    expectedRoundId: params.expectedRoundId,
    feedbackBonus,
    funderAddress: params.funderAddress,
  });
}

async function storeConfirmedFeedbackBonusPool(params: {
  createdPool: NonNullable<ReturnType<typeof readFeedbackBonusPoolCreated>>;
  operationKey: `0x${string}`;
  transactionHashes: Hex[];
}) {
  await updateStoredFeedbackBonusReceipt({
    feedbackClosesAt: params.createdPool.feedbackClosesAt,
    operationKey: params.operationKey,
    poolId: params.createdPool.poolId,
    roundId: params.createdPool.roundId,
    status: "funded",
    transactionHashes: params.transactionHashes,
  });
}

function bundleCompleterCount(expectedRewardTerms: StoredQuestionRewardTerms): string {
  return (BigInt(expectedRewardTerms.requiredVoters) * BigInt(expectedRewardTerms.requiredSettledRounds)).toString();
}

function sameBundleRewardTerms(
  submitted: SubmittedRewardAttachment,
  expected: StoredQuestionRewardTerms,
  expectedQuestionCount: number,
) {
  return (
    submitted.contentId === null &&
    submitted.asset === expected.asset &&
    submitted.amount === expected.amount &&
    submitted.bountyStartBy === expected.bountyStartBy &&
    submitted.bountyWindowSeconds === expected.bountyWindowSeconds &&
    submitted.feedbackWindowSeconds === expected.feedbackWindowSeconds &&
    submitted.bountyEligibility === expected.bountyEligibility &&
    submitted.questionCount === expectedQuestionCount.toString() &&
    submitted.requiredVoters === bundleCompleterCount(expected)
  );
}

function linkedBundleContentIds(params: {
  bundleContentLinks: SubmittedBundleContentLink[];
  bundleId: bigint;
  expectedQuestionCount: number;
}) {
  const linkedByIndex = new Map<number, bigint>();
  for (const link of params.bundleContentLinks) {
    if (link.bundleId !== params.bundleId) continue;

    const bundleIndex = Number(link.bundleIndex);
    if (
      !Number.isSafeInteger(bundleIndex) ||
      bundleIndex < 0 ||
      bundleIndex >= params.expectedQuestionCount ||
      linkedByIndex.has(bundleIndex)
    ) {
      throw new X402QuestionConflictError("Confirmed bundle submission included invalid content linkage.");
    }
    linkedByIndex.set(bundleIndex, link.contentId);
  }

  const linkedContentIds: bigint[] = [];
  for (let index = 0; index < params.expectedQuestionCount; index++) {
    const contentId = linkedByIndex.get(index);
    if (contentId === undefined) {
      throw new X402QuestionConflictError("Confirmed bundle submission did not link the planned questions.");
    }
    linkedContentIds.push(contentId);
  }
  return linkedContentIds;
}

function matchConfirmedSubmissionPlan(params: {
  bundleContentLinks: SubmittedBundleContentLink[];
  record: X402QuestionSubmissionRecord;
  rewardAttachments: SubmittedRewardAttachment[];
  roundConfigsByContentId: Map<string, SubmittedRoundConfig>;
  submittedContents: SubmittedQuestionContent[];
  walletAddress: Lowercase<Address>;
}): { bundleId: bigint | null; contentIds: bigint[]; rewardPoolId: bigint | null } {
  const planReceipt = parseStoredSubmissionPlanReceipt(params.record.paymentReceipt);
  const expectedContentHashes = planReceipt?.expectedContentHashes?.map(hash => hash.toLowerCase() as Hex) ?? [];
  if (expectedContentHashes.length === 0 || !planReceipt?.expectedRewardTerms || !planReceipt.expectedRoundConfig) {
    throw new X402QuestionConflictError("Agent wallet submission plan is missing payload confirmation data.");
  }

  const remainingWalletContents = params.submittedContents.filter(
    content => normalizedAddress(content.submitter) === params.walletAddress,
  );
  const matchedContentIds: bigint[] = [];

  for (const expectedHash of expectedContentHashes) {
    const matchIndex = remainingWalletContents.findIndex(content => content.contentHash.toLowerCase() === expectedHash);
    if (matchIndex < 0) {
      throw new X402QuestionConflictError("Confirmed submission did not match the planned question payload.");
    }

    const matchedContent = remainingWalletContents.splice(matchIndex, 1)[0];
    if (!matchedContent) {
      throw new X402QuestionConflictError("Confirmed submission did not match the planned question payload.");
    }
    matchedContentIds.push(matchedContent.contentId);
    const submittedRoundConfig = params.roundConfigsByContentId.get(matchedContent.contentId.toString());
    if (!sameRoundConfig(submittedRoundConfig, planReceipt.expectedRoundConfig)) {
      throw new X402QuestionConflictError("Confirmed submission did not use the planned round config.");
    }
  }

  if (matchedContentIds.length === 1) {
    const contentId = matchedContentIds[0];
    const rewardAttachment = params.rewardAttachments.find(
      attachment =>
        attachment.contentId === contentId &&
        normalizedAddress(attachment.submitter) === params.walletAddress &&
        sameRewardTerms(attachment, planReceipt.expectedRewardTerms),
    );
    if (!rewardAttachment) {
      throw new X402QuestionConflictError("Confirmed submission did not attach the planned bounty terms.");
    }
    return { bundleId: null, contentIds: matchedContentIds, rewardPoolId: rewardAttachment.rewardPoolId };
  }

  const bundleAttachment = params.rewardAttachments.find(
    attachment =>
      normalizedAddress(attachment.submitter) === params.walletAddress &&
      sameBundleRewardTerms(attachment, planReceipt.expectedRewardTerms!, matchedContentIds.length),
  );
  if (!bundleAttachment) {
    throw new X402QuestionConflictError("Confirmed bundle submission did not attach the planned bounty terms.");
  }
  if (bundleAttachment.bundleId === null) {
    throw new X402QuestionConflictError("Confirmed bundle submission did not include a bundle id.");
  }

  const linkedContentIds = linkedBundleContentIds({
    bundleContentLinks: params.bundleContentLinks,
    bundleId: bundleAttachment.bundleId,
    expectedQuestionCount: matchedContentIds.length,
  });
  if (!linkedContentIds.every((contentId, index) => contentId === matchedContentIds[index])) {
    throw new X402QuestionConflictError("Confirmed bundle content linkage did not match the planned question order.");
  }

  return {
    bundleId: bundleAttachment.bundleId,
    contentIds: matchedContentIds,
    rewardPoolId: bundleAttachment.rewardPoolId,
  };
}

async function attachSubmittedQuestionDetails(params: {
  agentId?: string | null;
  chainId: number;
  contentIds: readonly bigint[];
  contentRegistryAddress: Address;
  deploymentKey: string;
  ownerWalletAddress: Address;
  submittedDetails: readonly SubmittedQuestionDetails[];
}) {
  const allowedContentIds = new Set(params.contentIds.map(contentId => contentId.toString()));
  for (const details of params.submittedDetails) {
    const contentId = details.contentId.toString();
    if (!allowedContentIds.has(contentId)) continue;
    await attachQuestionDetailsToContent({
      agentId: params.agentId,
      chainId: params.chainId,
      contentId,
      contentRegistryAddress: params.contentRegistryAddress,
      deploymentKey: params.deploymentKey,
      detailsUrl: details.detailsUrl,
      ownerWalletAddress: params.ownerWalletAddress,
    });
  }
}

async function attachSubmittedQuestionImages(params: {
  agentId?: string | null;
  chainId: number;
  contentIds: readonly bigint[];
  contentRegistryAddress: Address;
  deploymentKey: string;
  ownerWalletAddress: Address;
  submittedContents: readonly SubmittedQuestionContent[];
}) {
  const allowedContentIds = new Set(params.contentIds.map(contentId => contentId.toString()));
  for (const content of params.submittedContents) {
    const contentId = content.contentId.toString();
    if (!allowedContentIds.has(contentId) || content.imageUrls.length === 0) continue;
    await attachImagesToContent({
      agentId: params.agentId,
      chainId: params.chainId,
      contentId,
      contentRegistryAddress: params.contentRegistryAddress,
      deploymentKey: params.deploymentKey,
      imageUrls: content.imageUrls,
      ownerWalletAddress: params.ownerWalletAddress,
    });
  }
}

async function attachStoredQuestionAttachments(params: {
  agentId?: string | null;
  chainId: number;
  contentIds: readonly bigint[];
  contentRegistryAddress: Address;
  deploymentKey: string;
  ownerWalletAddress: Address;
  receipt: StoredWalletSubmissionPlanReceipt | null;
}) {
  const attachments = params.receipt?.questionAttachments ?? [];
  if (attachments.length === 0) return;

  for (const [index, attachment] of attachments.entries()) {
    if (!attachment.gated) continue;
    const contentId = params.contentIds[index];
    if (contentId === undefined) continue;
    const contentIdString = contentId.toString();
    if (attachment.detailsUrl && attachment.detailsHash !== ZERO_BYTES32) {
      await attachQuestionDetailsToContent({
        agentId: params.agentId,
        chainId: params.chainId,
        contentId: contentIdString,
        contentRegistryAddress: params.contentRegistryAddress,
        deploymentKey: params.deploymentKey,
        detailsUrl: attachment.detailsUrl,
        ownerWalletAddress: params.ownerWalletAddress,
      });
    }
    if (attachment.imageUrls.length > 0) {
      await attachImagesToContent({
        agentId: params.agentId,
        chainId: params.chainId,
        contentId: contentIdString,
        contentRegistryAddress: params.contentRegistryAddress,
        deploymentKey: params.deploymentKey,
        imageUrls: attachment.imageUrls,
        ownerWalletAddress: params.ownerWalletAddress,
      });
    }
  }
}

async function syncSubmittedQuestionMetadata(params: {
  chainId: number;
  contentIds: readonly bigint[];
  contentRegistryAddress: Address;
  deploymentKey: string;
  receipt: StoredWalletSubmissionPlanReceipt | null;
}) {
  const metadata = params.receipt?.questionMetadata ?? [];
  if (metadata.length === 0) return;
  const entries = metadata.flatMap((item, index) => {
    const contentId = params.contentIds[index];
    if (contentId === undefined) return [];
    return [
      {
        contentId: contentId.toString(),
        questionMetadata: item.questionMetadata ?? null,
        questionMetadataHash: item.questionMetadataHash,
        questionMetadataUri: item.questionMetadataUri ?? buildQuestionMetadataUri(item.questionMetadataHash),
        resultSpecHash: item.resultSpecHash,
        targetAudience: item.targetAudience,
      },
    ];
  });
  if (entries.length === 0) return;
  await Promise.all(
    entries.map(entry =>
      upsertQuestionConfidentialityFromMetadata({
        chainId: params.chainId,
        contentId: entry.contentId,
        contentRegistryAddress: params.contentRegistryAddress,
        deploymentKey: params.deploymentKey,
        metadata: entry.questionMetadata as Record<string, unknown> | null,
        questionMetadataHash: entry.questionMetadataHash,
      }),
    ),
  );
  try {
    const ponderDeploymentKey = resolveProtocolDeploymentScope(params.chainId)?.deploymentKey ?? null;
    await ponderApi.syncQuestionMetadata(entries, { deploymentKey: ponderDeploymentKey });
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.warn("Unable to sync x402 question metadata to Ponder.", error);
    }
  }
}

function x402QuestionSubmissionStatusBody(params: {
  config: X402QuestionSubmissionConfig;
  operation: X402QuestionOperation;
  payload: X402QuestionPayload;
  record: X402QuestionSubmissionRecord | null;
}) {
  const transactionHashes = parseStoredTransactionHashes(params.record?.transactionHashes ?? null);
  const rewardTokenAddress =
    params.record?.paymentAsset ??
    submissionRewardTokenAddress(params.config, params.payload.bounty.asset) ??
    params.config.usdcAddress;
  return {
    bounty: serializeQuestionBountyForResponse(params.payload.bounty),
    chainId: params.payload.chainId,
    bundleId: params.record?.bundleId ?? null,
    contentId: params.record?.contentId ?? null,
    contentIds: params.record?.contentIds ? parseStoredContentIds(params.record.contentIds) : [],
    error: params.record?.error ?? null,
    operationKey: params.operation.operationKey,
    questionCount: params.payload.questions.length,
    roundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    payment: {
      amount: params.payload.bounty.amount.toString(),
      asset: rewardTokenAddress,
    },
    rewardPoolId: params.record?.rewardPoolId ?? null,
    status: params.record?.status ?? "not_found",
    transactionHashes,
  };
}

async function recordAgentWalletSubmissionPlan(params: {
  agentId: string | null;
  config: X402QuestionSubmissionConfig;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  mode?: WalletSubmissionReceiptMode;
  operation: X402QuestionOperation;
  originalClientRequestId?: string;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  plan: AgentWalletQuestionSubmissionPlan;
}) {
  const now = new Date();
  const receipt = JSON.stringify({
    ...(params.agentId ? { agentId: params.agentId } : {}),
    expectedContentHashes: buildExpectedQuestionContentHashes(params.payload),
    expectedContextUrls: buildExpectedQuestionContextUrls(params.payload),
    ...(params.feedbackBonus ? { feedbackBonus: serializeFeedbackBonusRequest(params.feedbackBonus) } : {}),
    ...(params.pendingCallback ? { pendingCallback: params.pendingCallback } : {}),
    expectedRewardTerms: serializeExpectedRewardTerms(params.payload),
    expectedRoundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    mode: params.mode ?? "agent-wallet-plan",
    operationKey: params.operation.operationKey,
    ...(params.originalClientRequestId ? { originalClientRequestId: params.originalClientRequestId } : {}),
    preparedAt: now.toISOString(),
    questionAttachments: serializeQuestionAttachmentRefs(params.payload),
    questionMetadata: serializeQuestionMetadata(params.payload),
    revealCommitment: params.plan.revealCommitment,
    walletAddress: params.plan.walletAddress,
  });

  try {
    await dbClient.execute({
      sql: `
        INSERT INTO x402_question_submissions (
          operation_key,
          client_request_id,
          payload_hash,
          chain_id,
          payer_address,
          payment_asset,
          payment_amount,
          bounty_amount,
          question_count,
          status,
          payment_receipt,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        params.operation.operationKey,
        params.payload.clientRequestId,
        params.operation.payloadHash,
        params.payload.chainId,
        params.plan.walletAddress,
        params.plan.payment.tokenAddress,
        params.plan.payment.amount,
        params.payload.bounty.amount.toString(),
        params.payload.questions.length,
        "awaiting_wallet_signature",
        receipt,
        now,
        now,
      ],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "23505") {
      throw error;
    }

    await dbClient.execute({
      sql: `
        UPDATE x402_question_submissions
        SET payer_address = ?,
            payment_asset = ?,
            payment_amount = ?,
            bounty_amount = ?,
            question_count = ?,
            status = CASE WHEN status = 'submitted' THEN status ELSE ? END,
            payment_receipt = CASE WHEN status = 'submitted' THEN payment_receipt ELSE ? END,
            error = CASE WHEN status = 'submitted' THEN error ELSE NULL END,
            updated_at = ?
        WHERE operation_key = ?
      `,
      args: [
        params.plan.walletAddress,
        params.plan.payment.tokenAddress,
        params.plan.payment.amount,
        params.payload.bounty.amount.toString(),
        params.payload.questions.length,
        "awaiting_wallet_signature",
        receipt,
        now,
        params.operation.operationKey,
      ],
    });
  }
}

async function recordNativeX402SubmissionPlan(params: {
  agentId: string | null;
  config: X402QuestionSubmissionConfig;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  mode?: WalletSubmissionReceiptMode;
  operation: X402QuestionOperation;
  originalClientRequestId?: string;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  plan: NativeX402QuestionSubmissionPlan;
}) {
  const now = new Date();
  const receipt = JSON.stringify({
    ...(params.agentId ? { agentId: params.agentId } : {}),
    authorization: params.plan.authorization,
    expectedContentHashes: buildExpectedQuestionContentHashes(params.payload),
    expectedContextUrls: buildExpectedQuestionContextUrls(params.payload),
    ...(params.feedbackBonus ? { feedbackBonus: serializeFeedbackBonusRequest(params.feedbackBonus) } : {}),
    ...(params.pendingCallback ? { pendingCallback: params.pendingCallback } : {}),
    expectedRewardTerms: serializeExpectedRewardTerms(params.payload),
    expectedRoundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    mode: params.mode ?? "native-x402-authorization",
    operationKey: params.operation.operationKey,
    ...(params.originalClientRequestId ? { originalClientRequestId: params.originalClientRequestId } : {}),
    preparedAt: now.toISOString(),
    questionAttachments: serializeQuestionAttachmentRefs(params.payload),
    questionMetadata: serializeQuestionMetadata(params.payload),
    revealCommitment: params.plan.revealCommitment,
    walletAddress: params.plan.walletAddress,
  });

  try {
    await dbClient.execute({
      sql: `
        INSERT INTO x402_question_submissions (
          operation_key,
          client_request_id,
          payload_hash,
          chain_id,
          payer_address,
          payment_asset,
          payment_amount,
          bounty_amount,
          question_count,
          status,
          payment_receipt,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        params.operation.operationKey,
        params.payload.clientRequestId,
        params.operation.payloadHash,
        params.payload.chainId,
        params.plan.walletAddress,
        params.config.usdcAddress,
        params.plan.payment.amount,
        params.payload.bounty.amount.toString(),
        params.payload.questions.length,
        "awaiting_wallet_signature",
        receipt,
        now,
        now,
      ],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code !== "23505") {
      throw error;
    }

    await dbClient.execute({
      sql: `
        UPDATE x402_question_submissions
        SET payer_address = ?,
            payment_asset = ?,
            payment_amount = ?,
            bounty_amount = ?,
            question_count = ?,
            status = CASE WHEN status = 'submitted' THEN status ELSE ? END,
            payment_receipt = CASE WHEN status = 'submitted' THEN payment_receipt ELSE ? END,
            error = CASE WHEN status = 'submitted' THEN error ELSE NULL END,
            updated_at = ?
        WHERE operation_key = ?
      `,
      args: [
        params.plan.walletAddress,
        params.config.usdcAddress,
        params.plan.payment.amount,
        params.payload.bounty.amount.toString(),
        params.payload.questions.length,
        "awaiting_wallet_signature",
        receipt,
        now,
        params.operation.operationKey,
      ],
    });
  }
}

function readStoredNativeX402Authorization(record: X402QuestionSubmissionRecord | null) {
  if (!record?.paymentReceipt) return null;
  try {
    const parsed = JSON.parse(record.paymentReceipt) as {
      authorization?: NativeX402PaymentAuthorizationInput;
      mode?: string;
    };
    return parsed.mode === "native-x402-authorization" || parsed.mode === "permissionless-x402-authorization"
      ? (parsed.authorization ?? null)
      : null;
  } catch {
    return null;
  }
}

function buildFeedbackBonusStatusBody(record: X402QuestionSubmissionRecord | null) {
  const feedbackBonus = parseStoredSubmissionPlanReceipt(record?.paymentReceipt ?? null)?.feedbackBonus;
  if (!feedbackBonus) {
    return {
      enabled: false,
      status: "not_requested",
    };
  }

  const status =
    feedbackBonus.status === "funded" || feedbackBonus.status === "failed"
      ? feedbackBonus.status
      : "pending_question_confirmation";

  return {
    amount: feedbackBonus.amount,
    asset: feedbackBonus.asset,
    awarder: feedbackBonus.awarder,
    enabled: true,
    error: feedbackBonus.error ?? null,
    feedbackClosesAt: feedbackBonus.feedbackClosesAt ?? null,
    poolId: feedbackBonus.poolId ?? null,
    roundId: feedbackBonus.roundId ?? null,
    status,
    transactionHashes: feedbackBonus.transactionHashes ?? [],
  };
}

async function updateStoredFeedbackBonusReceipt(params: {
  error?: string | null;
  feedbackClosesAt?: string;
  operationKey: `0x${string}`;
  poolId?: bigint | null;
  preparedAt?: Date | null;
  roundId?: bigint | string | null;
  status: StoredFeedbackBonusStatus;
  transactionHashes?: Hex[];
}) {
  const record = await getX402QuestionSubmissionByOperationKey(params.operationKey);
  const receipt = parseStoredSubmissionPlanReceipt(record?.paymentReceipt ?? null);
  if (!record || !receipt?.feedbackBonus) {
    throw new X402QuestionConflictError("Feedback Bonus was not requested for this ask.");
  }

  const now = new Date();
  const feedbackBonus: StoredFeedbackBonusRequest = {
    ...receipt.feedbackBonus,
    error: params.error ?? undefined,
    ...(params.feedbackClosesAt === undefined ? {} : { feedbackClosesAt: params.feedbackClosesAt }),
    ...(params.poolId === undefined ? {} : { poolId: params.poolId?.toString() }),
    ...(params.preparedAt ? { preparedAt: params.preparedAt.toISOString() } : {}),
    ...(params.roundId === undefined ? {} : { roundId: params.roundId?.toString() }),
    ...(params.status === "funded" ? { fundedAt: now.toISOString() } : {}),
    status: params.status,
    ...(params.transactionHashes ? { transactionHashes: params.transactionHashes } : {}),
  };
  const updatedReceipt = JSON.stringify({
    ...JSON.parse(record.paymentReceipt ?? "{}"),
    feedbackBonus,
  });
  await dbClient.execute({
    sql: `
      UPDATE x402_question_submissions
      SET payment_receipt = ?,
          updated_at = ?
      WHERE operation_key = ?
    `,
    args: [updatedReceipt, now, params.operationKey],
  });
}

function readOriginalClientRequestId(record: X402QuestionSubmissionRecord | null) {
  if (!record?.paymentReceipt) return null;
  try {
    const parsed = JSON.parse(record.paymentReceipt) as {
      originalClientRequestId?: unknown;
    };
    return typeof parsed.originalClientRequestId === "string" && parsed.originalClientRequestId.trim()
      ? parsed.originalClientRequestId
      : null;
  } catch {
    return null;
  }
}

function serializeQuestionBountyForResponse(bounty: X402QuestionPayload["bounty"]) {
  return {
    amount: bounty.amount.toString(),
    asset: bounty.asset,
    requiredVoters: bounty.requiredVoters.toString(),
    bountyEligibility: bounty.bountyEligibility.toString(),
  };
}

function agentWalletQuestionSubmissionPlanBody(params: {
  clientRequestId?: string;
  payload: X402QuestionPayload;
  plan: AgentWalletQuestionSubmissionPlan;
}) {
  return {
    bounty: serializeQuestionBountyForResponse(params.payload.bounty),
    chainId: params.payload.chainId,
    clientRequestId: params.clientRequestId ?? params.payload.clientRequestId,
    operationKey: params.plan.operationKey,
    payment: params.plan.payment,
    payloadHash: params.plan.payloadHash,
    questionCount: params.payload.questions.length,
    questionMetadataBaseUrl: questionMetadataBaseUrlForResponse(params.payload),
    ready: false,
    roundConfig: serializeQuestionRoundConfig(params.payload.roundConfig),
    status: "awaiting_wallet_signature",
    terminal: false,
    transactionPlan: {
      calls: params.plan.calls,
      requiresOrderedExecution: params.plan.requiresOrderedExecution,
    },
    paymentMode: "wallet_calls",
    wallet: {
      address: params.plan.walletAddress,
      fundingMode: "agent_wallet",
      note: "The wallet signer must execute every call; RateLoop does not receive bounty funds.",
    },
  };
}

function nativeX402QuestionSubmissionPlanBody(params: {
  clientRequestId?: string;
  payload: X402QuestionPayload;
  plan: NativeX402QuestionSubmissionPlan;
}) {
  const signed = Boolean(params.plan.authorization.signature);
  const questionMetadataBaseUrl = questionMetadataBaseUrlForResponse(params.payload);
  return {
    bounty: serializeQuestionBountyForResponse(params.payload.bounty),
    chainId: params.payload.chainId,
    clientRequestId: params.clientRequestId ?? params.payload.clientRequestId,
    nextAction: signed ? "submit_x402_transaction" : "sign_x402_authorization",
    operationKey: params.plan.operationKey,
    payment: params.plan.payment,
    paymentMode: "x402_authorization",
    paymentScheme: "eip3009_usdc_authorization",
    payloadHash: params.plan.payloadHash,
    questionCount: params.payload.questions.length,
    questionMetadataBaseUrl,
    ready: false,
    roundConfig: params.plan.roundConfig,
    status: "awaiting_wallet_signature",
    terminal: false,
    transactionPlan: signed
      ? {
          calls: params.plan.calls,
          requiresOrderedExecution: params.plan.requiresOrderedExecution,
        }
      : null,
    wallet: {
      address: params.plan.walletAddress,
      fundingMode: "x402_authorization",
      note: "Sign the EIP-3009 USDC authorization with this wallet; RateLoop does not custody funds.",
    },
    x402AuthorizationRequest: {
      authorization: params.plan.authorization,
      scheme: "eip3009_usdc_authorization",
      ...(questionMetadataBaseUrl ? { questionMetadataBaseUrl } : {}),
      eip712: buildNativeX402TypedData({
        authorization: params.plan.authorization,
        chainId: params.plan.chainId,
        tokenAddress: params.plan.payment.tokenAddress,
      }),
      submitTool: "rateloop_ask_humans",
    },
  };
}

function questionMetadataBaseUrlForResponse(payload: X402QuestionPayload) {
  const question = payload.questions[0];
  if (!question?.questionMetadataUri) return undefined;

  try {
    const parsed = new URL(question.questionMetadataUri);
    const suffix = `/question-metadata/${question.questionMetadataHash.toLowerCase()}`;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname.endsWith(suffix)) return undefined;
    const basePath = pathname.slice(0, -suffix.length);
    return `${parsed.origin}${basePath}`;
  } catch {
    return undefined;
  }
}

export async function prepareAgentWalletQuestionSubmissionRequest(params: {
  agentId: string;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  return prepareWalletQuestionSubmissionRequest({
    agentId: params.agentId,
    feedbackBonus: params.feedbackBonus,
    pendingCallback: params.pendingCallback,
    payload: params.payload,
    walletAddress: params.walletAddress,
  });
}

export async function preparePermissionlessWalletQuestionSubmissionRequest(params: {
  feedbackBonus?: X402FeedbackBonusRequest | null;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  return prepareWalletQuestionSubmissionRequest({
    agentId: null,
    feedbackBonus: params.feedbackBonus,
    mode: "permissionless-wallet-plan",
    originalClientRequestId: params.payload.clientRequestId,
    pendingCallback: params.pendingCallback,
    payload: toPermissionlessWalletPayload(params.payload, params.walletAddress),
    responseClientRequestId: params.payload.clientRequestId,
    walletAddress: params.walletAddress,
  });
}

async function prepareWalletQuestionSubmissionRequest(params: {
  agentId: string | null;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  mode?: WalletSubmissionReceiptMode;
  originalClientRequestId?: string;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  responseClientRequestId?: string;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  const dependencies = getQuestionSubmissionDependencies();
  const config = dependencies.resolveX402QuestionConfig(params.payload.chainId);
  const operation = buildX402QuestionOperation(params.payload);
  const existingRecord = await getX402QuestionSubmissionByClientRequest({
    chainId: params.payload.chainId,
    clientRequestId: params.payload.clientRequestId,
  });

  if (existingRecord && existingRecord.payloadHash !== operation.payloadHash) {
    throw new X402QuestionConflictError("clientRequestId has already been used for a different question payload.");
  }

  if (existingRecord?.status === "submitted") {
    return {
      body: x402QuestionSubmissionStatusBody({ config, operation, payload: params.payload, record: existingRecord }),
      status: 200,
    };
  }

  await assertApprovedAttachmentsForSubmission(params.payload, {
    agentId: params.agentId,
    ownerWalletAddress: params.walletAddress,
  });

  if (params.feedbackBonus) {
    throw new X402QuestionInputError("Feedback Bonus funding requires USDC x402 authorization for creation-time asks.");
  }

  const plan = await dependencies.buildAgentWalletQuestionSubmissionPlan({
    agentId: params.agentId,
    config,
    payload: params.payload,
    walletAddress: params.walletAddress,
  });
  await markGatedHostedAttachmentsForSubmission(params.payload, {
    agentId: params.agentId,
    ownerWalletAddress: params.walletAddress,
  });
  const pendingCallback = params.pendingCallback ?? readPendingAgentCallbackFromSubmissionRecord(existingRecord);
  await recordAgentWalletSubmissionPlan({
    agentId: params.agentId,
    config,
    feedbackBonus: params.feedbackBonus,
    mode: params.mode,
    operation,
    originalClientRequestId: params.originalClientRequestId,
    payload: params.payload,
    pendingCallback,
    plan,
  });

  return {
    body: agentWalletQuestionSubmissionPlanBody({
      clientRequestId: params.responseClientRequestId,
      payload: params.payload,
      plan,
    }),
    status: 202,
  };
}

export async function prepareNativeX402QuestionSubmissionRequest(params: {
  agentId: string;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  paymentAuthorization?: NativeX402PaymentAuthorizationInput | null;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  return prepareNativeQuestionSubmissionRequest({
    agentId: params.agentId,
    feedbackBonus: params.feedbackBonus,
    paymentAuthorization: params.paymentAuthorization,
    pendingCallback: params.pendingCallback,
    payload: params.payload,
    walletAddress: params.walletAddress,
  });
}

export async function preparePermissionlessNativeX402QuestionSubmissionRequest(params: {
  feedbackBonus?: X402FeedbackBonusRequest | null;
  paymentAuthorization?: NativeX402PaymentAuthorizationInput | null;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  return prepareNativeQuestionSubmissionRequest({
    agentId: null,
    feedbackBonus: params.feedbackBonus,
    mode: "permissionless-x402-authorization",
    originalClientRequestId: params.payload.clientRequestId,
    paymentAuthorization: params.paymentAuthorization,
    pendingCallback: params.pendingCallback,
    payload: toPermissionlessWalletPayload(params.payload, params.walletAddress),
    responseClientRequestId: params.payload.clientRequestId,
    walletAddress: params.walletAddress,
  });
}

async function prepareNativeQuestionSubmissionRequest(params: {
  agentId: string | null;
  feedbackBonus?: X402FeedbackBonusRequest | null;
  mode?: WalletSubmissionReceiptMode;
  originalClientRequestId?: string;
  paymentAuthorization?: NativeX402PaymentAuthorizationInput | null;
  payload: X402QuestionPayload;
  pendingCallback?: StoredPendingAgentCallback | null;
  responseClientRequestId?: string;
  walletAddress: Address;
}): Promise<{ body: unknown; status: number }> {
  const dependencies = getQuestionSubmissionDependencies();
  const config = dependencies.resolveX402QuestionConfig(params.payload.chainId);
  const operation = buildX402QuestionOperation(params.payload);
  const existingRecord = await getX402QuestionSubmissionByClientRequest({
    chainId: params.payload.chainId,
    clientRequestId: params.payload.clientRequestId,
  });

  if (existingRecord && existingRecord.payloadHash !== operation.payloadHash) {
    throw new X402QuestionConflictError("clientRequestId has already been used for a different question payload.");
  }

  if (existingRecord?.status === "submitted") {
    return {
      body: x402QuestionSubmissionStatusBody({ config, operation, payload: params.payload, record: existingRecord }),
      status: 200,
    };
  }

  await assertApprovedAttachmentsForSubmission(params.payload, {
    agentId: params.agentId,
    ownerWalletAddress: params.walletAddress,
  });

  if (params.feedbackBonus?.asset === "LREP") {
    throw new X402QuestionInputError("Feedback Bonus funding currently supports USDC x402 authorization only.");
  }

  const storedAuthorization = readStoredNativeX402Authorization(existingRecord);
  const plan = await dependencies.buildNativeX402QuestionSubmissionPlan({
    agentId: params.agentId,
    config,
    feedbackBonus: params.feedbackBonus,
    payload: params.payload,
    paymentAuthorization: params.paymentAuthorization ?? storedAuthorization,
    walletAddress: params.walletAddress,
  });
  await markGatedHostedAttachmentsForSubmission(params.payload, {
    agentId: params.agentId,
    ownerWalletAddress: params.walletAddress,
  });
  const pendingCallback = params.pendingCallback ?? readPendingAgentCallbackFromSubmissionRecord(existingRecord);
  await recordNativeX402SubmissionPlan({
    agentId: params.agentId,
    config,
    feedbackBonus: params.feedbackBonus,
    mode: params.mode,
    operation,
    originalClientRequestId: params.originalClientRequestId,
    payload: params.payload,
    pendingCallback,
    plan,
  });

  return {
    body: nativeX402QuestionSubmissionPlanBody({
      clientRequestId: params.responseClientRequestId,
      payload: params.payload,
      plan,
    }),
    status: 202,
  };
}

function assertTransactionHashes(value: Hex[]) {
  if (value.length === 0) {
    throw new X402QuestionConflictError("At least one transaction hash is required.");
  }
  for (const hash of value) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      throw new X402QuestionConflictError("transactionHashes must contain 32-byte hex transaction hashes.");
    }
  }
}

async function repairSubmittedFeedbackBonusReceipt(params: {
  dependencies: ReturnType<typeof getQuestionSubmissionDependencies>;
  record: X402QuestionSubmissionRecord;
}) {
  const planReceipt = parseStoredSubmissionPlanReceipt(params.record.paymentReceipt);
  const feedbackBonus = planReceipt?.feedbackBonus;
  if (!feedbackBonus || feedbackBonus.status === "funded" || feedbackBonus.poolId) {
    return params.record;
  }
  if (!params.record.payerAddress || !isAddress(params.record.payerAddress)) {
    return params.record;
  }
  const transactionHashes = parseStoredTransactionHashes(params.record.transactionHashes);
  if (transactionHashes.length === 0) {
    return params.record;
  }

  const config = params.dependencies.resolveX402QuestionConfig(params.record.chainId);
  if (!config.feedbackBonusEscrowAddress) {
    return params.record;
  }
  const publicClient = params.dependencies.createPublicQuestionClient(config);
  let createdPool: ReturnType<typeof readFeedbackBonusPoolCreated> | null = null;
  const receipts = await Promise.all(
    transactionHashes.map(hash => params.dependencies.waitForSuccessfulReceipt(publicClient, hash)),
  );
  for (const receipt of receipts) {
    createdPool = readFeedbackBonusPoolCreated(receipt, config.feedbackBonusEscrowAddress) ?? createdPool;
  }
  if (!createdPool) {
    return params.record;
  }

  assertConfirmedFeedbackBonusPool({
    contentIds: submittedRecordContentIds(params.record),
    createdPool,
    feedbackBonus,
    funderAddress: params.record.payerAddress as Address,
  });
  await storeConfirmedFeedbackBonusPool({
    createdPool,
    operationKey: params.record.operationKey,
    transactionHashes,
  });
  return (await getX402QuestionSubmissionByOperationKey(params.record.operationKey)) ?? params.record;
}

export async function confirmAgentWalletQuestionSubmissionRequest(params: {
  operationKey: `0x${string}`;
  transactionHashes: Hex[];
}): Promise<{ body: unknown; status: number }> {
  assertTransactionHashes(params.transactionHashes);
  const dependencies = getQuestionSubmissionDependencies();
  const record = await getX402QuestionSubmissionByOperationKey(params.operationKey);
  if (!record) {
    throw new X402QuestionConflictError("Agent wallet submission plan was not found.");
  }
  if (record.status === "submitted") {
    const repairedRecord = await repairSubmittedFeedbackBonusReceipt({ dependencies, record });
    return {
      body: normalizeSubmittedRecordBody(repairedRecord),
      status: 200,
    };
  }
  if (!record.payerAddress || !isAddress(record.payerAddress)) {
    throw new X402QuestionConflictError("Agent wallet submission plan is missing a wallet address.");
  }

  const config = dependencies.resolveX402QuestionConfig(record.chainId);
  const publicClient = dependencies.createPublicQuestionClient(config);
  const mediaValidatorAddress = await resolveSubmissionMediaValidator(publicClient, config.contentRegistryAddress);
  const walletAddress = record.payerAddress.toLowerCase();
  const bundleContentLinks: SubmittedBundleContentLink[] = [];
  let createdFeedbackBonusPool: ReturnType<typeof readFeedbackBonusPoolCreated> | null = null;
  const rewardAttachments: SubmittedRewardAttachment[] = [];
  const roundConfigsByContentId = new Map<string, SubmittedRoundConfig>();
  const submittedContents: SubmittedQuestionContent[] = [];
  const submittedDetails: SubmittedQuestionDetails[] = [];

  const receipts = await Promise.all(
    params.transactionHashes.map(hash => dependencies.waitForSuccessfulReceipt(publicClient, hash)),
  );
  for (const receipt of receipts) {
    const result = readSubmissionResult(receipt, config.contentRegistryAddress, mediaValidatorAddress);
    bundleContentLinks.push(...result.bundleContentLinks);
    submittedContents.push(...result.submittedContents);
    submittedDetails.push(...result.submittedDetails);
    rewardAttachments.push(...result.rewardAttachments);
    if (config.feedbackBonusEscrowAddress) {
      createdFeedbackBonusPool =
        readFeedbackBonusPoolCreated(receipt, config.feedbackBonusEscrowAddress) ?? createdFeedbackBonusPool;
    }
    for (const [contentId, roundConfig] of result.roundConfigsByContentId.entries()) {
      roundConfigsByContentId.set(contentId, roundConfig);
    }
  }

  if (submittedContents.length === 0) {
    throw new X402QuestionConflictError("Confirmed transactions did not include a RateLoop question submission.");
  }
  if (!submittedContents.some(content => normalizedAddress(content.submitter) === walletAddress)) {
    throw new X402QuestionConflictError("Confirmed submission was not emitted for the planned wallet address.");
  }
  const { bundleId, contentIds, rewardPoolId } = matchConfirmedSubmissionPlan({
    bundleContentLinks,
    record,
    rewardAttachments,
    roundConfigsByContentId,
    submittedContents,
    walletAddress: walletAddress as Lowercase<Address>,
  });
  const planReceipt = parseStoredSubmissionPlanReceipt(record.paymentReceipt);
  if (createdFeedbackBonusPool) {
    assertConfirmedFeedbackBonusPool({
      contentIds,
      createdPool: createdFeedbackBonusPool,
      feedbackBonus: planReceipt?.feedbackBonus,
      funderAddress: record.payerAddress as Address,
    });
  }
  await attachSubmittedQuestionDetails({
    agentId: planReceipt?.agentId,
    chainId: config.chainId,
    contentIds,
    contentRegistryAddress: config.contentRegistryAddress,
    deploymentKey: config.contentRegistryDeploymentKey,
    ownerWalletAddress: record.payerAddress as Address,
    submittedDetails,
  });
  await attachSubmittedQuestionImages({
    agentId: planReceipt?.agentId,
    chainId: config.chainId,
    contentIds,
    contentRegistryAddress: config.contentRegistryAddress,
    deploymentKey: config.contentRegistryDeploymentKey,
    ownerWalletAddress: record.payerAddress as Address,
    submittedContents,
  });
  await attachStoredQuestionAttachments({
    agentId: planReceipt?.agentId,
    chainId: config.chainId,
    contentIds,
    contentRegistryAddress: config.contentRegistryAddress,
    deploymentKey: config.contentRegistryDeploymentKey,
    ownerWalletAddress: record.payerAddress as Address,
    receipt: planReceipt,
  });
  await syncSubmittedQuestionMetadata({
    chainId: config.chainId,
    contentIds,
    contentRegistryAddress: config.contentRegistryAddress,
    deploymentKey: config.contentRegistryDeploymentKey,
    receipt: planReceipt,
  });

  await updateSubmissionStatus({
    bundleId,
    contentId: contentIds[0] ?? null,
    contentIds,
    operationKey: params.operationKey,
    rewardPoolId,
    status: "submitted",
    transactionHashes: params.transactionHashes,
  });
  if (createdFeedbackBonusPool) {
    await storeConfirmedFeedbackBonusPool({
      createdPool: createdFeedbackBonusPool,
      operationKey: params.operationKey,
      transactionHashes: params.transactionHashes,
    });
  }
  const updatedRecord = await getX402QuestionSubmissionByOperationKey(params.operationKey);
  return {
    body: normalizeSubmittedRecordBody(updatedRecord ?? record),
    status: 200,
  };
}

function normalizeSubmittedRecordBody(record: X402QuestionSubmissionRecord) {
  return {
    ...x402QuestionSubmissionRecordBody(record),
    ready: false,
    terminal: false,
  };
}

export function x402QuestionSubmissionRecordBody(record: X402QuestionSubmissionRecord | null) {
  if (!record) {
    return {
      status: "not_found",
    };
  }

  const expectedRewardTerms = parseStoredSubmissionPlanReceipt(record.paymentReceipt)?.expectedRewardTerms;

  return {
    bounty: {
      amount: record.bountyAmount,
      asset: submissionRewardAssetLabel(expectedRewardTerms?.asset),
      bountyEligibility: expectedRewardTerms?.bountyEligibility ?? "0",
    },
    bundleId: record.bundleId,
    chainId: record.chainId,
    clientRequestId: readOriginalClientRequestId(record) ?? record.clientRequestId,
    contentId: record.contentId,
    contentIds: record.contentIds ? parseStoredContentIds(record.contentIds) : [],
    error: record.error,
    feedbackBonus: buildFeedbackBonusStatusBody(record),
    operationKey: record.operationKey,
    payerAddress: record.payerAddress,
    payloadHash: record.payloadHash,
    payment: {
      amount: record.paymentAmount,
      asset: record.paymentAsset,
    },
    questionCount: record.questionCount,
    rewardPoolId: record.rewardPoolId,
    status: record.status,
    transactionHashes: parseStoredTransactionHashes(record.transactionHashes),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function __setX402QuestionSubmissionTestOverridesForTests(value: X402QuestionSubmissionTestOverrides | null) {
  x402QuestionSubmissionTestOverrides = value;
}
