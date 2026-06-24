import { REVEAL_FAILED_GRACE_MULTIPLIER, ROUND_STATE } from "@rateloop/contracts/protocol";
import { canonicalJson, canonicalJsonHash } from "@rateloop/node-utils/json";
import {
  aggregateProfileSelfReports,
  normalizeTargetAudience,
  serializeTargetAudience,
  type TargetAudience,
} from "@rateloop/node-utils/profileSelfReport";
import type { Context } from "hono";
import { and, asc, desc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import { Pool } from "pg";
import type { Hex } from "viem";
import {
  category,
  content,
  contentMedia,
  advisoryVote,
  feedbackBonusPool,
  profile,
  questionBundleReward,
  questionRewardPool,
  ratingChange,
  rewardClaim,
  round,
  vote,
} from "ponder:schema";
import {
  buildAllowedCategoryCondition,
  buildAllowedContentCondition,
} from "../moderation.js";
import {
  profileTotalContentExpr,
  profileTotalRewardsClaimedExpr,
  profileTotalVotesExpr,
} from "../profile-aggregate-expressions.js";
import {
  emptyProfileEarningsSummary,
  getProfileEarningsSummary,
  getRecentProfileEarnings,
} from "../earnings.js";
import { getFollowStatsMap } from "../follow-utils.js";
import { resolvePonderProtocolDeploymentMetadata } from "../../protocol-deployment.js";
import type { ApiApp } from "../shared.js";
import {
  attachOpenRoundSummary,
  formatRoundSummary,
  humanVerifiedCommitQuorumMet,
  jsonBig,
  parseBigIntList,
  resolveApiNowSeconds,
} from "../shared.js";
import {
  confidentialityContentSelectFields,
  formatConfidentialContent,
  formatConfidentialContentPreview,
  isGatedUndisclosedContent,
  parseStoredJson,
  readQuestionMetadataConfidentiality,
  type ContentConfidentialityState,
} from "../confidentiality-redaction.js";
import { attachVoteUiToContentResponse } from "../voteUi.js";
import {
  getUrlLookupCandidates,
  isValidAddress,
  normalizeContentSearchQuery,
  safeBigInt,
  safeLimit,
  safeOffset,
} from "../utils.js";

type SqlCondition = ReturnType<typeof sql>;
type AudienceColumn = Parameters<typeof sql>[1];

const CONTENT_STATUS_ACTIVE = 0;
const MAX_TARGET_AUDIENCE_METADATA_ITEMS = 25;
const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK: Record<string, string> = {
  hardhat: "rateloop_ponder_hardhat",
  baseSepolia: "rateloop_ponder_base_sepolia",
  base: "rateloop_ponder_base",
  worldchain: "rateloop_ponder_worldchain",
  worldchainSepolia: "rateloop_ponder_worldchain_sepolia",
};
const DEFAULT_PONDER_DATABASE_SCHEMA = "rateloop_ponder";
const LEGACY_PONDER_DATABASE_SCHEMA = "ponder";
let metadataUpdatePool: Pool | null = null;

type AudienceFilter = {
  column: AudienceColumn;
  normalize: (values: string[]) => string[];
  queryNames: readonly string[];
};

const TARGET_AUDIENCE_RESPONSE_FIELDS = [
  "questionMetadata",
  "questionMetadataUri",
  "targetAudience",
  "targetAudienceAgeGroups",
  "targetAudienceCountries",
  "targetAudienceExpertise",
  "targetAudienceLanguages",
  "targetAudienceNationalities",
  "targetAudienceRoles",
  "targetAudienceAiAgentFrameworks",
  "targetAudienceAiAutonomy",
  "targetAudienceAiExpertise",
  "targetAudienceAiLanguages",
  "targetAudienceAiModelProviders",
  "targetAudienceTeamCountries",
  "targetAudienceTeamExpertise",
  "targetAudienceTeamLanguages",
  "targetAudienceTeamSizes",
  "targetAudienceTeamTypes",
  "targetAudienceHybridExpertise",
  "targetAudienceHybridLanguages",
  "targetAudienceHybridModelProviders",
  "targetAudienceHybridOversight",
] as const;

function voteMatchesVoter(address: `0x${string}`) {
  return or(eq(vote.voter, address), eq(vote.identityHolder, address));
}

function profileSelection() {
  const totalVotes = profileTotalVotesExpr(profile.address);
  const totalContent = profileTotalContentExpr(profile.address);
  const totalRewardsClaimed = profileTotalRewardsClaimedExpr(profile.address);

  return {
    address: profile.address,
    name: profile.name,
    selfReport: profile.selfReport,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    totalVotes,
    totalContent,
    totalRewardsClaimed,
  };
}

function createContentSearchVector() {
  return sql`(
    setweight(to_tsvector('simple', coalesce(${content.title}, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(${content.tags}, '')), 'B') ||
    setweight(
      to_tsvector(
        'simple',
        case
          when ${content.gated} = true and ${content.confidentialityPublishedAt} is null then ''
          else coalesce(${content.description}, '')
        end
      ),
      'C'
    )
  )`;
}

function buildContentSearchExpressions(search: string) {
  const vector = createContentSearchVector();
  const query = sql`websearch_to_tsquery('simple', ${search})`;
  const rank = sql<number>`ts_rank_cd(${vector}, ${query}, 32)`;

  return {
    condition: sql<boolean>`${vector} @@ ${query}`,
    rank,
  };
}

function getRewardAvailableAmount(nowSeconds: bigint) {
  return sql<bigint>`coalesce((
    select sum(
      case
        when ${questionRewardPool.refunded} = false
          and ${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}
          and (
            ${questionRewardPool.bountyWindowSeconds} = 0
            or (${questionRewardPool.bountyClosesAt} != 0 and ${questionRewardPool.bountyClosesAt} >= ${nowSeconds})
            or (${questionRewardPool.bountyClosesAt} = 0 and ${questionRewardPool.bountyStartBy} >= ${nowSeconds})
          )
          then ${questionRewardPool.unallocatedAmount}
        else 0
      end
    )
    from ${questionRewardPool}
    where ${questionRewardPool.contentId} = ${content.id}
  ), 0) + coalesce((
    select sum(
      case
        when ${questionBundleReward.completedRoundSetCount} < ${questionBundleReward.requiredSettledRounds}
          and (
            ${questionBundleReward.bountyWindowSeconds} = 0
            or (${questionBundleReward.bountyClosesAt} != 0 and ${questionBundleReward.bountyClosesAt} >= ${nowSeconds})
            or (${questionBundleReward.bountyClosesAt} = 0 and ${questionBundleReward.bountyStartBy} >= ${nowSeconds})
          )
          then ${questionBundleReward.unallocatedAmount}
        else 0
      end
    )
    from ${questionBundleReward}
    where ${questionBundleReward.id} = ${content.bundleId}
      and ${questionBundleReward.failed} = false
      and ${questionBundleReward.refunded} = false
  ), 0) + coalesce((
    select sum(${feedbackBonusPool.remainingAmount})
    from ${feedbackBonusPool}
    where ${feedbackBonusPool.contentId} = ${content.id}
      and ${feedbackBonusPool.forfeited} = false
      and ${feedbackBonusPool.awardDeadline} >= ${nowSeconds}
  ), 0)`;
}

function getRewardPriority(nowSeconds: bigint) {
  return sql<number>`case when ${getRewardAvailableAmount(nowSeconds)} > 0 then 1 else 0 end`;
}

function getRatedContentPriority() {
  return sql<number>`case when ${content.ratingSettledRounds} > 0 then 1 else 0 end`;
}

function getContentOrderBy(sortBy: string, nowSeconds: bigint) {
  switch (sortBy) {
    case "oldest":
      return [asc(content.createdAt), asc(content.id)];
    case "bounty_first":
      return [
        desc(getRewardPriority(nowSeconds)),
        desc(getRewardAvailableAmount(nowSeconds)),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "highest_rewards":
      return [
        desc(getRewardAvailableAmount(nowSeconds)),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "highest_rated":
      return [
        desc(getRatedContentPriority()),
        desc(content.ratingBps),
        desc(content.rating),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "lowest_rated":
      return [
        desc(getRatedContentPriority()),
        asc(content.ratingBps),
        asc(content.rating),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "most_votes":
      return [
        desc(content.totalVotes),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "newest":
    case "relevance":
    default:
      return [desc(content.createdAt), desc(content.id)];
  }
}

function getSearchOrderBy(
  searchRank: ReturnType<typeof sql<number>>,
  sortBy: string,
  nowSeconds: bigint,
) {
  switch (sortBy) {
    case "oldest":
      return [desc(searchRank), asc(content.createdAt), asc(content.id)];
    case "bounty_first":
      return [
        desc(searchRank),
        desc(getRewardPriority(nowSeconds)),
        desc(getRewardAvailableAmount(nowSeconds)),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "highest_rewards":
      return [
        desc(searchRank),
        desc(getRewardAvailableAmount(nowSeconds)),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "highest_rated":
      return [
        desc(searchRank),
        desc(getRatedContentPriority()),
        desc(content.ratingBps),
        desc(content.rating),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "lowest_rated":
      return [
        desc(searchRank),
        desc(getRatedContentPriority()),
        asc(content.ratingBps),
        asc(content.rating),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "most_votes":
      return [
        desc(searchRank),
        desc(content.totalVotes),
        desc(content.createdAt),
        desc(content.id),
      ];
    case "newest":
    case "relevance":
    default:
      return [desc(searchRank), desc(content.createdAt), desc(content.id)];
  }
}

function parseOptionalBooleanFlag(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return undefined;
}

function pipeList(values: readonly string[] | null | undefined) {
  const items = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  return items.length > 0 ? `|${items.join("|")}|` : null;
}

function targetAudienceStorageFields(value: TargetAudience | null) {
  return {
    targetAudience: value ? serializeTargetAudience(value) : null,
    targetAudienceAgeGroups: pipeList(value?.ageGroups),
    targetAudienceCountries: pipeList(value?.countries),
    targetAudienceExpertise: pipeList(value?.expertise),
    targetAudienceLanguages: pipeList(value?.languages),
    targetAudienceNationalities: pipeList(value?.nationalities),
    targetAudienceRoles: pipeList(value?.roles),
    targetAudienceAiAgentFrameworks: pipeList(value?.ai?.agentFrameworks),
    targetAudienceAiAutonomy: pipeList(value?.ai?.autonomy),
    targetAudienceAiExpertise: pipeList(value?.ai?.expertise),
    targetAudienceAiLanguages: pipeList(value?.ai?.languages),
    targetAudienceAiModelProviders: pipeList(value?.ai?.modelProviders),
    targetAudienceTeamCountries: pipeList(value?.team?.countries),
    targetAudienceTeamExpertise: pipeList(value?.team?.expertise),
    targetAudienceTeamLanguages: pipeList(value?.team?.languages),
    targetAudienceTeamSizes: pipeList(value?.team?.sizes),
    targetAudienceTeamTypes: pipeList(value?.team?.types),
    targetAudienceHybridExpertise: pipeList(value?.hybrid?.expertise),
    targetAudienceHybridLanguages: pipeList(value?.hybrid?.languages),
    targetAudienceHybridModelProviders: pipeList(value?.hybrid?.modelProviders),
    targetAudienceHybridOversight: pipeList(value?.hybrid?.oversight),
  };
}

function normalizeAudienceFilter(build: (values: string[]) => unknown, read: (value: TargetAudience | null) => string[]) {
  return (values: string[]) => read(normalizeTargetAudience(build(values)));
}

const TARGET_AUDIENCE_FILTERS: AudienceFilter[] = [
  {
    column: content.targetAudienceAgeGroups,
    normalize: normalizeAudienceFilter((ageGroups) => ({ ageGroups }), (value) => value?.ageGroups ?? []),
    queryNames: ["targetAudienceAgeGroups", "targetAudience.ageGroups"],
  },
  {
    column: content.targetAudienceCountries,
    normalize: normalizeAudienceFilter((countries) => ({ countries }), (value) => value?.countries ?? []),
    queryNames: ["targetAudienceCountries", "targetAudience.countries"],
  },
  {
    column: content.targetAudienceExpertise,
    normalize: normalizeAudienceFilter((expertise) => ({ expertise }), (value) => value?.expertise ?? []),
    queryNames: ["targetAudienceExpertise", "targetAudience.expertise"],
  },
  {
    column: content.targetAudienceLanguages,
    normalize: normalizeAudienceFilter((languages) => ({ languages }), (value) => value?.languages ?? []),
    queryNames: ["targetAudienceLanguages", "targetAudience.languages"],
  },
  {
    column: content.targetAudienceNationalities,
    normalize: normalizeAudienceFilter((nationalities) => ({ nationalities }), (value) => value?.nationalities ?? []),
    queryNames: ["targetAudienceNationalities", "targetAudience.nationalities"],
  },
  {
    column: content.targetAudienceRoles,
    normalize: normalizeAudienceFilter((roles) => ({ roles }), (value) => value?.roles ?? []),
    queryNames: ["targetAudienceRoles", "targetAudience.roles"],
  },
  {
    column: content.targetAudienceAiAgentFrameworks,
    normalize: normalizeAudienceFilter(
      (agentFrameworks) => ({ ai: { agentFrameworks } }),
      (value) => value?.ai?.agentFrameworks ?? [],
    ),
    queryNames: ["targetAudienceAiAgentFrameworks", "targetAudience.ai.agentFrameworks"],
  },
  {
    column: content.targetAudienceAiAutonomy,
    normalize: normalizeAudienceFilter((autonomy) => ({ ai: { autonomy } }), (value) => value?.ai?.autonomy ?? []),
    queryNames: ["targetAudienceAiAutonomy", "targetAudience.ai.autonomy"],
  },
  {
    column: content.targetAudienceAiExpertise,
    normalize: normalizeAudienceFilter((expertise) => ({ ai: { expertise } }), (value) => value?.ai?.expertise ?? []),
    queryNames: ["targetAudienceAiExpertise", "targetAudience.ai.expertise"],
  },
  {
    column: content.targetAudienceAiLanguages,
    normalize: normalizeAudienceFilter((languages) => ({ ai: { languages } }), (value) => value?.ai?.languages ?? []),
    queryNames: ["targetAudienceAiLanguages", "targetAudience.ai.languages"],
  },
  {
    column: content.targetAudienceAiModelProviders,
    normalize: normalizeAudienceFilter(
      (modelProviders) => ({ ai: { modelProviders } }),
      (value) => value?.ai?.modelProviders ?? [],
    ),
    queryNames: ["targetAudienceAiModelProviders", "targetAudience.ai.modelProviders"],
  },
  {
    column: content.targetAudienceTeamCountries,
    normalize: normalizeAudienceFilter((countries) => ({ team: { countries } }), (value) => value?.team?.countries ?? []),
    queryNames: ["targetAudienceTeamCountries", "targetAudience.team.countries"],
  },
  {
    column: content.targetAudienceTeamExpertise,
    normalize: normalizeAudienceFilter((expertise) => ({ team: { expertise } }), (value) => value?.team?.expertise ?? []),
    queryNames: ["targetAudienceTeamExpertise", "targetAudience.team.expertise"],
  },
  {
    column: content.targetAudienceTeamLanguages,
    normalize: normalizeAudienceFilter((languages) => ({ team: { languages } }), (value) => value?.team?.languages ?? []),
    queryNames: ["targetAudienceTeamLanguages", "targetAudience.team.languages"],
  },
  {
    column: content.targetAudienceTeamSizes,
    normalize: normalizeAudienceFilter((sizes) => ({ team: { sizes } }), (value) => value?.team?.sizes ?? []),
    queryNames: ["targetAudienceTeamSizes", "targetAudience.team.sizes"],
  },
  {
    column: content.targetAudienceTeamTypes,
    normalize: normalizeAudienceFilter((types) => ({ team: { types } }), (value) => value?.team?.types ?? []),
    queryNames: ["targetAudienceTeamTypes", "targetAudience.team.types"],
  },
  {
    column: content.targetAudienceHybridExpertise,
    normalize: normalizeAudienceFilter(
      (expertise) => ({ hybrid: { expertise } }),
      (value) => value?.hybrid?.expertise ?? [],
    ),
    queryNames: ["targetAudienceHybridExpertise", "targetAudience.hybrid.expertise"],
  },
  {
    column: content.targetAudienceHybridLanguages,
    normalize: normalizeAudienceFilter(
      (languages) => ({ hybrid: { languages } }),
      (value) => value?.hybrid?.languages ?? [],
    ),
    queryNames: ["targetAudienceHybridLanguages", "targetAudience.hybrid.languages"],
  },
  {
    column: content.targetAudienceHybridModelProviders,
    normalize: normalizeAudienceFilter(
      (modelProviders) => ({ hybrid: { modelProviders } }),
      (value) => value?.hybrid?.modelProviders ?? [],
    ),
    queryNames: ["targetAudienceHybridModelProviders", "targetAudience.hybrid.modelProviders"],
  },
  {
    column: content.targetAudienceHybridOversight,
    normalize: normalizeAudienceFilter(
      (oversight) => ({ hybrid: { oversight } }),
      (value) => value?.hybrid?.oversight ?? [],
    ),
    queryNames: ["targetAudienceHybridOversight", "targetAudience.hybrid.oversight"],
  },
];

function parseAudienceQueryValues(value: string | undefined) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
}

function buildAudienceContainsCondition(column: AudienceColumn, values: readonly string[]): SqlCondition | null {
  const clauses = values.map((value) => sql<boolean>`coalesce(${column}, '') like ${`%|${value}|%`}`);
  return clauses.length === 1 ? clauses[0]! : (or(...clauses) ?? null);
}

function buildTargetAudienceFilterConditions(c: Context): { conditions: SqlCondition[]; error: string | null } {
  const conditions: SqlCondition[] = [];
  for (const filter of TARGET_AUDIENCE_FILTERS) {
    const rawValues = filter.queryNames.flatMap((queryName) => parseAudienceQueryValues(c.req.query(queryName)));
    if (rawValues.length === 0) continue;
    let values: string[];
    try {
      values = filter.normalize(rawValues);
    } catch (error) {
      return {
        conditions: [],
        error: error instanceof Error ? error.message : "Invalid target audience filter.",
      };
    }
    const condition = buildAudienceContainsCondition(filter.column, values);
    if (condition) conditions.push(condition);
  }
  return { conditions, error: null };
}

function formatContentTargetAudience<T extends Record<string, unknown>>(item: T, includeTargetAudience = false): T {
  const redacted = { ...item };
  const record = redacted as Record<string, unknown>;
  if (includeTargetAudience) {
    const rawTargetAudience = record.targetAudience;
    try {
      record.targetAudience =
        typeof rawTargetAudience === "string" && rawTargetAudience !== "null"
          ? normalizeTargetAudience(JSON.parse(rawTargetAudience))
          : null;
    } catch {
      record.targetAudience = null;
    }
  }
  for (const field of TARGET_AUDIENCE_RESPONSE_FIELDS) {
    if (includeTargetAudience && field === "targetAudience") continue;
    delete record[field];
  }
  return redacted;
}

function formatContentResponse<T extends Record<string, unknown>>(item: T, includeTargetAudience = false): T {
  const withVoteUi = attachVoteUiToContentResponse({ ...item });
  return formatConfidentialContent(formatContentTargetAudience(withVoteUi, includeTargetAudience)) as T;
}

function metadataSyncToken() {
  return process.env.PONDER_METADATA_SYNC_TOKEN?.trim() || null;
}

function readEnv(key: string) {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function resolveWritablePonderSchema() {
  const rateloopSchema = readEnv("RATELOOP_PONDER_DATABASE_SCHEMA");
  const databaseSchema = readEnv("DATABASE_SCHEMA");
  const ponderNetwork = readEnv("PONDER_NETWORK");
  const isLegacyDatabaseSchema = rateloopSchema === undefined && databaseSchema === LEGACY_PONDER_DATABASE_SCHEMA;
  const schema =
    rateloopSchema ??
    (isLegacyDatabaseSchema ? undefined : databaseSchema) ??
    (ponderNetwork ? DEFAULT_PONDER_DATABASE_SCHEMA_BY_NETWORK[ponderNetwork] : undefined) ??
    DEFAULT_PONDER_DATABASE_SCHEMA;
  if (!SCHEMA_NAME_PATTERN.test(schema)) {
    throw new Error("Invalid Ponder database schema.");
  }
  return schema;
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function toSnakeCaseIdentifier(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function quotePonderColumn(value: string) {
  return quoteIdentifier(toSnakeCaseIdentifier(value));
}

function metadataSyncDatabaseUrl() {
  return readEnv("DATABASE_PRIVATE_URL") || readEnv("DATABASE_URL");
}

function getMetadataUpdatePool() {
  const connectionString = metadataSyncDatabaseUrl();
  if (!connectionString) {
    throw new Error("DATABASE_PRIVATE_URL or DATABASE_URL is required for metadata sync.");
  }
  metadataUpdatePool ??= new Pool({
    connectionString,
    max: 2,
  });
  return metadataUpdatePool;
}

async function updateQuestionMetadataRow(params: {
  contentId: bigint;
  questionMetadata: string | null;
  questionMetadataHash: Hex;
  questionMetadataUri: string | null;
  resultSpecHash: Hex;
  confidentiality: ContentConfidentialityState | null;
  targetAudience: TargetAudience | null;
}) {
  const storage = targetAudienceStorageFields(params.targetAudience);
  const schema = quoteIdentifier(resolveWritablePonderSchema());
  const result = await getMetadataUpdatePool().query(
    `
      update ${schema}.${quoteIdentifier("content")}
      set
        ${quotePonderColumn("questionMetadataHash")} = $1,
        ${quotePonderColumn("resultSpecHash")} = $2,
        ${quotePonderColumn("questionMetadata")} = coalesce($3, ${quotePonderColumn("questionMetadata")}),
        ${quotePonderColumn("questionMetadataUri")} = coalesce($4, ${quotePonderColumn("questionMetadataUri")}),
        ${quotePonderColumn("targetAudience")} = $5,
        ${quotePonderColumn("targetAudienceAgeGroups")} = $6,
        ${quotePonderColumn("targetAudienceCountries")} = $7,
        ${quotePonderColumn("targetAudienceExpertise")} = $8,
        ${quotePonderColumn("targetAudienceLanguages")} = $9,
        ${quotePonderColumn("targetAudienceNationalities")} = $10,
        ${quotePonderColumn("targetAudienceRoles")} = $11,
        ${quotePonderColumn("targetAudienceAiAgentFrameworks")} = $12,
        ${quotePonderColumn("targetAudienceAiAutonomy")} = $13,
        ${quotePonderColumn("targetAudienceAiExpertise")} = $14,
        ${quotePonderColumn("targetAudienceAiLanguages")} = $15,
        ${quotePonderColumn("targetAudienceAiModelProviders")} = $16,
        ${quotePonderColumn("targetAudienceTeamCountries")} = $17,
        ${quotePonderColumn("targetAudienceTeamExpertise")} = $18,
        ${quotePonderColumn("targetAudienceTeamLanguages")} = $19,
        ${quotePonderColumn("targetAudienceTeamSizes")} = $20,
        ${quotePonderColumn("targetAudienceTeamTypes")} = $21,
        ${quotePonderColumn("targetAudienceHybridExpertise")} = $22,
        ${quotePonderColumn("targetAudienceHybridLanguages")} = $23,
        ${quotePonderColumn("targetAudienceHybridModelProviders")} = $24,
        ${quotePonderColumn("targetAudienceHybridOversight")} = $25,
        ${quotePonderColumn("gated")} = $26,
        ${quotePonderColumn("confidentialityDisclosurePolicy")} = $27,
        ${quotePonderColumn("confidentialityBondAsset")} = $28,
        ${quotePonderColumn("confidentialityBondAmount")} = $29,
        ${quotePonderColumn("confidentialityPublishedAt")} = case
          when $26 = true
            and $27 = 'after_settlement'
            and ${quotePonderColumn("confidentialityPublishedAt")} is null
          then coalesce(
            (
              select min(${quotePonderColumn("settledAt")})
              from ${schema}.${quoteIdentifier("round")}
              where ${quotePonderColumn("contentId")} = $30
                and ${quotePonderColumn("state")} in ($31, $32, $33)
                and ${quotePonderColumn("settledAt")} is not null
            ),
            ${quotePonderColumn("confidentialityPublishedAt")}
          )
          else ${quotePonderColumn("confidentialityPublishedAt")}
        end
      where ${quotePonderColumn("id")} = $30
        and (${quotePonderColumn("questionMetadataHash")} is null or lower(${quotePonderColumn("questionMetadataHash")}) = $1)
        and (${quotePonderColumn("resultSpecHash")} is null or lower(${quotePonderColumn("resultSpecHash")}) = $2)
        and ($3::text is null or ${quotePonderColumn("questionMetadata")} is null or ${quotePonderColumn("questionMetadata")} = $3)
        and ($4::text is null or ${quotePonderColumn("questionMetadataUri")} is null or ${quotePonderColumn("questionMetadataUri")} = $4)
    `,
    [
      params.questionMetadataHash,
      params.resultSpecHash,
      params.questionMetadata,
      params.questionMetadataUri,
      storage.targetAudience,
      storage.targetAudienceAgeGroups,
      storage.targetAudienceCountries,
      storage.targetAudienceExpertise,
      storage.targetAudienceLanguages,
      storage.targetAudienceNationalities,
      storage.targetAudienceRoles,
      storage.targetAudienceAiAgentFrameworks,
      storage.targetAudienceAiAutonomy,
      storage.targetAudienceAiExpertise,
      storage.targetAudienceAiLanguages,
      storage.targetAudienceAiModelProviders,
      storage.targetAudienceTeamCountries,
      storage.targetAudienceTeamExpertise,
      storage.targetAudienceTeamLanguages,
      storage.targetAudienceTeamSizes,
      storage.targetAudienceTeamTypes,
      storage.targetAudienceHybridExpertise,
      storage.targetAudienceHybridLanguages,
      storage.targetAudienceHybridModelProviders,
      storage.targetAudienceHybridOversight,
      params.confidentiality?.visibility === "gated",
      params.confidentiality?.disclosurePolicy ?? null,
      params.confidentiality?.bondAsset ?? null,
      params.confidentiality?.bondAmount.toString() ?? "0",
      params.contentId.toString(),
      ROUND_STATE.Settled,
      ROUND_STATE.Tied,
      ROUND_STATE.RevealFailed,
    ],
  );
  return result.rowCount ?? 0;
}

function authorizeMetadataSync(c: Context) {
  const token = metadataSyncToken();
  if (!token) {
    if (process.env.PONDER_METADATA_SYNC_ALLOW_OPEN === "true") {
      return null;
    }
    return metadataSyncDatabaseUrl()
      ? "PONDER_METADATA_SYNC_TOKEN is required when database metadata sync is configured."
      : "PONDER_METADATA_SYNC_TOKEN is required.";
  }
  return c.req.header("authorization") === `Bearer ${token}` ? null : "Invalid metadata sync token.";
}

function readMetadataHash(value: unknown) {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  return BYTES32_PATTERN.test(hash) ? (hash as `0x${string}`) : null;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDeploymentKey(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function readQuestionMetadataItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TARGET_AUDIENCE_METADATA_ITEMS).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const contentId = safeBigInt(String(record.contentId ?? ""));
    const questionMetadataHash = readMetadataHash(record.questionMetadataHash);
    const resultSpecHash = readMetadataHash(record.resultSpecHash);
    if (contentId === null || !questionMetadataHash || !resultSpecHash) return [];
    const questionMetadataUri =
      typeof record.questionMetadataUri === "string" && record.questionMetadataUri.trim()
        ? record.questionMetadataUri.trim()
        : null;
    const questionMetadataInput = record.questionMetadata ?? null;
    let questionMetadata: string | null = null;
    let confidentiality: ContentConfidentialityState | null = null;
    let targetAudienceInput = record.targetAudience;
    if (questionMetadataInput !== null) {
      if (!isJsonRecord(questionMetadataInput)) return [];
      if (canonicalJsonHash(questionMetadataInput).toLowerCase() !== questionMetadataHash) return [];
      questionMetadata = canonicalJson(questionMetadataInput);
      confidentiality = readQuestionMetadataConfidentiality(questionMetadataInput);
      targetAudienceInput =
        questionMetadataInput.targetAudience === undefined ? targetAudienceInput : questionMetadataInput.targetAudience;
    }
    return [
      {
        contentId,
        questionMetadata,
        questionMetadataHash,
        questionMetadataUri,
        resultSpecHash,
        confidentiality,
        targetAudience: targetAudienceInput,
      },
    ];
  });
}

function getRoundAdvisoryCommitCount() {
  return sql<number>`coalesce((
    select count(*)
    from ${advisoryVote}
    where ${advisoryVote.contentId} = ${round.contentId}
      and ${advisoryVote.roundId} = ${round.roundId}
  ), 0)`;
}

function getVoteableContentCondition(nowSeconds: bigint) {
  const revealQuorum = sql<number>`greatest(${round.minVoters}, 3)`;
  return sql<boolean>`(
    ${content.status} = ${CONTENT_STATUS_ACTIVE}
    and (
      not exists (
        select 1
        from ${round}
        where ${round.contentId} = ${content.id}
          and ${round.state} = ${ROUND_STATE.Open}
      )
      or exists (
        select 1
        from ${round}
        where ${round.contentId} = ${content.id}
          and ${round.state} = ${ROUND_STATE.Open}
          and (
            (
              ${round.startTime} is not null
              and ${round.maxDuration} > 0
              and ${nowSeconds} < ${round.startTime} + ${round.maxDuration}
              and ${round.voteCount} < ${round.maxVoters}
              and ${round.revealedCount} < ${round.minVoters}
              and ${getRoundAdvisoryCommitCount()} < ${round.maxVoters}
            )
            or (
              ${round.startTime} is not null
              and ${round.maxDuration} > 0
              and ${nowSeconds} >= ${round.startTime} + ${round.maxDuration}
              and (
                ${round.voteCount} < ${round.minVoters}
                or (
                  ${round.humanVerifiedCommitCount} < ${revealQuorum}
                  and ${round.revealedCount} < ${revealQuorum}
                )
                or (
                  ${round.revealedCount} < ${round.minVoters}
                  and ${round.lastCommitRevealableAfter} is not null
                  and ${round.revealGracePeriod} is not null
                  and ${nowSeconds} >= (
                    case
                      when ${round.lastCommitRevealableAfter} > ${round.startTime} + ${round.maxDuration}
                        then ${round.lastCommitRevealableAfter}
                      else ${round.startTime} + ${round.maxDuration}
                    end
                  ) + ${round.revealGracePeriod} * ${REVEAL_FAILED_GRACE_MULTIPLIER}
                )
              )
            )
          )
      )
    )
  )`;
}

function inferMediaTypeFromHost(urlHost: string): "image" | "video" {
  return urlHost === "youtube.com" ||
    urlHost === "www.youtube.com" ||
    urlHost === "m.youtube.com" ||
    urlHost === "youtu.be"
    ? "video"
    : "image";
}

const UPLOADED_IMAGE_ATTACHMENT_URL_PATTERN =
  /^https:\/\/[^/\s]+\/api\/attachments\/images\/att_[A-Za-z0-9_-]{16,80}\.webp(?:[?#]\S*)?$/;

function isFallbackMediaUrl(item: { url?: string; urlHost?: string }) {
  if (!item.url) return false;
  if (UPLOADED_IMAGE_ATTACHMENT_URL_PATTERN.test(item.url)) return true;
  return inferMediaTypeFromHost(item.urlHost ?? "") === "video";
}

function fallbackMediaForItem<
  T extends { url?: string; canonicalUrl?: string; urlHost?: string },
>(item: T) {
  if (!isFallbackMediaUrl(item)) return [];
  return [
    {
      index: 0,
      mediaIndex: 0,
      mediaType: inferMediaTypeFromHost(item.urlHost ?? ""),
      url: item.url,
      canonicalUrl: item.canonicalUrl ?? item.url,
      urlHost: item.urlHost ?? "",
    },
  ];
}

async function attachContentMedia<
  T extends {
    id: bigint;
    url?: string;
    canonicalUrl?: string;
    urlHost?: string;
  },
>(items: T[]) {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      media: fallbackMediaForItem(item),
    }));
  }

  const rows = await db
    .select()
    .from(contentMedia)
    .where(
      inArray(
        contentMedia.contentId,
        items.map((item) => item.id),
      ),
    )
    .orderBy(asc(contentMedia.contentId), asc(contentMedia.mediaIndex));
  const rowsByContentId = new Map<bigint, typeof rows>();

  for (const row of rows) {
    const existing = rowsByContentId.get(row.contentId) ?? [];
    existing.push(row);
    rowsByContentId.set(row.contentId, existing);
  }

  return items.map((item) => {
    const mediaRows = rowsByContentId.get(item.id);
    return {
      ...item,
      media: mediaRows?.length
        ? mediaRows.map((row) => ({
            index: row.mediaIndex,
            mediaIndex: row.mediaIndex,
            mediaType: row.mediaType,
            url: row.url,
            canonicalUrl: row.canonicalUrl,
            urlHost: row.urlHost,
          }))
        : fallbackMediaForItem(item),
    };
  });
}

async function attachQuestionBundleSummaries<
  T extends { bundleId?: bigint | null },
>(items: T[]) {
  const bundleIds = [
    ...new Set(
      items
        .map((item) => item.bundleId)
        .filter(
          (bundleId): bundleId is bigint =>
            typeof bundleId === "bigint" && bundleId > 0n,
        ),
    ),
  ];
  if (bundleIds.length === 0) {
    return items.map((item) => ({ ...item, bundle: null }));
  }

  const rows = await db
    .select()
    .from(questionBundleReward)
    .where(inArray(questionBundleReward.id, bundleIds));
  const bundlesById = new Map(rows.map((row) => [row.id, row]));

  return items.map((item) => {
    const bundle =
      typeof item.bundleId === "bigint" ? bundlesById.get(item.bundleId) : null;
    return {
      ...item,
      bundle: bundle
        ? {
            id: bundle.id,
            asset: bundle.asset,
            fundedAmount: bundle.fundedAmount,
            claimedAmount: bundle.claimedAmount,
            refundedAmount: bundle.refundedAmount,
            unallocatedAmount: bundle.unallocatedAmount,
            allocatedAmount: bundle.allocatedAmount,
            requiredCompleters: bundle.requiredCompleters,
            requiredSettledRounds: bundle.requiredSettledRounds,
            frontendFeeBps: bundle.frontendFeeBps,
            bountyEligibility: bundle.bountyEligibility,
            bountyEligibilityDataHash: bundle.bountyEligibilityDataHash,
            bountyStartBy: bundle.bountyStartBy,
            bountyOpensAt: bundle.bountyOpensAt,
            bountyWindowSeconds: bundle.bountyWindowSeconds,
            feedbackWindowSeconds: bundle.feedbackWindowSeconds,
            questionCount: bundle.questionCount,
            completedRoundSetCount: bundle.completedRoundSetCount,
            totalRecordedQuestionRounds: bundle.totalRecordedQuestionRounds,
            claimedCount: bundle.claimedCount,
            bountyClosesAt: bundle.bountyClosesAt,
            feedbackClosesAt: bundle.feedbackClosesAt,
            expiresAt: bundle.expiresAt,
            failed: bundle.failed,
            refunded: bundle.refunded,
          }
        : null,
    };
  });
}

async function getAudienceContextForContent(contentId: bigint) {
  const rows = await db
    .select({
      isUp: vote.isUp,
      selfReport: profile.selfReport,
    })
    .from(vote)
    .innerJoin(
      round,
      and(eq(vote.contentId, round.contentId), eq(vote.roundId, round.roundId)),
    )
    .leftJoin(profile, sql<boolean>`${profile.address} = coalesce(${vote.identityHolder}, ${vote.voter})`)
    .where(
      and(
        eq(vote.contentId, contentId),
        eq(round.state, ROUND_STATE.Settled),
        eq(vote.revealed, true),
      ),
    );

  return aggregateProfileSelfReports(rows);
}

export function registerContentRoutes(app: ApiApp) {
  app.get("/question-metadata/:hash", async (c) => {
    const hash = readMetadataHash(c.req.param("hash"));
    if (!hash) return c.json({ error: "Invalid question metadata hash." }, 400);

    const rows = await db
      .select({
        contentId: content.id,
        ...confidentialityContentSelectFields(),
        questionMetadataHash: content.questionMetadataHash,
        questionMetadataUri: content.questionMetadataUri,
        resultSpecHash: content.resultSpecHash,
        targetAudience: content.targetAudience,
        title: content.title,
        createdAt: content.createdAt,
      })
      .from(content)
      .where(eq(content.questionMetadataHash, hash))
      .orderBy(asc(content.id))
      .limit(100);

    if (rows.length === 0) {
      return c.json({ error: "Question metadata not found." }, 404);
    }

    const verifiedRows = rows.filter(row => {
      const metadata = parseStoredJson(row.questionMetadata);
      return metadata !== null && canonicalJsonHash(metadata).toLowerCase() === hash;
    });
    const verifiedMetadata = verifiedRows.length > 0 ? parseStoredJson(verifiedRows[0]!.questionMetadata) : null;

    if (!verifiedMetadata) {
      return c.json({ error: "Question metadata preimage is not available." }, 404);
    }
    if (verifiedRows.every(row => isGatedUndisclosedContent(row as Record<string, unknown>))) {
      return c.json({ error: "Question metadata preimage is not available until confidential context is public." }, 404);
    }

    return jsonBig(c, {
      questionMetadata: verifiedMetadata,
      questionMetadataHash: hash,
      items: verifiedRows.map((row) => ({
        contentId: row.contentId,
        createdAt: row.createdAt,
        questionMetadataUri: row.questionMetadataUri,
        resultSpecHash: row.resultSpecHash,
        targetAudience: parseStoredJson(row.targetAudience),
        title: row.title,
      })),
    });
  });

  app.post("/question-metadata", async (c) => {
    const authError = authorizeMetadataSync(c);
    if (authError) {
      return c.json(
        { error: authError },
        authError.includes("required") ? 503 : 401,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }
    const bodyRecord = isJsonRecord(body) ? body : null;
    const deployment = resolvePonderProtocolDeploymentMetadata();
    if (!deployment) {
      return c.json({ error: "Ponder deployment metadata is not configured." }, 503);
    }
    const callerDeploymentKey = readDeploymentKey(bodyRecord?.deploymentKey);
    if (!callerDeploymentKey) {
      return c.json({ error: "deploymentKey is required." }, 400);
    }
    if (callerDeploymentKey !== deployment.deploymentKey) {
      return c.json(
        {
          error: "deploymentKey does not match this Ponder deployment.",
          expectedDeploymentKey: deployment.deploymentKey,
          receivedDeploymentKey: callerDeploymentKey,
        },
        409,
      );
    }

    const metadata = readQuestionMetadataItems(bodyRecord?.metadata);
    if (metadata.length === 0) {
      return c.json({ error: "metadata is required." }, 400);
    }

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const item of metadata) {
      let targetAudience: TargetAudience | null;
      try {
        targetAudience = normalizeTargetAudience(item.targetAudience);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Invalid targetAudience.");
        skipped += 1;
        continue;
      }

      const rowCount = await updateQuestionMetadataRow({
        contentId: item.contentId,
        questionMetadata: item.questionMetadata,
        questionMetadataHash: item.questionMetadataHash,
        questionMetadataUri: item.questionMetadataUri,
        resultSpecHash: item.resultSpecHash,
        confidentiality: item.confidentiality,
        targetAudience,
      });
      if (rowCount > 0) {
        updated += rowCount;
      } else {
        skipped += 1;
      }
    }

    return c.json({
      errors,
      requested: metadata.length,
      skipped,
      updated,
    });
  });

  app.get("/content", async (c) => {
    const categoryId = c.req.query("categoryId");
    const contentIds = parseBigIntList(c.req.query("contentIds"), 500);
    const rawSearch = c.req.query("search");
    const requestedSearch = rawSearch?.trim();
    const search = normalizeContentSearchQuery(rawSearch);
    const status = c.req.query("status") ?? "0";
    const submitterQuery = c.req.query("submitter");
    const submittersQuery = c.req.query("submitters");
    const sortBy = c.req.query("sortBy") ?? "newest";
    const voteable = parseOptionalBooleanFlag(c.req.query("voteable"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }
    if (voteable === undefined) return c.json({ error: "Invalid voteable filter" }, 400);
    if (requestedSearch && search === null) {
      return jsonBig(c, {
        items: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
      });
    }

    const conditions: SqlCondition[] = [
      buildAllowedContentCondition({
        canonicalUrl: content.canonicalUrl,
        description: content.description,
        tags: content.tags,
        title: content.title,
        url: content.url,
        urlHost: content.urlHost,
      }),
    ];
    if (status !== "all") {
      const parsed = parseInt(status);
      if (isNaN(parsed)) return c.json({ error: "Invalid status filter" }, 400);
      conditions.push(eq(content.status, parsed));
    }
    if (sortBy === "highest_rewards") {
      conditions.push(sql<boolean>`${getRewardAvailableAmount(nowSeconds)} > 0`);
    }
    if (voteable === true) {
      conditions.push(getVoteableContentCondition(nowSeconds));
    }
    if (categoryId) {
      const parsed = safeBigInt(categoryId);
      if (parsed === null) return c.json({ error: "Invalid categoryId" }, 400);
      conditions.push(eq(content.categoryId, parsed));
    }
    if (contentIds.length > 0) {
      conditions.push(inArray(content.id, contentIds));
    }
    const audienceFilters = buildTargetAudienceFilterConditions(c);
    if (audienceFilters.error) {
      return c.json({ error: audienceFilters.error }, 400);
    }
    conditions.push(...audienceFilters.conditions);
    const submitterFilters = new Set<`0x${string}`>();
    if (submitterQuery) {
      if (!isValidAddress(submitterQuery))
        return c.json({ error: "Invalid submitter address" }, 400);
      submitterFilters.add(submitterQuery.toLowerCase() as `0x${string}`);
    }
    if (submittersQuery) {
      const parsedSubmitters = submittersQuery
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        parsedSubmitters.length === 0 ||
        parsedSubmitters.some((value) => !isValidAddress(value))
      ) {
        return c.json({ error: "Invalid submitters filter" }, 400);
      }
      parsedSubmitters.forEach((value) =>
        submitterFilters.add(value.toLowerCase() as `0x${string}`),
      );
    }
    if (submitterFilters.size === 1) {
      conditions.push(eq(content.submitter, Array.from(submitterFilters)[0]));
    } else if (submitterFilters.size > 1) {
      conditions.push(inArray(content.submitter, Array.from(submitterFilters)));
    }
    const urlSearchCandidates = search ? getUrlLookupCandidates(search) : null;
    const searchExpressions =
      search && urlSearchCandidates === null
        ? buildContentSearchExpressions(search)
        : null;
    if (urlSearchCandidates) {
      const urlSearchCondition = or(
        inArray(content.canonicalUrl, urlSearchCandidates),
        inArray(content.url, urlSearchCandidates),
      );
      if (urlSearchCondition) conditions.push(urlSearchCondition);
    } else if (search) {
      conditions.push(searchExpressions!.condition);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const queryLimit = limit + 1;
    const orderByExprs = searchExpressions
      ? getSearchOrderBy(searchExpressions.rank, sortBy, nowSeconds)
      : getContentOrderBy(sortBy, nowSeconds);

    const items = await db
      .select()
      .from(content)
      .where(where)
      .orderBy(...orderByExprs)
      .limit(queryLimit)
      .offset(offset);

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const itemsWithOpenRound = await attachOpenRoundSummary(pageItems, nowSeconds);
    const itemsWithMedia = await attachContentMedia(itemsWithOpenRound);
    const itemsWithBundles =
      await attachQuestionBundleSummaries(itemsWithMedia);
    const total =
      search === null
        ? ((
            await db
              .select({ count: sql<number>`count(*)` })
              .from(content)
              .where(where)
          )[0]?.count ?? 0)
        : null;

    const responseItems = itemsWithBundles.map((item) => formatContentResponse(item));
    if (contentIds.length === 1 && responseItems.length === 1) {
      const sourceItem = itemsWithBundles[0];
      const responseItem = responseItems[0] as Record<string, unknown> | undefined;
      if (sourceItem && responseItem && Number(sourceItem.ratingSettledRounds ?? 0) > 0) {
        responseItem.audienceContext = await getAudienceContextForContent(sourceItem.id);
      }
    }

    return jsonBig(c, {
      items: responseItems,
      total,
      limit,
      offset,
      hasMore,
    });
  });

  app.get("/content/by-url", async (c) => {
    const url = c.req.query("url");
    const includeTargetAudience = parseOptionalBooleanFlag(
      c.req.query("includeTargetAudience"),
    );
    if (includeTargetAudience === undefined) {
      return c.json({ error: "Invalid includeTargetAudience filter" }, 400);
    }
    if (!url) {
      return c.json({ error: "url parameter required" }, 400);
    }
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

    const candidates = getUrlLookupCandidates(url);
    if (!candidates) {
      return c.json({ error: "Invalid URL" }, 400);
    }

    const mediaMatches = await db
      .select({ contentId: contentMedia.contentId })
      .from(contentMedia)
      .where(
        or(
          inArray(contentMedia.canonicalUrl, candidates),
          inArray(contentMedia.url, candidates),
        ),
      )
      .limit(20);
    const matchedMediaContentIds = [
      ...new Set(mediaMatches.map((item) => item.contentId)),
    ];

    const matches = await db
      .select()
      .from(content)
      .where(
        and(
          matchedMediaContentIds.length > 0
            ? or(
                inArray(content.canonicalUrl, candidates),
                inArray(content.url, candidates),
                inArray(content.id, matchedMediaContentIds),
              )
            : or(
                inArray(content.canonicalUrl, candidates),
                inArray(content.url, candidates),
              ),
          buildAllowedContentCondition({
            canonicalUrl: content.canonicalUrl,
            description: content.description,
            tags: content.tags,
            title: content.title,
            url: content.url,
            urlHost: content.urlHost,
          }),
        ),
      )
      .orderBy(desc(content.createdAt))
      .limit(5);

    const item = matches[0];
    if (!item) {
      return c.json({ error: "Content not found" }, 404);
    }

    const [contentWithOpenRound] = await attachOpenRoundSummary([item], nowSeconds);
    const [contentWithMedia] = await attachContentMedia([contentWithOpenRound]);
    const [contentWithBundle] = await attachQuestionBundleSummaries([
      contentWithMedia,
    ]);

    const rounds = await db
      .select()
      .from(round)
      .where(eq(round.contentId, item.id))
      .orderBy(desc(round.roundId))
      .limit(20);

    const ratings = await db
      .select()
      .from(ratingChange)
      .where(eq(ratingChange.contentId, item.id))
      .orderBy(desc(ratingChange.timestamp))
      .limit(50);
    const audienceContext = await getAudienceContextForContent(item.id);

    return jsonBig(c, {
      content: formatContentResponse(
        contentWithBundle,
        includeTargetAudience === true,
      ),
      rounds,
      ratings,
      audienceContext,
      matchCount: matches.length,
    });
  });

  app.get("/content/:id", async (c) => {
    const id = safeBigInt(c.req.param("id"));
    if (id === null) return c.json({ error: "Invalid content id" }, 400);
    const includeTargetAudience = parseOptionalBooleanFlag(
      c.req.query("includeTargetAudience"),
    );
    if (includeTargetAudience === undefined) {
      return c.json({ error: "Invalid includeTargetAudience filter" }, 400);
    }
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

    const [item] = await db
      .select()
      .from(content)
      .where(
        and(
          eq(content.id, id),
          buildAllowedContentCondition({
            canonicalUrl: content.canonicalUrl,
            description: content.description,
            tags: content.tags,
            title: content.title,
            url: content.url,
            urlHost: content.urlHost,
          }),
        ),
      )
      .limit(1);

    if (!item) {
      return c.json({ error: "Content not found" }, 404);
    }

    const [contentWithOpenRound] = await attachOpenRoundSummary([item], nowSeconds);
    const [contentWithMedia] = await attachContentMedia([contentWithOpenRound]);
    const [contentWithBundle] = await attachQuestionBundleSummaries([
      contentWithMedia,
    ]);

    const rounds = await db
      .select()
      .from(round)
      .where(eq(round.contentId, id))
      .orderBy(desc(round.roundId))
      .limit(20);

    const ratings = await db
      .select()
      .from(ratingChange)
      .where(eq(ratingChange.contentId, id))
      .orderBy(desc(ratingChange.timestamp))
      .limit(50);
    const audienceContext = await getAudienceContextForContent(id);

    return jsonBig(c, {
      content: formatContentResponse(
        contentWithBundle,
        includeTargetAudience === true,
      ),
      rounds: rounds.map(roundRow => formatRoundSummary(roundRow)),
      ratings,
      audienceContext,
    });
  });

  app.get("/rounds", async (c) => {
    const contentId = c.req.query("contentId");
    const roundIdRaw = c.req.query("roundId");
    const stateFilter = c.req.query("state");
    const submitter = c.req.query("submitter");
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const conditions: SqlCondition[] = [
      buildAllowedContentCondition({
        canonicalUrl: content.canonicalUrl,
        description: content.description,
        tags: content.tags,
        title: content.title,
        url: content.url,
        urlHost: content.urlHost,
      }),
    ];
    if (contentId) {
      const parsed = safeBigInt(contentId);
      if (parsed === null) return c.json({ error: "Invalid contentId" }, 400);
      conditions.push(eq(round.contentId, parsed));
    }
    if (roundIdRaw !== undefined) {
      const parsedRoundId = safeBigInt(roundIdRaw);
      if (parsedRoundId === null) return c.json({ error: "Invalid roundId" }, 400);
      conditions.push(eq(round.roundId, parsedRoundId));
    }
    if (stateFilter !== undefined) {
      const parsed = parseInt(stateFilter);
      if (isNaN(parsed)) return c.json({ error: "Invalid state filter" }, 400);
      conditions.push(eq(round.state, parsed));
    }
    if (submitter) {
      if (!isValidAddress(submitter))
        return c.json({ error: "Invalid submitter address" }, 400);
      conditions.push(
        eq(content.submitter, submitter.toLowerCase() as `0x${string}`),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const settledOnly =
      stateFilter !== undefined &&
      parseInt(stateFilter) === ROUND_STATE.Settled;

    const items = await db
      .select({
        id: round.id,
        contentId: round.contentId,
        roundId: round.roundId,
        state: round.state,
        voteCount: round.voteCount,
        revealedCount: round.revealedCount,
        totalStake: round.totalStake,
        upPool: round.upPool,
        downPool: round.downPool,
        upCount: round.upCount,
        downCount: round.downCount,
        referenceRatingBps: round.referenceRatingBps,
        ratingBps: round.ratingBps,
        conservativeRatingBps: round.conservativeRatingBps,
        confidenceMass: round.confidenceMass,
        effectiveEvidence: round.effectiveEvidence,
        upEvidence: round.upEvidence,
        downEvidence: round.downEvidence,
        settledRounds: round.settledRounds,
        lowSince: round.lowSince,
        upWins: round.upWins,
        losingPool: round.losingPool,
        startTime: round.startTime,
        settledAt: round.settledAt,
        epochDuration: round.epochDuration,
        maxDuration: round.maxDuration,
        minVoters: round.minVoters,
        maxVoters: round.maxVoters,
        ...confidentialityContentSelectFields(),
        title: content.title,
        description: content.description,
        url: content.url,
        submitter: content.submitter,
        categoryId: content.categoryId,
        hasHumanVerifiedCommit: round.hasHumanVerifiedCommit,
        humanVerifiedCommitCount: round.humanVerifiedCommitCount,
      })
      .from(round)
      .leftJoin(content, eq(round.contentId, content.id))
      .where(where)
      .orderBy(
        settledOnly ? desc(round.settledAt) : desc(round.startTime),
        desc(round.contentId),
        desc(round.roundId),
      )
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(round)
      .leftJoin(content, eq(round.contentId, content.id))
      .where(where);

    return jsonBig(c, {
      items: items.map(item => ({
        ...formatConfidentialContentPreview(item),
        humanVerifiedCommitQuorumMet: humanVerifiedCommitQuorumMet(
          item.humanVerifiedCommitCount,
          item.minVoters,
        ),
      })),
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  });

  app.get("/submitter-settled-rounds", async (c) => {
    const submitter = c.req.query("submitter");
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    if (!submitter) {
      return c.json({ error: "submitter parameter required" }, 400);
    }
    if (!isValidAddress(submitter)) {
      return c.json({ error: "Invalid submitter address" }, 400);
    }

    const submitterAddress = submitter.toLowerCase() as `0x${string}`;
    const where = and(
      eq(content.submitter, submitterAddress),
      eq(round.state, ROUND_STATE.Settled),
      buildAllowedContentCondition({
        canonicalUrl: content.canonicalUrl,
        description: content.description,
        tags: content.tags,
        title: content.title,
        url: content.url,
        urlHost: content.urlHost,
      }),
    );

    const items = await db
      .select({
        contentId: round.contentId,
        roundId: round.roundId,
      })
      .from(round)
      .innerJoin(content, eq(round.contentId, content.id))
      .where(where)
      .orderBy(
        desc(round.settledAt),
        desc(round.contentId),
        desc(round.roundId),
      )
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(round)
      .innerJoin(content, eq(round.contentId, content.id))
      .where(where);

    return jsonBig(c, {
      items,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  });

  app.get("/voting-stakes", async (c) => {
    const voter = c.req.query("voter");
    if (!voter) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    if (!isValidAddress(voter)) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    const voterAddr = voter.toLowerCase() as `0x${string}`;

    const [activeResult] = await db
      .select({
        total: sql<string>`coalesce(sum(${vote.stake}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .where(
        and(voteMatchesVoter(voterAddr), eq(round.state, ROUND_STATE.Open)),
      );

    return jsonBig(c, {
      activeStake: activeResult?.total ?? "0",
      activeCount: activeResult?.count ?? 0,
      voter: voterAddr,
    });
  });

  app.get("/categories", async (c) => {
    const where = buildAllowedCategoryCondition({
      slug: category.slug,
      name: category.name,
    });
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const items = await db
      .select()
      .from(category)
      .where(where)
      .orderBy(asc(category.name))
      .limit(safeLimit(c.req.query("limit"), 100, 500))
      .offset(offset);

    return jsonBig(c, { items });
  });

  app.get("/category-popularity", async (c) => {
    const items = await db
      .select({
        id: category.id,
        totalVotes: category.totalVotes,
      })
      .from(category);

    const popularity: Record<string, number> = {};
    for (const item of items) {
      popularity[item.id.toString()] = item.totalVotes;
    }

    return jsonBig(c, popularity);
  });

  app.get("/profiles", async (c) => {
    const addressesParam = c.req.query("addresses");
    if (!addressesParam) {
      return c.json({ error: "addresses parameter required" }, 400);
    }

    const addresses = addressesParam
      .split(",")
      .slice(0, 50)
      .map((address) => address.trim().toLowerCase() as `0x${string}`)
      .filter((address) => isValidAddress(address));

    const items = await db
      .select(profileSelection())
      .from(profile)
      .where(inArray(profile.address, addresses));

    const profileMap: Record<string, (typeof items)[0]> = {};
    for (const item of items) {
      profileMap[item.address.toLowerCase()] = item;
    }

    return jsonBig(c, profileMap);
  });

  app.get("/profile/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const [item] = await db
      .select(profileSelection())
      .from(profile)
      .where(eq(profile.address, address))
      .limit(1);

    const [voteSummary] = await db
      .select({ count: sql<number>`count(*)` })
      .from(vote)
      .where(voteMatchesVoter(address));

    const [contentSummary] = await db
      .select({ count: sql<number>`count(*)` })
      .from(content)
      .where(
        and(
          eq(content.submitter, address),
          buildAllowedContentCondition({
            canonicalUrl: content.canonicalUrl,
            description: content.description,
            tags: content.tags,
            title: content.title,
            url: content.url,
            urlHost: content.urlHost,
          }),
        ),
      );

    const [rewardSummary] = await db
      .select({
        total: sql<bigint>`coalesce(sum(
          case when ${rewardClaim.voter} = ${address} then ${rewardClaim.lrepReward} else 0 end +
          case when ${rewardClaim.stakePayer} = ${address} then ${rewardClaim.stakeReturned} else 0 end
        ), 0)`,
      })
      .from(rewardClaim)
      .where(
        or(eq(rewardClaim.voter, address), eq(rewardClaim.stakePayer, address)),
      );

    const followStats = (await getFollowStatsMap([address])).get(address) ?? {
      followerCount: 0,
      followingCount: 0,
    };

    const recentVotes = await db
      .select({
        id: vote.id,
        contentId: vote.contentId,
        roundId: vote.roundId,
        voter: vote.voter,
        identityKey: vote.identityKey,
        identityHolder: vote.identityHolder,
        voterId: sql<null>`null`,
        commitKey: vote.commitKey,
        commitHash: vote.commitHash,
        ciphertextHash: vote.ciphertextHash,
        ciphertext: vote.ciphertext,
        ciphertextSource: vote.ciphertextSource,
        targetRound: vote.targetRound,
        drandChainHash: vote.drandChainHash,
        isUp: vote.isUp,
        predictedUpBps: vote.predictedUpBps,
        rbtsWeight: vote.rbtsWeight,
        rbtsScoreBps: vote.rbtsScoreBps,
        rbtsRewardWeight: vote.rbtsRewardWeight,
        rbtsStakeReturned: vote.rbtsStakeReturned,
        rbtsForfeitedStake: vote.rbtsForfeitedStake,
        stake: vote.stake,
        epochIndex: vote.epochIndex,
        revealed: vote.revealed,
        committedAt: vote.committedAt,
        commitTxHash: vote.commitTxHash,
        commitBlockNumber: vote.commitBlockNumber,
        commitLogIndex: vote.commitLogIndex,
        revealedAt: vote.revealedAt,
        roundStartTime: round.startTime,
        roundEpochDuration: round.epochDuration,
        roundMaxDuration: round.maxDuration,
        roundMinVoters: round.minVoters,
        roundMaxVoters: round.maxVoters,
        roundState: round.state,
        roundUpWins: round.upWins,
        roundRbtsRewardWeight: round.rbtsRewardWeight,
        roundRbtsRewardClaimants: round.rbtsRewardClaimants,
        roundRbtsMeanScoreBps: round.rbtsMeanScoreBps,
        roundRbtsForfeitedPool: round.rbtsForfeitedPool,
        roundRbtsForfeitClaimants: round.rbtsForfeitClaimants,
      })
      .from(vote)
      .leftJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .where(voteMatchesVoter(address))
      .orderBy(desc(vote.committedAt))
      .limit(20);

    const recentRewards = await db
      .select()
      .from(rewardClaim)
      .where(eq(rewardClaim.voter, address))
      .orderBy(desc(rewardClaim.claimedAt))
      .limit(20);
    const [earningsSummary, recentEarnings] = await Promise.all([
      getProfileEarningsSummary(address),
      getRecentProfileEarnings(address, 20),
    ]);

    const recentSubmissions = await db
      .select({
        id: content.id,
        submitter: content.submitter,
        url: content.url,
        title: content.title,
        description: content.description,
        categoryId: content.categoryId,
        categoryName: category.name,
        status: content.status,
        rating: content.rating,
        ratingBps: content.ratingBps,
        conservativeRatingBps: content.conservativeRatingBps,
        ratingConfidenceMass: content.ratingConfidenceMass,
        ratingEffectiveEvidence: content.ratingEffectiveEvidence,
        ratingUpEvidence: content.ratingUpEvidence,
        ratingDownEvidence: content.ratingDownEvidence,
        ratingSettledRounds: content.ratingSettledRounds,
        ratingLowSince: content.ratingLowSince,
        createdAt: content.createdAt,
        totalVotes: content.totalVotes,
        totalRounds: content.totalRounds,
        ...confidentialityContentSelectFields(),
      })
      .from(content)
      .leftJoin(category, eq(content.categoryId, category.id))
      .where(
        and(
          eq(content.submitter, address),
          buildAllowedContentCondition({
            canonicalUrl: content.canonicalUrl,
            description: content.description,
            tags: content.tags,
            title: content.title,
            url: content.url,
            urlHost: content.urlHost,
          }),
        ),
      )
      .orderBy(desc(content.createdAt))
      .limit(6);

    return jsonBig(c, {
      profile: item ?? null,
      summary: {
        totalVotes: voteSummary?.count ?? item?.totalVotes ?? 0,
        totalContent: contentSummary?.count ?? item?.totalContent ?? 0,
        totalRewardsClaimed:
          rewardSummary?.total ?? item?.totalRewardsClaimed ?? 0n,
      },
      earningsSummary: earningsSummary ?? emptyProfileEarningsSummary(),
      social: followStats,
      recentVotes,
      recentRewards,
      recentEarnings,
      recentSubmissions: recentSubmissions.map(item => formatConfidentialContentPreview(item)),
    });
  });
}
