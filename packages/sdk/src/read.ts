import { RateLoopApiError, RateLoopSdkError } from "./errors";
import type { RateLoopClientConfig } from "./types";

type QueryScalar = string | number | boolean | bigint;
type QueryValue = QueryScalar | readonly QueryScalar[] | undefined;
type JsonRecord = Record<string, unknown>;

export interface RateLoopOpenRoundSummary {
  roundId: string;
  voteCount: number;
  revealedCount: number;
  totalStake: string;
  upPool: string;
  downPool: string;
  upCount?: number;
  downCount?: number;
  referenceRatingBps?: number;
  ratingBps?: number;
  conservativeRatingBps?: number;
  confidenceMass?: string;
  effectiveEvidence?: string;
  settledRounds?: number;
  lowSince?: string;
  startTime: string | null;
  estimatedSettlementTime: string | null;
  [key: string]: unknown;
}

export interface RateLoopContentItem {
  id: string;
  submitter: `0x${string}`;
  contentHash: string;
  url: string;
  title: string;
  description: string;
  tags: string;
  categoryId: string;
  status: number;
  rating: number;
  ratingBps?: number;
  conservativeRatingBps?: number;
  ratingConfidenceMass?: string;
  ratingEffectiveEvidence?: string;
  ratingSettledRounds?: number;
  ratingLowSince?: string;
  createdAt: string;
  lastActivityAt: string;
  totalVotes: number;
  totalRounds: number;
  openRound: RateLoopOpenRoundSummary | null;
  [key: string]: unknown;
}

export interface RateLoopProfileSubmissionItem {
  id: string;
  submitter: `0x${string}`;
  url: string;
  title: string;
  description: string;
  categoryId: string;
  categoryName: string | null;
  status: number;
  rating: number;
  ratingBps?: number;
  conservativeRatingBps?: number;
  ratingConfidenceMass?: string;
  ratingEffectiveEvidence?: string;
  ratingSettledRounds?: number;
  ratingLowSince?: string;
  createdAt: string;
  totalVotes: number;
  totalRounds: number;
  [key: string]: unknown;
}

export interface RateLoopRoundItem {
  id: string;
  contentId: string;
  roundId: string;
  state: number;
  voteCount: number;
  revealedCount: number;
  totalStake: string;
  upPool: string;
  downPool: string;
  upCount: number;
  downCount: number;
  referenceRatingBps?: number;
  ratingBps?: number;
  conservativeRatingBps?: number;
  confidenceMass?: string;
  effectiveEvidence?: string;
  settledRounds?: number;
  lowSince?: string;
  upWins: boolean | null;
  losingPool: string | null;
  startTime: string | null;
  settledAt: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  submitter: `0x${string}` | null;
  categoryId: string | null;
  [key: string]: unknown;
}

export interface RateLoopVoteItem {
  id: string;
  contentId: string;
  roundId: string;
  voter: `0x${string}`;
  commitHash: `0x${string}`;
  targetRound: string;
  drandChainHash: `0x${string}`;
  isUp: boolean | null;
  predictedUpBps?: number | null;
  rbtsWeight?: string | null;
  rbtsScoreBps?: number | null;
  rbtsRewardWeight?: string | null;
  rbtsStakeReturned?: string | null;
  rbtsForfeitedStake?: string | null;
  stake: string;
  epochIndex: number;
  revealed: boolean;
  committedAt: string;
  revealedAt: string | null;
  roundStartTime: string | null;
  roundState: number | null;
  roundUpWins: boolean | null;
  roundRbtsRewardWeight?: string | null;
  roundRbtsRewardClaimants?: number | null;
  roundRbtsForfeitedPool?: string | null;
  roundRbtsForfeitClaimants?: number | null;
  [key: string]: unknown;
}

export interface RateLoopFrontendItem {
  address: `0x${string}`;
  operator: `0x${string}`;
  stakedAmount: string;
  eligible: boolean;
  slashed: boolean;
  exitAvailableAt: string | null;
  totalFeesCredited: string;
  totalFeesClaimed: string;
  registeredAt: string;
  [key: string]: unknown;
}

export interface RateLoopCategoryItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  totalVotes: number;
  totalContent: number;
  [key: string]: unknown;
}

export interface RateLoopSelfReportedAudienceBucket {
  down: number;
  total: number;
  up: number;
  value: string;
}

export interface RateLoopSelfReportedAudienceContext {
  fields: {
    ageGroup: RateLoopSelfReportedAudienceBucket[];
    expertise: RateLoopSelfReportedAudienceBucket[];
    languages: RateLoopSelfReportedAudienceBucket[];
    nationalities: RateLoopSelfReportedAudienceBucket[];
    residenceCountry: RateLoopSelfReportedAudienceBucket[];
    roles: RateLoopSelfReportedAudienceBucket[];
  };
  missingSelfReportCount: number;
  note: string;
  restrictedEligibility: false;
  selfReportedProfileCount: number;
  source: "self_reported_public_profiles";
  totalRevealedVotes: number;
  verified: false;
}

export interface RateLoopProfileItem {
  address: `0x${string}`;
  name?: string | null;
  selfReport?: string | null;
  displayName?: string | null;
  bio?: string | null;
  avatar?: string | null;
  createdAt?: string;
  updatedAt?: string;
  totalVotes?: number;
  totalContent?: number;
  totalRewardsClaimed?: string;
  [key: string]: unknown;
}

export interface RateLoopProfileSocialCounts {
  followerCount: number;
  followingCount: number;
}

export interface RateLoopGlobalStats {
  totalContent?: number;
  totalVotes?: number;
  totalRoundsSettled?: number;
  totalRewardsClaimed?: string;
  totalQuestionRewardsPaid?: string;
  totalQuestionRewardsPaidToVoters?: string;
  totalQuestionRewardsPaidToFrontends?: string;
  totalProfiles?: number;
  totalVoterIds?: number;
  totalVerifiedHumans?: number | string;
  [key: string]: unknown;
}

export type RateLoopRaterTypeName = "Unknown" | "Human" | "AI" | "Team" | "Hybrid";
export type RateLoopHumanCredentialStatus =
  | "missing"
  | "verified"
  | "expired"
  | "revoked";
export type RateLoopParticipationLane = "verified_human" | "open";

export interface RateLoopAccuracyLeaderboardReputation {
  raterType: number;
  raterTypeName: RateLoopRaterTypeName;
  humanCredentialStatus: RateLoopHumanCredentialStatus;
  participationLane: RateLoopParticipationLane;
  followerCount: number;
  followingCount: number;
  [key: string]: unknown;
}

export interface RateLoopAccuracyLeaderboardItem {
  voter: `0x${string}`;
  totalSettledVotes: number;
  totalWins: number;
  totalLosses: number;
  totalStakeWon: string;
  totalStakeLost: string;
  scoredVotes?: number;
  signalScoreBps?: number;
  signalScore?: number;
  currentStreak?: number;
  bestWinStreak?: number;
  profileName: string | null;
  reputation?: RateLoopAccuracyLeaderboardReputation;
  winRate: number;
  [key: string]: unknown;
}

export type RateLoopAccuracyLeaderboardWindow =
  | "all"
  | "7d"
  | "30d"
  | "365d"
  | "season";

export interface RateLoopAccuracyLeaderboardResponse {
  items: RateLoopAccuracyLeaderboardItem[];
  categoryId?: string;
  window: RateLoopAccuracyLeaderboardWindow;
  startsAt: string | null;
  endsAt: string | null;
}

export interface RateLoopRaterParticipationStatusResponse {
  asOf: {
    chainTimestamp: string;
    wallTimestamp: string;
    indexedBlockNumber: string | null;
  };
  rater: `0x${string}`;
  raterType: number;
  raterTypeName: RateLoopRaterTypeName;
  participationLane: RateLoopParticipationLane;
  humanCredential: {
    verified: boolean;
    revoked: boolean;
    status: RateLoopHumanCredentialStatus;
    verifiedAt: string | null;
    expiresAt: string | null;
    evidenceHash: string | null;
  };
  launchRewards: {
    eligible: boolean;
    qualifyingRatingCount: number;
    rewardedRatingCount: number;
    distinctVerifiedAnchorCount: number;
    distinctAnchorRoundCount: number;
    launchCap: string;
    fullLaunchCap: string;
    capBps: number;
    fullCapUnlocked: boolean;
    launchPaid: string;
    remainingLaunchCap: string;
    unlockableLaunchCap: string;
    remainingRewardSlots: number;
    cohortIndex: number | null;
    latestCreditedAt: string | null;
    latestPaidAt: string | null;
    policy: {
      [key: string]: unknown;
    };
  };
  participationPolicy: {
    baseRewardWeightBps: number;
    humanVerificationAffectsRewardWeight: boolean;
    verifiedHumanCountsAsLaunchAnchor: boolean;
  };
  [key: string]: unknown;
}

export interface RateLoopPaginatedResponse<T> {
  items: T[];
  total?: number | null;
  settledTotal?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
}

export interface RateLoopContentDetailsResponse {
  audienceContext: RateLoopSelfReportedAudienceContext;
  content: RateLoopContentItem;
  rounds: RateLoopRoundItem[];
  ratings: JsonRecord[];
  matchCount?: number;
}

export interface RateLoopProfileResponse {
  profile: RateLoopProfileItem | null;
  summary: {
    totalVotes: number;
    totalContent: number;
    totalRewardsClaimed: string | number;
  };
  social: RateLoopProfileSocialCounts;
  recentVotes: RateLoopVoteItem[];
  recentRewards: JsonRecord[];
  recentSubmissions: RateLoopProfileSubmissionItem[];
}

export interface RateLoopFollowItem {
  walletAddress: `0x${string}`;
  createdAt: string;
  [key: string]: unknown;
}

export interface RateLoopFollowResponse extends RateLoopProfileSocialCounts {
  items: RateLoopFollowItem[];
  count: number;
  limit: number;
  offset: number;
}

export interface SearchContentParams {
  contentIds?: readonly (string | number | bigint)[];
  status?: string;
  categoryId?: string;
  search?: string;
  submitter?: string;
  submitters?: readonly string[];
  sortBy?:
    | "newest"
    | "oldest"
    | "highest_rated"
    | "lowest_rated"
    | "most_votes"
    | "highest_rewards"
    | "relevance";
  limit?: number;
  offset?: number;
}

export interface SearchVotesParams {
  voter?: string;
  contentId?: string;
  roundId?: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export interface SearchRoundsParams {
  contentId?: string;
  state?: string;
  limit?: number;
  offset?: number;
}

export interface ListFrontendsParams {
  status?:
    | "all"
    | "active"
    | "eligible"
    | "slashed"
    | "exiting"
    | "inactive"
    | "pending";
  limit?: number;
  offset?: number;
}

export interface ListCategoriesParams {
  limit?: number;
  offset?: number;
}

export interface GetFollowsParams {
  limit?: number;
  offset?: number;
}

export interface GetAccuracyLeaderboardParams {
  categoryId?: string;
  sortBy?: string;
  window?: RateLoopAccuracyLeaderboardWindow;
  minVotes?: number;
  minSignalVotes?: number;
  includeReputation?: boolean;
  limit?: number;
  offset?: number;
}

export interface RateLoopReadClient {
  searchContent(
    params?: SearchContentParams,
  ): Promise<RateLoopPaginatedResponse<RateLoopContentItem>>;
  getContent(contentId: string | bigint): Promise<RateLoopContentDetailsResponse>;
  getContentByUrl(url: string): Promise<RateLoopContentDetailsResponse>;
  getCategories(
    params?: ListCategoriesParams,
  ): Promise<{ items: RateLoopCategoryItem[] }>;
  getProfile(address: string): Promise<RateLoopProfileResponse>;
  getProfiles(addresses: string[]): Promise<Record<string, RateLoopProfileItem>>;
  getFollows(
    address: string,
    params?: GetFollowsParams,
  ): Promise<RateLoopFollowResponse>;
  getFollowers(
    address: string,
    params?: GetFollowsParams,
  ): Promise<RateLoopFollowResponse>;
  getAccuracyLeaderboard(
    params?: GetAccuracyLeaderboardParams,
  ): Promise<RateLoopAccuracyLeaderboardResponse>;
  getVoterAccuracy(address: string): Promise<JsonRecord>;
  getRaterParticipationStatus(
    address: string,
  ): Promise<RateLoopRaterParticipationStatusResponse>;
  getStats(): Promise<RateLoopGlobalStats>;
  searchVotes(
    params?: SearchVotesParams,
  ): Promise<RateLoopPaginatedResponse<RateLoopVoteItem>>;
  searchRounds(
    params?: SearchRoundsParams,
  ): Promise<RateLoopPaginatedResponse<RateLoopRoundItem>>;
  listFrontends(
    params?: ListFrontendsParams,
  ): Promise<{ items: RateLoopFrontendItem[] }>;
  getFrontend(address: string): Promise<{ frontend: RateLoopFrontendItem }>;
}

export function createRateLoopReadClient(
  config: Pick<RateLoopClientConfig, "apiBaseUrl" | "fetchImpl" | "timeoutMs">,
): RateLoopReadClient {
  return {
    searchContent: (params) =>
      request<RateLoopPaginatedResponse<RateLoopContentItem>>(
        config,
        "/content",
        params,
      ),
    getContent: (contentId) =>
      request<RateLoopContentDetailsResponse>(config, `/content/${contentId}`),
    getContentByUrl: (url) =>
      request<RateLoopContentDetailsResponse>(config, "/content/by-url", { url }),
    getCategories: (params) =>
      request<{ items: RateLoopCategoryItem[] }>(config, "/categories", params),
    getProfile: (address) =>
      request<RateLoopProfileResponse>(config, `/profile/${address}`),
    getProfiles: (addresses) =>
      request<Record<string, RateLoopProfileItem>>(config, "/profiles", {
        addresses: addresses.join(","),
      }),
    getFollows: (address, params) =>
      request<RateLoopFollowResponse>(config, `/follows/${address}`, params),
    getFollowers: (address, params) =>
      request<RateLoopFollowResponse>(config, `/followers/${address}`, params),
    getAccuracyLeaderboard: (params) =>
      request<RateLoopAccuracyLeaderboardResponse>(
        config,
        "/accuracy-leaderboard",
        params,
      ),
    getVoterAccuracy: (address) =>
      request<JsonRecord>(config, `/voter-accuracy/${address}`),
    getRaterParticipationStatus: (address) =>
      request<RateLoopRaterParticipationStatusResponse>(
        config,
        `/rater-participation-status/${address}`,
      ),
    getStats: () => request<RateLoopGlobalStats>(config, "/stats"),
    searchVotes: (params) =>
      request<RateLoopPaginatedResponse<RateLoopVoteItem>>(config, "/votes", params),
    searchRounds: (params) =>
      request<RateLoopPaginatedResponse<RateLoopRoundItem>>(
        config,
        "/rounds",
        params,
      ),
    listFrontends: (params) =>
      request<{ items: RateLoopFrontendItem[] }>(config, "/frontends", params),
    getFrontend: (address) =>
      request<{ frontend: RateLoopFrontendItem }>(config, `/frontend/${address}`),
  };
}

async function request<T>(
  config: Pick<RateLoopClientConfig, "apiBaseUrl" | "fetchImpl" | "timeoutMs">,
  path: string,
  params?: object,
): Promise<T> {
  const baseUrl = config.apiBaseUrl;
  if (!baseUrl) {
    throw new RateLoopSdkError("apiBaseUrl is required for read operations");
  }

  // Resolve relative to the base URL so path-prefixed bases (e.g.
  // "https://host/ponder") are preserved; a leading "/" would replace the
  // base path entirely per WHATWG URL semantics.
  const url = new URL(
    path.replace(/^\/+/, ""),
    `${baseUrl.replace(/\/+$/, "")}/`,
  );

  for (const [key, value] of Object.entries(
    (params ?? {}) as Record<string, QueryValue>,
  )) {
    const serializedValue = serializeQueryValue(value);
    if (serializedValue != null) {
      url.searchParams.set(key, serializedValue);
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await config.fetchImpl(url, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RateLoopApiError(
        `RateLoop request timed out after ${config.timeoutMs}ms`,
        504,
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    throw new RateLoopApiError(`RateLoop request failed: ${message}`, 502);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const body = await response.text();
  const parsed = body.length === 0 ? null : parseJson(body);

  if (!response.ok) {
    const message =
      isJsonRecord(parsed) && typeof parsed.error === "string"
        ? parsed.error
        : `RateLoop request failed with status ${response.status}`;
    throw new RateLoopApiError(message, response.status);
  }

  return parsed as T;
}

function serializeQueryValue(value: QueryValue): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return String(value);
  if (value.length === 0) return null;
  return value.map((item) => String(item)).join(",");
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown parse error";
    throw new RateLoopApiError(`RateLoop returned invalid JSON: ${message}`, 502);
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
