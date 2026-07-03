import { RateLoopApiError, RateLoopSdkError } from "./errors";
import type { RateLoopFetch } from "./types";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONFIRM_TIMEOUT_MS = 210_000;
const DEFAULT_MCP_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_AGENT_API_PATH = "/api/agent";
const AGENT_AUTH_REQUIRED_MESSAGE =
  "RateLoop agent operations require apiBaseUrl for direct HTTP or mcpApiUrl for MCP. Add mcpAccessToken only for managed agent policies.";
const PLAINTEXT_RATING_FIELDS = [
  "direction",
  "isUp",
  "predictedUpBps",
  "predictedUpPercent",
  "prediction",
  "salt",
  "signal",
  "vote",
] as const;

export interface RateLoopAgentClientOptions {
  agentApiPath?: string;
  apiBaseUrl?: string;
  mcpApiUrl?: string;
  mcpAccessToken?: string;
  fetchImpl?: RateLoopFetch;
  quoteFetchImpl?: RateLoopFetch;
  timeoutMs?: number;
  confirmTimeoutMs?: number;
  mcpProtocolVersion?: string;
}

export interface RateLoopAgentQuestionItem {
  title: string;
  confidentiality?: RateLoopAgentQuestionConfidentiality;
  contextUrl?: string;
  categoryId: string | number | bigint;
  detailsHash?: `0x${string}` | string;
  detailsUrl?: string;
  tags: string | string[];
  imageUrls?: string[];
  videoUrl?: string;
  [key: string]: unknown;
}

export interface RateLoopAgentQuestionConfidentiality {
  visibility?: "public" | "gated";
  disclosurePolicy?:
    | "after_settlement"
    | "private_until_settlement"
    | "private_forever";
  bond?: {
    amount?: string | number | bigint;
    asset?: "LREP" | "USDC" | "lrep" | "usdc" | string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface RateLoopAgentBounty {
  asset?: "LREP" | "USDC" | "lrep" | "usdc" | string;
  amount: string | number | bigint;
  /** Must match roundConfig.minVoters when a custom roundConfig is supplied. */
  requiredVoters?: string | number | bigint;
  bountyEligibility?: string | number;
  [key: string]: unknown;
}

export interface RateLoopAgentFeedbackBonus {
  amount: string | number | bigint;
  asset?: "LREP" | "USDC" | "lrep" | "usdc" | string;
  awarder?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface RateLoopAgentRoundConfig {
  /** Shared duration for the blind window, bounty eligibility, and Feedback Bonus close. */
  questionDurationSeconds?: string | number | bigint;
  /** Must match bounty.requiredVoters. */
  minVoters?: string | number | bigint;
  maxVoters?: string | number | bigint;
  [key: string]: unknown;
}

export interface RateLoopAgentQuestionRequest {
  clientRequestId: string;
  chainId?: number;
  dryRun?: boolean;
  executionMode?: "dry_run";
  confidentiality?: RateLoopAgentQuestionConfidentiality;
  question?: RateLoopAgentQuestionItem;
  questions?: RateLoopAgentQuestionItem[];
  bounty: RateLoopAgentBounty;
  feedbackBonus?: RateLoopAgentFeedbackBonus;
  roundConfig?: RateLoopAgentRoundConfig;
  walletAddress?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface QuoteQuestionRequest extends RateLoopAgentQuestionRequest {}

export interface AskHumansRequest extends RateLoopAgentQuestionRequest {
  maxPaymentAmount?: string | number | bigint;
  mode?: "dry_run";
  paymentAuthorization?: {
    from?: `0x${string}` | string;
    nonce?: `0x${string}` | string;
    signature?: `0x${string}` | string;
    to?: `0x${string}` | string;
    validAfter?: string | number | bigint;
    validBefore?: string | number | bigint;
    value?: string | number | bigint;
    [key: string]: unknown;
  };
  paymentMode?:
    | "wallet_calls"
    | "eip3009_usdc_authorization"
    | "x402_authorization";
  signatureMode?: "agent_signs" | "browser_link";
  transport?: "http" | "mcp";
  webhookChallengeId?: string;
  webhookEvents?: string[];
  webhookSecret?: string;
  webhookSignature?: `0x${string}` | string;
  webhookUrl?: string;
}

export interface PrepareImageUploadRequest {
  attachmentId?: string;
  clientRequestId?: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | string;
  sha256: string;
  sizeBytes: number;
  walletAddress?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface UploadImageRequest {
  attachmentId?: string;
  challengeId?: string;
  clientRequestId?: string;
  dataUrl?: string;
  filename: string;
  imageBase64?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp" | string;
  sha256?: string;
  signature?: `0x${string}` | string;
  sizeBytes?: number;
  walletAddress?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface ImageUploadStatusLookup {
  attachmentId: string;
}

export interface PrepareImageUploadResponse {
  attachmentId: string;
  authMode?: "managed_agent" | "wallet_signature" | string;
  challengeId?: string | null;
  expiresAt?: string | null;
  maxSizeBytes?: number;
  message?: string | null;
  nextAction?: string;
  nextTool?: string;
  requestUrl?: string;
  signatureRequired?: boolean;
  supportedMimeTypes?: string[];
  walletAddress?: string | null;
  [key: string]: unknown;
}

export interface ImageUploadResponse {
  attachmentId: string;
  error?: string | null;
  height?: number | null;
  imageUrl?: string | null;
  moderationStatus?: string;
  nextAction?: string;
  status:
    | "uploading"
    | "processing"
    | "approved"
    | "blocked"
    | "failed"
    | "deleted"
    | string;
  width?: number | null;
  [key: string]: unknown;
}

export interface ConfirmAskTransactionsRequest {
  operationKey: `0x${string}` | string;
  transactionHashes: (`0x${string}` | string)[];
}

export type ConfirmFeedbackBonusTransactionsRequest =
  ConfirmAskTransactionsRequest;

export interface RatingContentLookup {
  chainId?: number;
  contentId: string | number | bigint;
  walletAddress?: `0x${string}` | string;
}

export interface GetRatingContextRequest extends RatingContentLookup {
  stakeWei?: string | number | bigint;
}

export interface AcceptConfidentialityTermsRequest extends RatingContentLookup {
  challengeId?: string;
  signature?: `0x${string}` | string;
  termsVersion?: string;
}

export interface PrepareRatingTransactionsRequest extends RatingContentLookup {
  ciphertext: `0x${string}` | string;
  commitHash: `0x${string}` | string;
  drandChainHash: `0x${string}` | string;
  frontend: `0x${string}` | string;
  roundId: string | number | bigint;
  roundReferenceRatingBps: number;
  stakeWei: string | number | bigint;
  targetRound: string | number | bigint;
}

export interface ConfirmRatingTransactionsRequest extends RatingContentLookup {
  commitHash?: `0x${string}` | string;
  roundId?: string | number | bigint;
  transactionHashes: (`0x${string}` | string)[];
}

export interface RatingStatusLookup extends RatingContentLookup {
  roundId?: string | number | bigint;
}

export interface QuestionStatusLookup {
  operationKey?: `0x${string}` | string;
  chainId?: number;
  clientRequestId?: string;
  walletAddress?: `0x${string}` | string;
}

export interface CreateSigningIntentRequest {
  request: AskHumansRequest;
  ttlMs?: number;
}

export interface RateLoopAgentGeneratedImage {
  dataUrl?: string;
  filename?: string;
  imageBase64?: string;
  mimeType?: "image/jpeg" | "image/png" | "image/webp" | string;
  sha256?: string;
  sizeBytes?: number;
  [key: string]: unknown;
}

export type CreateAskHandoffRequest =
  | (AskHumansRequest & {
      generatedImages?: RateLoopAgentGeneratedImage[];
      request?: never;
      ttlMs?: number;
    })
  | {
      generatedImages?: RateLoopAgentGeneratedImage[];
      request: AskHumansRequest;
      ttlMs?: number;
    };

export interface AskHandoffLookup {
  handoffId: string;
  handoffToken: string;
}

export interface SigningIntentLookup {
  intentId: string;
  token: string;
}

export interface PrepareSigningIntentRequest extends SigningIntentLookup {
  walletAddress: `0x${string}` | string;
  paymentAuthorization?: AskHumansRequest["paymentAuthorization"];
}

export interface CompleteSigningIntentRequest extends SigningIntentLookup {
  transactionHashes: (`0x${string}` | string)[];
}

export interface RateLoopAgentPayment {
  amount?: string;
  asset?: string;
  bountyAmount?: string;
  decimals?: number;
  feedbackBonusAmount?: string;
  spender?: string;
  tokenAddress?: string;
  totalAmount?: string;
  [key: string]: unknown;
}

export interface RateLoopAgentWalletTransactionCall {
  data?: `0x${string}` | string;
  description?: string;
  functionName?: string;
  id?: string;
  phase?:
    | "approve_usdc"
    | "approve_lrep"
    | "commit_rating"
    | "open_round"
    | "record_advisory_vote"
    | "reserve_submission"
    | "submit_question"
    | "submit_x402_question"
    | string;
  to?: `0x${string}` | string;
  value?: string;
  waitAfterMs?: number;
  [key: string]: unknown;
}

export interface RateLoopAgentWalletTransactionPlan {
  calls?: RateLoopAgentWalletTransactionCall[];
  requiresAtomicExecution?: boolean;
  requiresOrderedExecution?: boolean;
  [key: string]: unknown;
}

export interface RateLoopAgentWalletInfo {
  address?: `0x${string}` | string;
  fundingMode?:
    | "agent_wallet"
    | "eip3009_usdc_authorization"
    | "x402_authorization"
    | string;
  note?: string;
  [key: string]: unknown;
}

export interface RateLoopAgentFeedbackBonusState {
  amount?: string;
  asset?: string;
  awarder?: string;
  /** Escrow feedback close once the creation-time bonus is funded. */
  feedbackClosesAt?: string;
  awardDeadline?: string;
  poolId?: string | null;
  status?: "pending_question_confirmation" | "funded" | "failed" | string;
  [key: string]: unknown;
}

export interface RateLoopAgentFastLaneGuidance {
  conservativeStartingBountyAtomic?: string;
  estimatedResultAt?: number;
  estimatedTimeToResultSeconds?: number;
  expectedResponse?: {
    healthyTargetVoters?: string;
    likelyOutcome?: "thin" | "healthy" | "broad" | string;
    minimumExpectedVoters?: string;
    [key: string]: unknown;
  };
  guidance?: string[];
  minimumViableQuorum?: string;
  perRequiredSignalUnitAtomic?: string;
  pricingConfidence?: "low" | "medium" | "high" | string;
  recommendedAction?:
    | "start_small"
    | "raise_before_submit"
    | "adjust_round_window"
    | string;
  requiredSignalUnits?: string;
  speed?: "fast" | "standard" | "slow" | string;
  stretchBountyAmountAtomic?: string;
  suggestedBountyAmountAtomic?: string;
  warnings?: string[];
  [key: string]: unknown;
}

export interface RateLoopAgentLiveAskGuidance {
  lowResponseRisk?: "low" | "medium" | "high" | string;
  reasonCodes?: string[];
  recommendedAction?:
    | "wait"
    | "create_replacement_ask"
    | "retry_later"
    | string;
  suggestedReplacementBountyAtomic?: string | null;
  [key: string]: unknown;
}

export interface QuoteQuestionResponse {
  canSubmit?: boolean;
  clientRequestId?: string;
  dryRun?: boolean;
  executionMode?: "dry_run" | string;
  fastLane?: RateLoopAgentFastLaneGuidance;
  feedbackBonus?: RateLoopAgentFeedbackBonusState;
  feedbackBonusGuidance?: JsonRecord;
  operationKey?: `0x${string}` | string;
  payloadHash?: string;
  payment?: RateLoopAgentPayment;
  paymentRequired?: boolean;
  questionCount?: number;
  resolvedCategoryIds?: string[];
  walletPolicyRequired?: boolean;
  [key: string]: unknown;
}

export interface AskHumansResponse {
  clientRequestId?: string;
  operationKey?: `0x${string}` | string;
  contentId?: string | null;
  contentIds?: string[];
  fastLane?: RateLoopAgentFastLaneGuidance;
  feedbackBonus?: RateLoopAgentFeedbackBonusState;
  feedbackBonusGuidance?: JsonRecord;
  dryRun?: boolean;
  executionMode?: "dry_run" | string;
  managedBudget?: JsonRecord | null;
  nextAction?: string | null;
  pollAfterMs?: number | null;
  publicUrl?: string | null;
  ready?: boolean;
  resultTool?: string | null;
  terminal?: boolean;
  status?: string;
  statusTool?: string;
  confirmTool?: string;
  payment?: RateLoopAgentPayment;
  paymentRequired?: boolean;
  paymentMode?: "wallet_calls" | "x402_authorization" | string;
  paymentScheme?: "wallet_calls" | "eip3009_usdc_authorization" | string;
  questionMetadataBaseUrl?: string;
  rewardPoolId?: string | null;
  transactionPlan?: RateLoopAgentWalletTransactionPlan;
  transactionHashes?: string[];
  wallet?: RateLoopAgentWalletInfo;
  webhook?: JsonRecord | null;
  warnings?: string[];
  x402AuthorizationRequest?: JsonRecord | null;
  [key: string]: unknown;
}

export interface SigningIntentResponse extends AskHumansResponse {
  id: string;
  signingUrl?: string;
  expiresAt: string;
  requestBody?: JsonRecord;
}

export interface AskHandoffResponse extends AskHumansResponse {
  handoffId?: string;
  handoffToken?: string;
  handoffUrl?: string;
  id: string;
  requestBody?: JsonRecord;
}

export interface CallbackDeliveryStatus {
  attemptCount: number;
  callbackUrl: string;
  deliveredAt?: string | null;
  eventId: string;
  eventType: string;
  lastError?: string | null;
  nextAttemptAt: string;
  status: "pending" | "delivering" | "retrying" | "delivered" | "dead";
  subscriptionId: string;
  [key: string]: unknown;
}

export interface QuestionStatusResponse {
  bounty?: JsonRecord;
  bundleId?: string | null;
  callbackDeliveries?: CallbackDeliveryStatus[];
  chainId?: number;
  clientRequestId?: string;
  contentId?: string | null;
  contentIds?: string[];
  error?: string | null;
  feedbackBonus?: RateLoopAgentFeedbackBonusState;
  nextAction?: string | null;
  operationKey?: `0x${string}` | string;
  payerAddress?: string;
  payloadHash?: string;
  payment?: RateLoopAgentPayment;
  pollAfterMs?: number | null;
  publicUrl?: string | null;
  questionCount?: number;
  ready?: boolean;
  liveAskGuidance?: RateLoopAgentLiveAskGuidance | null;
  rewardPoolId?: string | null;
  resultTool?: string | null;
  status: string;
  terminal?: boolean;
  transactionHashes?: string[];
  updatedAt?: string;
  [key: string]: unknown;
}

export interface RateLoopRatingPrivacy {
  inputMode?: "local_encrypted_commit" | string;
  note?: string;
  [key: string]: unknown;
}

export interface RateLoopRatingContent {
  categoryId?: string | number;
  confidentiality?: JsonRecord | null;
  contextAccess?: "public" | "gated" | string;
  contextVisibility?: "public" | "gated" | string;
  description?: string | null;
  gatedContext?:
    | (JsonRecord & {
        fetch?: RateLoopGatedContextFetchInfo;
        status?: string;
        termsAccepted?: boolean;
      })
    | null;
  id?: string | number;
  publicUrl?: string | null;
  submitter?: `0x${string}` | string;
  title?: string | null;
  [key: string]: unknown;
}

export interface RateLoopGatedContextFetchUrl {
  kind?: "details" | "image" | string;
  resourceId?: string;
  sha256?: string | null;
  url: string;
  [key: string]: unknown;
}

export interface RateLoopGatedContextFetchInfo {
  delivery?: "authenticated_fetch_urls" | string;
  method?: "GET" | string;
  request?: {
    cookieHeader?: string | null;
    cookieHeaderFrom?: string | null;
    query?: Record<string, string>;
    [key: string]: unknown;
  };
  signedReadSessionRequired?: boolean;
  urls?: RateLoopGatedContextFetchUrl[];
  [key: string]: unknown;
}

export interface RateLoopSignedReadSession {
  cookieHeader?: string;
  cookieName?: string;
  cookieValue?: string;
  expiresAt?: string;
  scope?: "gated_context" | string;
  [key: string]: unknown;
}

export interface RateLoopRatingContracts {
  advisoryVoteRecorder?: `0x${string}` | string | null;
  lrep?: `0x${string}` | string;
  votingEngine?: `0x${string}` | string;
  [key: string]: unknown;
}

export interface RateLoopRatingRuntime {
  baseTotalStake?: string;
  baseVoteCount?: string;
  drandChainHash?: `0x${string}` | string;
  drandGenesisTimeSeconds?: string;
  drandPeriodSeconds?: string;
  epochDuration?: number;
  requiresOpenRound?: boolean;
  roundId?: string;
  roundReferenceRatingBps?: number;
  roundStartTimeSeconds?: number | null;
  targetRound?: string;
  [key: string]: unknown;
}

export interface RatingContextResponse {
  chainId?: number;
  content?: RateLoopRatingContent;
  contracts?: RateLoopRatingContracts;
  currentAllowance?: string;
  localCommitInstructions?: JsonRecord;
  openRoundTransactionPlan?: RateLoopAgentWalletTransactionPlan | null;
  privacy?: RateLoopRatingPrivacy;
  publicUrl?: string | null;
  ratingInputMode?: "local_encrypted_commit" | string;
  runtime?: RateLoopRatingRuntime;
  status: "ready" | "open_round_required" | string;
  wallet?: RateLoopAgentWalletInfo;
  [key: string]: unknown;
}

export interface AcceptConfidentialityTermsResponse {
  accepted: boolean;
  challengeId?: string | null;
  contentId?: string;
  contextAccess?: "public" | "gated" | string;
  expiresAt?: string | null;
  gatedContext?: (RateLoopGatedContextFetchInfo & { status?: string }) | null;
  message?: string | null;
  nextAction?: string;
  signatureRequired?: boolean;
  signedReadSession?: RateLoopSignedReadSession | null;
  status: "accepted" | "not_required" | "signature_required" | string;
  termsDocHash?: string;
  termsUri?: string;
  termsVersion?: string;
  wallet?: RateLoopAgentWalletInfo;
  [key: string]: unknown;
}

export interface PrepareRatingTransactionsResponse {
  chainId?: number;
  commit?: JsonRecord;
  confirmTool?: string;
  contentId?: string;
  isAdvisoryVote?: boolean;
  privacy?: RateLoopRatingPrivacy;
  publicUrl?: string | null;
  roundId?: string;
  stakeWei?: string;
  status: "awaiting_wallet_signature" | string;
  statusTool?: string;
  transactionPlan?: RateLoopAgentWalletTransactionPlan;
  wallet?: RateLoopAgentWalletInfo;
  [key: string]: unknown;
}

export interface RatingStatusResponse {
  chainId?: number;
  commitHash?: `0x${string}` | string | null;
  confirmed?: boolean;
  contentId?: string;
  isAdvisoryVote?: boolean;
  publicUrl?: string | null;
  roundId?: string | null;
  status: "not_found" | "awaiting_reveal" | "committed" | "revealed" | string;
  transactionHashes?: string[];
  wallet?: RateLoopAgentWalletInfo;
  [key: string]: unknown;
}

export type RateLoopAgentAnswer =
  | "pending"
  | "proceed"
  | "proceed_with_caution"
  | "revise_and_resubmit"
  | "do_not_proceed"
  | "inconclusive"
  | "failed";

export interface RateLoopAgentResult {
  ready: boolean;
  answer?: RateLoopAgentAnswer | string;
  status?: string;
  operation?: JsonRecord | null;
  result?: unknown;
  confidence?: {
    level?: "none" | "low" | "medium" | "high" | string;
    score?: number;
    [key: string]: unknown;
  };
  cohortSummary?: JsonRecord | null;
  distribution?: JsonRecord;
  voteCount?: number;
  stakeMass?: JsonRecord;
  rationaleSummary?: string;
  majorObjections?: JsonRecord[];
  featureTest?: JsonRecord | null;
  dissentingView?: string | null;
  liveAskGuidance?: RateLoopAgentLiveAskGuidance | null;
  recommendedNextAction?: string;
  publicUrl?: string | null;
  methodology?: JsonRecord;
  limitations?: string[];
  protocolState?: JsonRecord;
  [key: string]: unknown;
}

export interface AgentResultTemplate {
  bundleStrategy?: "independent" | "rank_by_rating" | string;
  id: string;
  description?: string;
  interpretation?: JsonRecord;
  ratingSystem?: string;
  recommendedUse?: string[];
  resultSpecHash?: `0x${string}` | string;
  submissionPattern?: "single_question" | "bundle_member" | string;
  templateInputsExample?: JsonValue;
  templateInputsSchema?: JsonRecord;
  title?: string;
  version: number;
  voteSemantics?: {
    up: string;
    down: string;
  };
  [key: string]: unknown;
}

export interface ListResultTemplatesResponse {
  templates: AgentResultTemplate[];
  [key: string]: unknown;
}

export interface RateLoopAgentClient {
  quoteQuestion(params: QuoteQuestionRequest): Promise<QuoteQuestionResponse>;
  askHumans(params: AskHumansRequest): Promise<AskHumansResponse>;
  prepareImageUpload(
    params: PrepareImageUploadRequest,
  ): Promise<PrepareImageUploadResponse>;
  uploadImage(params: UploadImageRequest): Promise<ImageUploadResponse>;
  getImageUploadStatus(
    params: ImageUploadStatusLookup,
  ): Promise<ImageUploadResponse>;
  createAskHandoff(
    params: CreateAskHandoffRequest,
  ): Promise<AskHandoffResponse>;
  getAskHandoffStatus(params: AskHandoffLookup): Promise<AskHandoffResponse>;
  createSigningIntent(
    params: CreateSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  getSigningIntent(params: SigningIntentLookup): Promise<SigningIntentResponse>;
  prepareSigningIntent(
    params: PrepareSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  completeSigningIntent(
    params: CompleteSigningIntentRequest,
  ): Promise<SigningIntentResponse>;
  confirmAskTransactions(
    params: ConfirmAskTransactionsRequest,
  ): Promise<QuestionStatusResponse>;
  confirmFeedbackBonusTransactions(
    params: ConfirmFeedbackBonusTransactionsRequest,
  ): Promise<QuestionStatusResponse>;
  getRatingContext(
    params: GetRatingContextRequest,
  ): Promise<RatingContextResponse>;
  acceptConfidentialityTerms(
    params: AcceptConfidentialityTermsRequest,
  ): Promise<AcceptConfidentialityTermsResponse>;
  prepareRatingTransactions(
    params: PrepareRatingTransactionsRequest,
  ): Promise<PrepareRatingTransactionsResponse>;
  confirmRatingTransactions(
    params: ConfirmRatingTransactionsRequest,
  ): Promise<RatingStatusResponse>;
  getRatingStatus(params: RatingStatusLookup): Promise<RatingStatusResponse>;
  getQuestionStatus(
    params: QuestionStatusLookup,
  ): Promise<QuestionStatusResponse>;
  getResult(
    params: QuestionStatusLookup & { contentId?: string | bigint },
  ): Promise<RateLoopAgentResult>;
  listResultTemplates(): Promise<ListResultTemplatesResponse>;
}

export interface WebhookVerifierBaseOptions {
  secret: string;
  eventIdHeader?: string;
  signatureHeader?: string;
  timestampHeader?: string;
  toleranceSeconds?: number;
}

export type ReplayProtectedWebhookVerifierOptions =
  WebhookVerifierBaseOptions & {
    allowReplay?: never;
    replayProtection: WebhookReplayProtectionOptions;
  };

export type SignatureOnlyWebhookVerifierOptions = WebhookVerifierBaseOptions & {
  allowReplay: true;
  replayProtection?: never;
};

export type WebhookVerifierOptions =
  | ReplayProtectedWebhookVerifierOptions
  | SignatureOnlyWebhookVerifierOptions;

export interface VerifyWebhookParams {
  body: string | Uint8Array | ArrayBuffer | JsonValue | JsonRecord;
  headers: Headers | Record<string, string | string[] | undefined | null>;
  now?: Date | number;
}

export interface VerifiedWebhook {
  body: string;
  eventId: string;
  headers: VerifyWebhookParams["headers"];
  timestamp: string;
}

export interface WebhookReplayStore {
  claim(
    key: string,
    event: VerifiedWebhook,
    options: { ttlSeconds: number },
  ): Promise<boolean>;
  complete?(
    key: string,
    event: VerifiedWebhook,
    options: { ttlSeconds: number },
  ): Promise<void>;
  release?(
    key: string,
    event: VerifiedWebhook,
    options: { ttlSeconds: number },
  ): Promise<void>;
}

export interface WebhookReplayProtectionOptions {
  keyPrefix?: string;
  store: WebhookReplayStore;
  ttlSeconds?: number;
}

export type WebhookHandleOnceResult<T> =
  | { event: VerifiedWebhook; status: "duplicate" }
  | { event: VerifiedWebhook; status: "processed"; value: T };

export interface WebhookVerifier {
  verify(params: VerifyWebhookParams): Promise<boolean>;
  assertValid(params: VerifyWebhookParams): Promise<void>;
}

export interface ReplayProtectedWebhookVerifier extends WebhookVerifier {
  handleOnce<T>(
    params: VerifyWebhookParams,
    handler: (event: VerifiedWebhook) => Promise<T> | T,
  ): Promise<WebhookHandleOnceResult<T>>;
}

interface NormalizedAgentConfig {
  agentApiPath: string;
  apiBaseUrl?: string;
  mcpApiUrl?: string;
  mcpAccessToken?: string;
  fetchImpl: RateLoopFetch;
  quoteFetchImpl: RateLoopFetch;
  timeoutMs: number;
  confirmTimeoutMs: number;
  mcpProtocolVersion: string;
}

export function createRateLoopAgentClient(
  options: RateLoopAgentClientOptions = {},
): RateLoopAgentClient {
  const config = normalizeAgentConfig(options);

  return {
    quoteQuestion: (params) => quoteQuestion(params, config),
    askHumans: (params) => askHumans(params, config),
    prepareImageUpload: (params) => prepareImageUpload(params, config),
    uploadImage: (params) => uploadImage(params, config),
    getImageUploadStatus: (params) => getImageUploadStatus(params, config),
    createAskHandoff: (params) => createAskHandoff(params, config),
    getAskHandoffStatus: (params) => getAskHandoffStatus(params, config),
    createSigningIntent: (params) => createSigningIntent(params, config),
    getSigningIntent: (params) => getSigningIntent(params, config),
    prepareSigningIntent: (params) => prepareSigningIntent(params, config),
    completeSigningIntent: (params) => completeSigningIntent(params, config),
    confirmAskTransactions: (params) => confirmAskTransactions(params, config),
    confirmFeedbackBonusTransactions: (params) =>
      confirmFeedbackBonusTransactions(params, config),
    getRatingContext: (params) => getRatingContext(params, config),
    acceptConfidentialityTerms: (params) =>
      acceptConfidentialityTerms(params, config),
    prepareRatingTransactions: (params) =>
      prepareRatingTransactions(params, config),
    confirmRatingTransactions: (params) =>
      confirmRatingTransactions(params, config),
    getRatingStatus: (params) => getRatingStatus(params, config),
    getQuestionStatus: (params) => getQuestionStatus(params, config),
    getResult: (params) => getResult(params, config),
    listResultTemplates: () => listResultTemplates(config),
  };
}

export function quoteQuestion(
  params: QuoteQuestionRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<QuoteQuestionResponse> {
  assertSafeAskIntegerFields(params);
  const config = normalizeAgentConfig(options);
  const requestConfig = quoteRequestConfig(config);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuoteQuestionResponse>(
      requestConfig,
      agentQuoteUrl(config),
      {
        body: stringifyJson(params),
        headers: jsonAgentHeaders(config),
        method: "POST",
      },
    );
  }

  return callMcpTool<QuoteQuestionResponse>(
    requestConfig,
    "rateloop_quote_question",
    params,
  );
}

export async function askHumans(
  params: AskHumansRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<AskHumansResponse> {
  assertSafeAskIntegerFields(params);
  const config = normalizeAgentConfig(options);
  const { transport, ...body } = params;

  if (transport === "http") {
    return requestJson<AskHumansResponse>(config, agentAsksUrl(config), {
      body: stringifyJson(body),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  if (transport !== "mcp" && hasDirectAgentHttp(config)) {
    return requestJson<AskHumansResponse>(config, agentAsksUrl(config), {
      body: stringifyJson(body),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  if (transport === "mcp" || config.mcpApiUrl) {
    return callMcpTool<AskHumansResponse>(config, "rateloop_ask_humans", body);
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export function prepareImageUpload(
  params: PrepareImageUploadRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<PrepareImageUploadResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<PrepareImageUploadResponse>(
    config,
    "rateloop_prepare_image_upload",
    { ...params },
  );
}

export function uploadImage(
  params: UploadImageRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<ImageUploadResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<ImageUploadResponse>(config, "rateloop_upload_image", {
    ...params,
  });
}

export function getImageUploadStatus(
  params: ImageUploadStatusLookup,
  options: RateLoopAgentClientOptions = {},
): Promise<ImageUploadResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<ImageUploadResponse>(
    config,
    "rateloop_get_image_upload_status",
    { ...params },
  );
}

export async function createAskHandoff(
  params: CreateAskHandoffRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<AskHandoffResponse> {
  assertSafeAskHandoffIntegerFields(params);
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<AskHandoffResponse>(config, agentHandoffsUrl(config), {
      body: stringifyJson(params),
      headers: jsonAgentHeaders(config),
      method: "POST",
    });
  }

  if (config.mcpApiUrl) {
    return callMcpTool<AskHandoffResponse>(
      config,
      "rateloop_create_ask_handoff_link",
      { ...params } as JsonRecord,
    );
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function getAskHandoffStatus(
  params: AskHandoffLookup,
  options: RateLoopAgentClientOptions = {},
): Promise<AskHandoffResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<AskHandoffResponse>(
      config,
      agentHandoffUrl(config, params),
      {
        headers: handoffReadHeaders(config, params),
        method: "GET",
      },
    );
  }

  if (config.mcpApiUrl) {
    return callMcpTool<AskHandoffResponse>(
      config,
      "rateloop_get_handoff_status",
      { ...params },
    );
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function createSigningIntent(
  params: CreateSigningIntentRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  assertSafeAskIntegerFields(params.request);
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new RateLoopSdkError(
      "apiBaseUrl is required to create browser signing links",
    );
  }

  return requestJson<SigningIntentResponse>(
    config,
    agentSigningIntentsUrl(config),
    {
      body: stringifyJson(params),
      headers: jsonAgentHeaders(config),
      method: "POST",
    },
  );
}

export async function getSigningIntent(
  params: SigningIntentLookup,
  options: RateLoopAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new RateLoopSdkError(
      "apiBaseUrl is required to read browser signing links",
    );
  }

  return requestJson<SigningIntentResponse>(
    config,
    agentSigningIntentUrl(config, params),
    {
      headers: signingIntentReadHeaders(config, params),
      method: "GET",
    },
  );
}

export async function prepareSigningIntent(
  params: PrepareSigningIntentRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new RateLoopSdkError(
      "apiBaseUrl is required to prepare browser signing links",
    );
  }

  return requestJson<SigningIntentResponse>(
    config,
    agentSigningIntentActionUrl(config, params, "prepare"),
    {
      body: stringifyJson({
        paymentAuthorization: params.paymentAuthorization,
        token: params.token,
        walletAddress: params.walletAddress,
      }),
      headers: jsonAgentHeaders(config),
      method: "POST",
    },
  );
}

export async function completeSigningIntent(
  params: CompleteSigningIntentRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<SigningIntentResponse> {
  const config = normalizeAgentConfig(options);
  if (!hasDirectAgentHttp(config)) {
    throw new RateLoopSdkError(
      "apiBaseUrl is required to complete browser signing links",
    );
  }

  return requestJson<SigningIntentResponse>(
    config,
    agentSigningIntentActionUrl(config, params, "complete"),
    {
      body: stringifyJson({
        token: params.token,
        transactionHashes: params.transactionHashes,
      }),
      headers: jsonAgentHeaders(config),
      method: "POST",
    },
  );
}

export async function confirmAskTransactions(
  params: ConfirmAskTransactionsRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<QuestionStatusResponse> {
  const config = normalizeAgentConfig(options);
  const requestConfig = confirmRequestConfig(config);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuestionStatusResponse>(
      requestConfig,
      agentConfirmAskUrl(config, params.operationKey),
      {
        body: stringifyJson({ transactionHashes: params.transactionHashes }),
        headers: jsonAgentHeaders(config),
        method: "POST",
      },
    );
  }

  if (config.mcpApiUrl) {
    return callMcpTool<QuestionStatusResponse>(
      requestConfig,
      "rateloop_confirm_ask_transactions",
      { ...params },
    );
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function confirmFeedbackBonusTransactions(
  params: ConfirmFeedbackBonusTransactionsRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<QuestionStatusResponse> {
  const config = normalizeAgentConfig(options);
  const requestConfig = confirmRequestConfig(config);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuestionStatusResponse>(
      requestConfig,
      agentConfirmFeedbackBonusUrl(config, params.operationKey),
      {
        body: stringifyJson({ transactionHashes: params.transactionHashes }),
        headers: jsonAgentHeaders(config),
        method: "POST",
      },
    );
  }

  if (config.mcpApiUrl) {
    return callMcpTool<QuestionStatusResponse>(
      requestConfig,
      "rateloop_confirm_feedback_bonus_transactions",
      { ...params },
    );
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function getRatingContext(
  params: GetRatingContextRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<RatingContextResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<RatingContextResponse>(
    config,
    "rateloop_get_rating_context",
    ratingLookupArgs(params),
  );
}

export async function acceptConfidentialityTerms(
  params: AcceptConfidentialityTermsRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<AcceptConfidentialityTermsResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<AcceptConfidentialityTermsResponse>(
    config,
    "rateloop_accept_confidentiality_terms",
    {
      ...ratingLookupArgs(params),
      challengeId: params.challengeId,
      signature: params.signature,
      termsVersion: params.termsVersion,
    },
  );
}

export async function prepareRatingTransactions(
  params: PrepareRatingTransactionsRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<PrepareRatingTransactionsResponse> {
  assertNoPlaintextRatingFields(params as unknown as JsonRecord);
  const config = normalizeAgentConfig(options);
  const lookupArgs = ratingLookupArgs(params);
  return callMcpTool<PrepareRatingTransactionsResponse>(
    config,
    "rateloop_prepare_rating_transactions",
    {
      ...lookupArgs,
      ciphertext: params.ciphertext,
      commitHash: params.commitHash,
      drandChainHash: params.drandChainHash,
      frontend: params.frontend,
      roundId: ratingIntegerArg(params.roundId, "request.roundId"),
      roundReferenceRatingBps: ratingReferenceBpsArg(
        params.roundReferenceRatingBps,
        "request.roundReferenceRatingBps",
      ),
      stakeWei: ratingIntegerArg(params.stakeWei, "request.stakeWei"),
      targetRound: ratingIntegerArg(params.targetRound, "request.targetRound"),
    },
  );
}

export async function confirmRatingTransactions(
  params: ConfirmRatingTransactionsRequest,
  options: RateLoopAgentClientOptions = {},
): Promise<RatingStatusResponse> {
  const config = normalizeAgentConfig(options);
  const requestConfig = confirmRequestConfig(config);
  return callMcpTool<RatingStatusResponse>(
    requestConfig,
    "rateloop_confirm_rating_transactions",
    {
      ...ratingLookupArgs(params),
      commitHash: params.commitHash,
      roundId: params.roundId,
      transactionHashes: params.transactionHashes,
    },
  );
}

export async function getRatingStatus(
  params: RatingStatusLookup,
  options: RateLoopAgentClientOptions = {},
): Promise<RatingStatusResponse> {
  const config = normalizeAgentConfig(options);
  return callMcpTool<RatingStatusResponse>(
    config,
    "rateloop_get_rating_status",
    ratingLookupArgs(params),
  );
}

export async function getQuestionStatus(
  params: QuestionStatusLookup,
  options: RateLoopAgentClientOptions = {},
): Promise<QuestionStatusResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<QuestionStatusResponse>(
      config,
      agentStatusUrl(config, params),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  if (config.mcpApiUrl) {
    return callMcpTool<QuestionStatusResponse>(
      config,
      "rateloop_get_question_status",
      { ...params },
    );
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function getResult(
  params: QuestionStatusLookup & { contentId?: string | bigint },
  options: RateLoopAgentClientOptions = {},
): Promise<RateLoopAgentResult> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<RateLoopAgentResult>(
      config,
      agentResultUrl(config, params),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  if (config.mcpApiUrl) {
    const result = await callMcpTool<unknown>(config, "rateloop_get_result", {
      ...params,
      contentId:
        params.contentId === undefined ? undefined : String(params.contentId),
    });
    return parseAgentResult(result);
  }

  throw new RateLoopSdkError(AGENT_AUTH_REQUIRED_MESSAGE);
}

export async function listResultTemplates(
  options: RateLoopAgentClientOptions = {},
): Promise<ListResultTemplatesResponse> {
  const config = normalizeAgentConfig(options);
  if (hasDirectAgentHttp(config)) {
    return requestJson<ListResultTemplatesResponse>(
      config,
      agentTemplatesUrl(config),
      {
        headers: agentHeaders(config),
        method: "GET",
      },
    );
  }

  return callMcpTool<ListResultTemplatesResponse>(
    config,
    "rateloop_list_result_templates",
    {},
  );
}

export function parseAgentResult(value: unknown): RateLoopAgentResult {
  const parsed = parseMaybeJson(value);
  const unwrapped = unwrapStructuredContent(parsed);
  if (!isJsonRecord(unwrapped)) {
    throw new RateLoopSdkError("Agent result must be a JSON object");
  }

  const ready =
    typeof unwrapped.ready === "boolean"
      ? unwrapped.ready
      : inferResultReady(unwrapped);
  return {
    ...unwrapped,
    ready,
  } as RateLoopAgentResult;
}

export function buildWebhookVerifier(
  options: ReplayProtectedWebhookVerifierOptions,
): ReplayProtectedWebhookVerifier;
export function buildWebhookVerifier(
  options: SignatureOnlyWebhookVerifierOptions,
): WebhookVerifier;
export function buildWebhookVerifier(
  options: WebhookVerifierOptions,
): WebhookVerifier | ReplayProtectedWebhookVerifier {
  if (!options.secret) {
    throw new RateLoopSdkError("Webhook verifier secret is required");
  }
  if (!options.replayProtection && options.allowReplay !== true) {
    throw new RateLoopSdkError(
      "Webhook verifier requires replayProtection. For idempotent handlers or diagnostics, use buildSignatureOnlyWebhookVerifier({ allowReplay: true, ... }).",
    );
  }

  const eventIdHeader = (
    options.eventIdHeader ?? "x-rateloop-callback-id"
  ).toLowerCase();
  const signatureHeader = (
    options.signatureHeader ?? "x-rateloop-callback-signature"
  ).toLowerCase();
  const timestampHeader = (
    options.timestampHeader ?? "x-rateloop-callback-timestamp"
  ).toLowerCase();
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    throw new RateLoopSdkError(
      "Webhook verifier toleranceSeconds must be a non-negative finite number",
    );
  }
  const replayProtection = options.replayProtection;
  const replayTtlSeconds = Math.max(
    replayProtection?.ttlSeconds ?? 24 * 60 * 60,
    toleranceSeconds,
  );

  async function verifyEvent(
    params: VerifyWebhookParams,
  ): Promise<VerifiedWebhook | null> {
    const signatureHeaderValue = getHeader(params.headers, signatureHeader);
    if (!signatureHeaderValue) return null;

    const eventId = getHeader(params.headers, eventIdHeader);
    if (!eventId) return null;

    const timestamp = getHeader(params.headers, timestampHeader);
    if (
      !timestamp ||
      !isTimestampFresh(timestamp, toleranceSeconds, params.now)
    ) {
      return null;
    }

    const body = bodyToString(params.body);
    const signedPayload = `v1.${eventId}.${timestamp}.${body}`;
    const expected = await hmacSha256Hex(options.secret, signedPayload);
    if (!signatureMatches(signatureHeaderValue, expected)) return null;
    return {
      body,
      eventId,
      headers: params.headers,
      timestamp,
    };
  }

  async function verify(params: VerifyWebhookParams): Promise<boolean> {
    return Boolean(await verifyEvent(params));
  }

  const verifier: WebhookVerifier = {
    verify,
    assertValid: async (params) => {
      if (!(await verifyEvent(params))) {
        throw new RateLoopSdkError("Invalid RateLoop webhook signature");
      }
    },
  };
  if (!replayProtection) {
    return verifier;
  }

  return {
    ...verifier,
    handleOnce: async <T>(
      params: VerifyWebhookParams,
      handler: (event: VerifiedWebhook) => Promise<T> | T,
    ): Promise<WebhookHandleOnceResult<T>> => {
      const event = await verifyEvent(params);
      if (!event) {
        throw new RateLoopSdkError("Invalid RateLoop webhook signature");
      }
      const key = `${replayProtection.keyPrefix ?? "rateloop:webhook:"}${event.eventId}`;
      const claimed = await replayProtection.store.claim(key, event, {
        ttlSeconds: replayTtlSeconds,
      });
      if (!claimed) {
        return { event, status: "duplicate" };
      }
      try {
        const value = await handler(event);
        await replayProtection.store.complete?.(key, event, {
          ttlSeconds: replayTtlSeconds,
        });
        return { event, status: "processed", value };
      } catch (error) {
        await replayProtection.store.release?.(key, event, {
          ttlSeconds: replayTtlSeconds,
        });
        throw error;
      }
    },
  };
}

export function buildReplayProtectedWebhookVerifier(
  options: ReplayProtectedWebhookVerifierOptions,
): ReplayProtectedWebhookVerifier {
  return buildWebhookVerifier(options);
}

export function buildSignatureOnlyWebhookVerifier(
  options: SignatureOnlyWebhookVerifierOptions,
): WebhookVerifier {
  return buildWebhookVerifier(options);
}

async function callMcpTool<T>(
  config: NormalizedAgentConfig,
  name: string,
  args: JsonRecord,
): Promise<T> {
  if (!config.mcpApiUrl) {
    throw new RateLoopSdkError("mcpApiUrl is required for MCP agent operations");
  }

  const id = `rateloop-sdk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = {
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      arguments: args,
      name,
    },
  };

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "mcp-protocol-version": config.mcpProtocolVersion,
  };
  if (config.mcpAccessToken) {
    headers.authorization = `Bearer ${config.mcpAccessToken}`;
  }

  const rpc = await requestJson<JsonRecord>(config, config.mcpApiUrl, {
    body: stringifyJson(body),
    headers,
    method: "POST",
  });

  if (isJsonRecord(rpc.error)) {
    const message =
      typeof rpc.error.message === "string"
        ? rpc.error.message
        : "RateLoop MCP request failed";
    throw structuredApiError(message, rpc.error.data, 400);
  }

  const result = isJsonRecord(rpc.result) ? rpc.result : null;
  const toolResult = isJsonRecord(result?.structuredContent)
    ? result.structuredContent
    : result?.structuredContent;
  if (isJsonRecord(toolResult) && toolResult.isError === true) {
    const message =
      typeof toolResult.message === "string"
        ? toolResult.message
        : "RateLoop MCP tool failed";
    throw structuredApiError(message, toolResult, 400);
  }
  if (result?.isError === true) {
    const structured = isJsonRecord(result.structuredContent)
      ? result.structuredContent
      : {};
    const message =
      typeof structured.message === "string"
        ? structured.message
        : "RateLoop MCP tool failed";
    throw structuredApiError(message, structured, 400);
  }

  return (
    result && "structuredContent" in result
      ? result.structuredContent
      : rpc.result
  ) as T;
}

async function requestJson<T>(
  config: Pick<NormalizedAgentConfig, "fetchImpl" | "timeoutMs">,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchWithTimeout(
    config.fetchImpl,
    config.timeoutMs,
    url,
    init,
  );

  const body = await response.text();
  const parsed = body.length === 0 ? null : parseJson(body);

  if (!response.ok) {
    const message =
      isJsonRecord(parsed) &&
      isJsonRecord(parsed.error) &&
      typeof parsed.error.message === "string"
        ? parsed.error.message
        : isJsonRecord(parsed) && typeof parsed.error === "string"
          ? parsed.error
          : isJsonRecord(parsed) && typeof parsed.message === "string"
            ? parsed.message
            : `RateLoop request failed with status ${response.status}`;
    throw structuredApiError(message, parsed, response.status);
  }

  return parsed as T;
}

function structuredApiError(
  message: string,
  body: unknown,
  fallbackStatus: number,
): RateLoopApiError {
  const structured =
    isJsonRecord(body) && isJsonRecord(body.error)
      ? body.error
      : isJsonRecord(body)
        ? body
        : {};
  const status =
    typeof structured.status === "number" && Number.isFinite(structured.status)
      ? structured.status
      : fallbackStatus;

  return new RateLoopApiError(message, status, {
    code: typeof structured.code === "string" ? structured.code : undefined,
    details: structured,
    originalCode:
      typeof structured.originalCode === "string"
        ? structured.originalCode
        : undefined,
    recoverWith:
      typeof structured.recoverWith === "string"
        ? structured.recoverWith
        : undefined,
    retryable:
      typeof structured.retryable === "boolean"
        ? structured.retryable
        : undefined,
  });
}

async function fetchWithTimeout(
  fetchImpl: RateLoopFetch,
  timeoutMs: number,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RateLoopApiError(
        `RateLoop request timed out after ${timeoutMs}ms`,
        504,
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    throw new RateLoopApiError(`RateLoop request failed: ${message}`, 502);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function normalizeAgentConfig(
  options: RateLoopAgentClientOptions,
): NormalizedAgentConfig {
  const apiBaseUrl = normalizeUrl(options.apiBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const quoteFetchImpl = options.quoteFetchImpl ?? fetchImpl;
  const mcpApiUrl = normalizeUrl(options.mcpApiUrl);

  enforceTokenUrlPolicy("apiBaseUrl", apiBaseUrl, options.mcpAccessToken);
  enforceTokenUrlPolicy("mcpApiUrl", mcpApiUrl, options.mcpAccessToken);

  return {
    agentApiPath: options.agentApiPath ?? DEFAULT_AGENT_API_PATH,
    apiBaseUrl,
    fetchImpl,
    quoteFetchImpl,
    mcpAccessToken: options.mcpAccessToken,
    mcpApiUrl,
    mcpProtocolVersion:
      options.mcpProtocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    confirmTimeoutMs: options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS,
  };
}

function quoteRequestConfig(
  config: NormalizedAgentConfig,
): NormalizedAgentConfig {
  return { ...config, fetchImpl: config.quoteFetchImpl };
}

function confirmRequestConfig(
  config: NormalizedAgentConfig,
): NormalizedAgentConfig {
  return { ...config, timeoutMs: config.confirmTimeoutMs };
}

function normalizeUrl(value?: string) {
  if (!value) return undefined;

  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    throw new RateLoopSdkError(`Invalid URL: ${value}`);
  }
}

function enforceTokenUrlPolicy(
  name: string,
  value: string | undefined,
  token: string | undefined,
) {
  if (!token || !value) return;

  const url = new URL(value);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return;

  throw new RateLoopSdkError(
    `${name} must use HTTPS when mcpAccessToken is configured; localhost HTTP is only allowed for local development.`,
  );
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

function agentBaseUrl(config: NormalizedAgentConfig) {
  if (!config.apiBaseUrl) {
    throw new RateLoopSdkError(
      "apiBaseUrl is required for direct agent HTTP operations",
    );
  }

  // Resolve relative to the base URL so path-prefixed bases (e.g.
  // "https://host/ponder") are preserved; a leading "/" would replace the
  // base path entirely per WHATWG URL semantics.
  return new URL(
    config.agentApiPath.replace(/^\/+/, "").replace(/\/+$/, ""),
    `${config.apiBaseUrl}/`,
  ).toString();
}

function agentQuoteUrl(config: NormalizedAgentConfig) {
  return new URL("./quote", `${agentBaseUrl(config)}/`).toString();
}

function agentAsksUrl(config: NormalizedAgentConfig) {
  return new URL("./asks", `${agentBaseUrl(config)}/`).toString();
}

function agentHandoffsUrl(config: NormalizedAgentConfig) {
  return new URL("./handoffs", `${agentBaseUrl(config)}/`).toString();
}

function agentHandoffUrl(
  config: NormalizedAgentConfig,
  params: AskHandoffLookup,
) {
  if (!params.handoffId.trim()) {
    throw new RateLoopSdkError("handoffId is required");
  }
  if (!params.handoffToken.trim()) {
    throw new RateLoopSdkError("handoffToken is required");
  }
  return new URL(
    `./handoffs/${params.handoffId.trim()}`,
    `${agentBaseUrl(config)}/`,
  ).toString();
}

function agentSigningIntentsUrl(config: NormalizedAgentConfig) {
  return new URL("./signing-intents", `${agentBaseUrl(config)}/`).toString();
}

function agentSigningIntentUrl(
  config: NormalizedAgentConfig,
  params: SigningIntentLookup,
) {
  if (!params.intentId.trim()) {
    throw new RateLoopSdkError("intentId is required");
  }
  if (!params.token.trim()) {
    throw new RateLoopSdkError("token is required");
  }
  const url = new URL(
    `./signing-intents/${params.intentId.trim()}`,
    `${agentBaseUrl(config)}/`,
  );
  return url.toString();
}

function agentSigningIntentActionUrl(
  config: NormalizedAgentConfig,
  params: SigningIntentLookup,
  action: "complete" | "prepare",
) {
  if (!params.intentId.trim()) {
    throw new RateLoopSdkError("intentId is required");
  }
  return new URL(
    `./signing-intents/${params.intentId.trim()}/${action}`,
    `${agentBaseUrl(config)}/`,
  ).toString();
}

function agentConfirmAskUrl(
  config: NormalizedAgentConfig,
  operationKey: string,
) {
  const trimmed = operationKey.trim();
  if (!trimmed) {
    throw new RateLoopSdkError(
      "operationKey is required to confirm ask transactions",
    );
  }
  return new URL(
    `./asks/${trimmed}/confirm`,
    `${agentBaseUrl(config)}/`,
  ).toString();
}

function agentConfirmFeedbackBonusUrl(
  config: NormalizedAgentConfig,
  operationKey: string,
) {
  const trimmed = operationKey.trim();
  if (!trimmed) {
    throw new RateLoopSdkError(
      "operationKey is required to confirm Feedback Bonus transactions",
    );
  }
  return new URL(
    `./asks/${trimmed}/confirm-feedback-bonus`,
    `${agentBaseUrl(config)}/`,
  ).toString();
}

function agentStatusUrl(
  config: NormalizedAgentConfig,
  params: QuestionStatusLookup,
) {
  const operationKey =
    typeof params.operationKey === "string" ? params.operationKey.trim() : "";
  if (operationKey) {
    return new URL(
      `./asks/${operationKey}`,
      `${agentBaseUrl(config)}/`,
    ).toString();
  }

  const chainId = validateLookupChainId(params.chainId);
  if (!chainId || !params.clientRequestId) {
    throw new RateLoopSdkError(
      "Provide operationKey or both chainId and clientRequestId",
    );
  }

  const url = new URL("./asks/by-client-request", `${agentBaseUrl(config)}/`);
  url.searchParams.set("chainId", String(chainId));
  url.searchParams.set("clientRequestId", params.clientRequestId);
  if (params.walletAddress) {
    url.searchParams.set("walletAddress", params.walletAddress);
  }
  return url.toString();
}

function agentResultUrl(
  config: NormalizedAgentConfig,
  params: QuestionStatusLookup & { contentId?: string | bigint },
) {
  const operationKey =
    typeof params.operationKey === "string" ? params.operationKey.trim() : "";
  if (operationKey) {
    const url = new URL(
      `./results/${operationKey}`,
      `${agentBaseUrl(config)}/`,
    );
    if (params.contentId !== undefined) {
      const contentId = String(params.contentId).trim();
      if (contentId) url.searchParams.set("contentId", contentId);
    }
    return url.toString();
  }

  const contentId =
    params.contentId === undefined ? "" : String(params.contentId).trim();
  const chainId = validateLookupChainId(params.chainId);
  if (contentId && (!chainId || !params.clientRequestId)) {
    return new URL(
      `./results/by-content/${encodeURIComponent(contentId)}`,
      `${agentBaseUrl(config)}/`,
    ).toString();
  }

  if (!chainId || !params.clientRequestId) {
    throw new RateLoopSdkError(
      "Provide contentId, operationKey, or both chainId and clientRequestId",
    );
  }

  const url = new URL(
    "./results/by-client-request",
    `${agentBaseUrl(config)}/`,
  );
  url.searchParams.set("chainId", String(chainId));
  url.searchParams.set("clientRequestId", params.clientRequestId);
  if (params.walletAddress) {
    url.searchParams.set("walletAddress", params.walletAddress);
  }
  if (contentId) {
    url.searchParams.set("contentId", contentId);
  }
  return url.toString();
}

function validateLookupChainId(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new RateLoopSdkError(
      "chainId must be a positive base-10 safe integer",
    );
  }
  return chainId;
}

function agentTemplatesUrl(config: NormalizedAgentConfig) {
  return new URL("./templates", `${agentBaseUrl(config)}/`).toString();
}

function hasDirectAgentHttp(config: NormalizedAgentConfig) {
  return Boolean(config.apiBaseUrl);
}

function hasFeedbackBonus(params: { feedbackBonus?: unknown }) {
  return params.feedbackBonus !== undefined && params.feedbackBonus !== null;
}

function ratingLookupArgs(
  params: RatingContentLookup & { roundId?: unknown; stakeWei?: unknown },
) {
  return {
    chainId: validateLookupChainId(params.chainId),
    contentId: ratingIntegerArg(params.contentId, "request.contentId"),
    roundId:
      params.roundId === undefined
        ? undefined
        : ratingIntegerArg(params.roundId, "request.roundId"),
    stakeWei:
      params.stakeWei === undefined
        ? undefined
        : ratingIntegerArg(params.stakeWei, "request.stakeWei"),
    walletAddress: params.walletAddress,
  } satisfies JsonRecord;
}

function ratingIntegerArg(value: unknown, path: string) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new RateLoopSdkError(`${path} must be a non-negative base-10 integer.`);
    }
    return value.toString();
  }
  if (typeof value === "number") {
    assertSafeNonNegativeNumber(value, path);
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return trimmed;
  }
  throw new RateLoopSdkError(`${path} must be a non-negative base-10 integer.`);
}

function ratingReferenceBpsArg(value: unknown, path: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    throw new RateLoopSdkError(`${path} must be an integer from 0 to 10000.`);
  }
  return value;
}

function assertNoPlaintextRatingFields(params: JsonRecord) {
  const present = PLAINTEXT_RATING_FIELDS.filter(
    (field) => params[field] !== undefined,
  );
  if (present.length === 0) return;

  throw new RateLoopSdkError(
    `Do not send plaintext rating fields to hosted MCP: ${present.join(", ")}. Build the encrypted commit locally with @rateloop/sdk/vote, then call prepareRatingTransactions.`,
  );
}

function assertSafeAskIntegerFields(params: unknown, path = "request") {
  if (!isJsonRecord(params)) return;

  assertSafeNonNegativeNumber(
    params.maxPaymentAmount,
    `${path}.maxPaymentAmount`,
  );
  assertSafeConfidentialityIntegerFields(
    params.confidentiality,
    `${path}.confidentiality`,
  );
  assertSafeBountyIntegerFields(params.bounty, `${path}.bounty`);
  assertSafeFeedbackBonusIntegerFields(
    params.feedbackBonus,
    `${path}.feedbackBonus`,
  );
  assertSafePaymentAuthorizationIntegerFields(
    params.paymentAuthorization,
    `${path}.paymentAuthorization`,
  );
  assertSafeRoundConfigIntegerFields(params.roundConfig, `${path}.roundConfig`);

  if (isJsonRecord(params.question)) {
    assertSafeQuestionIntegerFields(params.question, `${path}.question`);
  }
  if (Array.isArray(params.questions)) {
    params.questions.forEach((question, index) => {
      assertSafeQuestionIntegerFields(question, `${path}.questions.${index}`);
    });
  }
}

function assertSafeAskHandoffIntegerFields(params: CreateAskHandoffRequest) {
  if (isJsonRecord(params) && isJsonRecord(params.request)) {
    assertSafeAskIntegerFields(params.request, "request");
    return;
  }
  assertSafeAskIntegerFields(params, "request");
}

function assertSafeBountyIntegerFields(value: unknown, path: string) {
  if (!isJsonRecord(value)) return;
  for (const field of [
    "requiredSettledRounds",
    "bountyStartBy",
    "bountyWindowSeconds",
    "feedbackWindowSeconds",
  ]) {
    if (value[field] !== undefined) {
      throw new RateLoopSdkError(
        `${path}.${field} is no longer accepted; use roundConfig.questionDurationSeconds for the shared question duration.`,
      );
    }
  }
  for (const field of ["amount", "requiredVoters", "bountyEligibility"]) {
    assertSafeNonNegativeNumber(value[field], `${path}.${field}`);
  }
}

function assertSafeConfidentialityIntegerFields(value: unknown, path: string) {
  if (!isJsonRecord(value) || !isJsonRecord(value.bond)) return;
  assertSafeNonNegativeNumber(value.bond.amount, `${path}.bond.amount`);
}

function assertSafeFeedbackBonusIntegerFields(value: unknown, path: string) {
  if (!isJsonRecord(value)) return;
  assertSafeNonNegativeNumber(value.amount, `${path}.amount`);
}

function assertSafePaymentAuthorizationIntegerFields(
  value: unknown,
  path: string,
) {
  if (!isJsonRecord(value)) return;
  for (const field of ["value", "validAfter", "validBefore"]) {
    assertSafeNonNegativeNumber(value[field], `${path}.${field}`);
  }
}

function assertSafeQuestionIntegerFields(value: unknown, path: string) {
  if (!isJsonRecord(value)) return;
  assertSafeNonNegativeNumber(value.categoryId, `${path}.categoryId`);
  assertSafeNonNegativeNumber(value.templateVersion, `${path}.templateVersion`);
  assertSafeConfidentialityIntegerFields(
    value.confidentiality,
    `${path}.confidentiality`,
  );
  assertSafeRoundConfigIntegerFields(value.roundConfig, `${path}.roundConfig`);
}

function assertSafeRoundConfigIntegerFields(value: unknown, path: string) {
  if (!isJsonRecord(value)) return;
  for (const field of [
    "epochDuration",
    "blindPhaseSeconds",
    "blindSeconds",
    "maxDuration",
    "maxDurationSeconds",
    "deadlineSeconds",
  ]) {
    if (value[field] !== undefined) {
      throw new RateLoopSdkError(
        `${path}.${field} is no longer accepted; use roundConfig.questionDurationSeconds for the shared question duration.`,
      );
    }
  }
  for (const field of [
    "questionDurationSeconds",
    "questionDuration",
    "durationSeconds",
    "duration",
    "minVoters",
    "maxVoters",
  ]) {
    assertSafeNonNegativeNumber(value[field], `${path}.${field}`);
  }
}

function assertSafeNonNegativeNumber(value: unknown, path: string) {
  if (typeof value !== "number") return;
  if (Number.isSafeInteger(value) && value >= 0) return;
  throw new RateLoopSdkError(
    `${path} must be a safe non-negative integer. Pass a string or bigint for large atomic values.`,
  );
}

function agentHeaders(config: NormalizedAgentConfig) {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (config.mcpAccessToken) {
    headers.authorization = `Bearer ${config.mcpAccessToken}`;
  }

  return headers;
}

function jsonAgentHeaders(config: NormalizedAgentConfig) {
  return {
    ...agentHeaders(config),
    "content-type": "application/json",
  };
}

function signingIntentReadHeaders(
  config: NormalizedAgentConfig,
  params: SigningIntentLookup,
) {
  return {
    ...agentHeaders(config),
    "x-rateloop-signing-intent-token": params.token.trim(),
  };
}

function handoffReadHeaders(
  config: NormalizedAgentConfig,
  params: AskHandoffLookup,
) {
  return {
    ...agentHeaders(config),
    "x-rateloop-handoff-token": params.handoffToken.trim(),
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown parse error";
    throw new RateLoopApiError(
      `RateLoop returned invalid JSON: ${message}`,
      502,
    );
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value, jsonReplacer);
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value), jsonReplacer);
}

function jsonReplacer(_key: string, entry: unknown) {
  return typeof entry === "bigint" ? entry.toString() : entry;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }

  return value;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return parseJson(value);
}

function unwrapStructuredContent(value: unknown): unknown {
  if (!isJsonRecord(value)) return value;
  if (isJsonRecord(value.structuredContent)) return value.structuredContent;
  if (isJsonRecord(value.result)) {
    if (isJsonRecord(value.result.structuredContent))
      return value.result.structuredContent;
    return value.result;
  }
  if (Array.isArray(value.content)) {
    const textPart = value.content.find(
      (part) =>
        isJsonRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string",
    );
    if (isJsonRecord(textPart) && typeof textPart.text === "string") {
      return parseMaybeJson(textPart.text);
    }
  }
  return value;
}

function inferResultReady(value: JsonRecord): boolean {
  if (isJsonRecord(value.result) && typeof value.result.ready === "boolean")
    return value.result.ready;
  if (value.result === null) return false;
  if (typeof value.answer === "string") return value.answer !== "pending";
  return false;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined | null>,
  name: string,
) {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
  return Array.isArray(found) ? found.join(",") : (found ?? undefined);
}

function bodyToString(body: VerifyWebhookParams["body"]): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return canonicalJson(body);
}

function isTimestampFresh(
  timestamp: string,
  toleranceSeconds: number,
  now: Date | number | undefined,
) {
  const timestampMs = /^\d+$/.test(timestamp)
    ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1)
    : Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) return false;
  const nowMs =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.now();
  return Math.abs(nowMs - timestampMs) <= toleranceSeconds * 1000;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function signatureMatches(headerValue: string, expectedHex: string) {
  const expected = expectedHex.toLowerCase();
  const candidates = headerValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^(?:sha256|v1)=/i, "").toLowerCase());

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}

function constantTimeEqual(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index++) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
