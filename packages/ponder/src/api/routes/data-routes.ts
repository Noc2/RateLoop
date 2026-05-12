import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, desc, eq, gte, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  category,
  content,
  feedbackBonusAward,
  feedbackBonusPool,
  frontend,
  globalStats,
  questionBundleClaim,
  questionBundleQuestion,
  questionBundleRound,
  questionBundleRoundSet,
  questionBundleReward,
  questionRewardPool,
  questionRewardPoolClaim,
  questionRewardPoolRound,
  aiRaterDeclaration,
  aiRaterDeclarationChallenge,
  aiRaterDeclarationHistory,
  aiRaterDriftFlag,
  aiRaterOperatorBond,
  aiRaterProbeResult,
  raterProfile,
  raterSelfCredential,
  rewardClaim,
  round,
  tokenTransfer,
  vote,
  voterCategoryStats,
  dailyVoteActivity,
  voterId,
  voterStats,
  voterStreak,
} from "ponder:schema";
import type { ApiApp } from "../shared.js";
import {
  AVATAR_CATEGORY_WINDOW_SECONDS,
  jsonBig,
  parseAddressList,
  parseBigIntList,
} from "../shared.js";
import { isValidAddress, safeBigInt, safeLimit, safeOffset } from "../utils.js";
import { deriveEffectiveVoterStreak } from "../../streak-utils.js";

const VOTE_COOLDOWN_SECONDS = 24 * 60 * 60;
const VERIFIED_AGENT_MULTIPLIER_BPS = 11_500;
const UNVERIFIED_AGENT_MULTIPLIER_BPS = 10_500;
const BASE_RATER_MULTIPLIER_BPS = 10_000;
const MAX_COMBINED_RATER_WEIGHT_BPS = 12_500;
const OPEN_CHALLENGE_STATUS = 1;

const STREAK_MILESTONES = [
  { days: 7, baseBonus: 10 },
  { days: 30, baseBonus: 50 },
  { days: 90, baseBonus: 200 },
];

const AI_RATER_TIERS = ["A0", "A1Unverified", "A1Verified"] as const;
const RATER_TYPES = ["Unknown", "Human", "AI", "Team", "Hybrid"] as const;

function aiTierName(tier: number | null | undefined) {
  return AI_RATER_TIERS[tier ?? 0] ?? "A0";
}

function aiTierMultiplierBps(tier: number | null | undefined) {
  if (tier === 2) return VERIFIED_AGENT_MULTIPLIER_BPS;
  if (tier === 1) return UNVERIFIED_AGENT_MULTIPLIER_BPS;
  return BASE_RATER_MULTIPLIER_BPS;
}

function maxBigInt(values: Array<bigint | number | null | undefined>) {
  let max: bigint | null = null;
  for (const value of values) {
    if (value == null) continue;
    const next = typeof value === "bigint" ? value : BigInt(value);
    if (max === null || next > max) max = next;
  }
  return max;
}

function raterTypeName(raterType: number | null | undefined) {
  return RATER_TYPES[raterType ?? 0] ?? "Unknown";
}

function credentialStatus(
  credential:
    | {
        verified: boolean;
        revoked: boolean;
        expiresAt: bigint;
      }
    | undefined,
  nowSeconds: bigint,
) {
  if (!credential?.verified) return "missing";
  if (credential.revoked) return "revoked";
  if (credential.expiresAt !== 0n && credential.expiresAt <= nowSeconds)
    return "expired";
  return "verified";
}

function probeStatus(
  declaration: { probePending: boolean } | undefined,
  latestProbe: { passed: boolean } | undefined,
) {
  if (!declaration) return "none";
  if (declaration.probePending) return "pending";
  if (!latestProbe) return "none";
  return latestProbe.passed ? "passed" : "failed";
}

function declarationIsActive(
  declaration:
    | {
        retiredAt: bigint | null;
        effectiveEpoch: bigint;
        expiresAtEpoch: bigint;
      }
    | undefined,
  nowSeconds: bigint,
) {
  if (!declaration || declaration.retiredAt != null) return false;
  if (declaration.effectiveEpoch > nowSeconds) return false;
  return (
    declaration.expiresAtEpoch === 0n || nowSeconds < declaration.expiresAtEpoch
  );
}

function declarationInactiveReason(
  declaration:
    | {
        retiredAt: bigint | null;
        effectiveEpoch: bigint;
        expiresAtEpoch: bigint;
      }
    | undefined,
  nowSeconds: bigint,
  openChallengeCount: number,
) {
  if (!declaration) return "missing";
  if (declaration.retiredAt != null) return "retired";
  if (declaration.effectiveEpoch > nowSeconds) return "future";
  if (
    declaration.expiresAtEpoch !== 0n &&
    nowSeconds >= declaration.expiresAtEpoch
  )
    return "expired";
  if (openChallengeCount > 0) return "challenged";
  return "none";
}

function parseOptionalInteger(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseOptionalBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

export function registerDataRoutes(app: ApiApp) {
  app.get("/question-bundles/:id", async (c) => {
    const bundleId = safeBigInt(c.req.param("id"));
    if (bundleId === null) return c.json({ error: "Invalid bundle id" }, 400);

    const [bundle] = await db
      .select()
      .from(questionBundleReward)
      .where(eq(questionBundleReward.id, bundleId))
      .limit(1);

    if (!bundle) {
      return c.json({ error: "Bundle not found" }, 404);
    }

    const questions = await db
      .select({
        id: questionBundleQuestion.id,
        bundleId: questionBundleQuestion.bundleId,
        contentId: questionBundleQuestion.contentId,
        bundleIndex: questionBundleQuestion.bundleIndex,
        updatedAt: questionBundleQuestion.updatedAt,
        title: content.title,
        description: content.description,
        url: content.url,
        submitter: content.submitter,
        categoryId: content.categoryId,
        status: content.status,
        rating: content.rating,
        ratingBps: content.ratingBps,
        createdAt: content.createdAt,
      })
      .from(questionBundleQuestion)
      .leftJoin(content, eq(questionBundleQuestion.contentId, content.id))
      .where(eq(questionBundleQuestion.bundleId, bundleId))
      .orderBy(asc(questionBundleQuestion.bundleIndex));

    const rounds = await db
      .select()
      .from(questionBundleRound)
      .where(eq(questionBundleRound.bundleId, bundleId))
      .orderBy(
        asc(questionBundleRound.roundSetIndex),
        asc(questionBundleRound.bundleIndex),
      );

    const roundSets = await db
      .select()
      .from(questionBundleRoundSet)
      .where(eq(questionBundleRoundSet.bundleId, bundleId))
      .orderBy(asc(questionBundleRoundSet.roundSetIndex));

    return jsonBig(c, { bundle, questions, rounds, roundSets });
  });

  app.get("/question-bundle-claim-candidates", async (c) => {
    const voterRaw = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 100, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    if (!voterRaw) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    const voterAddrs = parseAddressList(voterRaw);
    if (voterAddrs.length === 0) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    const items = await db
      .select({
        bundleId: questionBundleReward.id,
        roundSetIndex: questionBundleRoundSet.roundSetIndex,
        asset: questionBundleReward.asset,
        fundedAmount: questionBundleReward.fundedAmount,
        claimedAmount: questionBundleReward.claimedAmount,
        allocation: questionBundleRoundSet.allocation,
        roundSetClaimedAmount: questionBundleRoundSet.claimedAmount,
        requiredCompleters: questionBundleReward.requiredCompleters,
        requiredSettledRounds: questionBundleReward.requiredSettledRounds,
        questionCount: questionBundleReward.questionCount,
        completedRoundSetCount: questionBundleReward.completedRoundSetCount,
        totalRecordedQuestionRounds:
          questionBundleReward.totalRecordedQuestionRounds,
        claimedCount: questionBundleReward.claimedCount,
        roundSetClaimedCount: questionBundleRoundSet.claimedCount,
        bountyClosesAt: questionBundleReward.bountyClosesAt,
        feedbackClosesAt: questionBundleReward.feedbackClosesAt,
        expiresAt: questionBundleReward.expiresAt,
        updatedAt: questionBundleRoundSet.updatedAt,
      })
      .from(questionBundleRoundSet)
      .innerJoin(
        questionBundleReward,
        eq(questionBundleRoundSet.bundleId, questionBundleReward.id),
      )
      .innerJoin(
        questionBundleRound,
        and(
          eq(questionBundleRound.bundleId, questionBundleRoundSet.bundleId),
          eq(
            questionBundleRound.roundSetIndex,
            questionBundleRoundSet.roundSetIndex,
          ),
        ),
      )
      .innerJoin(
        vote,
        and(
          eq(vote.contentId, questionBundleRound.contentId),
          eq(vote.roundId, questionBundleRound.roundId),
          inArray(vote.voter, voterAddrs),
          eq(vote.revealed, true),
        ),
      )
      .where(
        and(
          eq(questionBundleReward.failed, false),
          eq(questionBundleReward.refunded, false),
          sql`${questionBundleRoundSet.claimedCount} < ${questionBundleReward.requiredCompleters}`,
        ),
      )
      .groupBy(
        questionBundleReward.id,
        questionBundleRoundSet.roundSetIndex,
        questionBundleReward.asset,
        questionBundleReward.fundedAmount,
        questionBundleReward.claimedAmount,
        questionBundleRoundSet.allocation,
        questionBundleRoundSet.claimedAmount,
        questionBundleReward.requiredCompleters,
        questionBundleReward.requiredSettledRounds,
        questionBundleReward.questionCount,
        questionBundleReward.completedRoundSetCount,
        questionBundleReward.totalRecordedQuestionRounds,
        questionBundleReward.claimedCount,
        questionBundleRoundSet.claimedCount,
        questionBundleReward.bountyClosesAt,
        questionBundleReward.feedbackClosesAt,
        questionBundleReward.expiresAt,
        questionBundleRoundSet.updatedAt,
      )
      .having(
        sql`count(distinct ${questionBundleRound.bundleIndex}) >= ${questionBundleReward.questionCount}`,
      )
      .orderBy(
        desc(questionBundleRoundSet.updatedAt),
        desc(questionBundleReward.id),
        desc(questionBundleRoundSet.roundSetIndex),
      )
      .limit(limit)
      .offset(offset);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        currency: item.asset === 0 ? "LREP" : "USDC",
        displayCurrency: item.asset === 0 ? "LREP" : "USD",
        decimals: 6,
      })),
      limit,
      offset,
    });
  });

  app.get("/voter-accuracy/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [stats] = await db
      .select()
      .from(voterStats)
      .where(eq(voterStats.voter, address))
      .limit(1);

    const categoryRows = await db
      .select({
        id: voterCategoryStats.id,
        voter: voterCategoryStats.voter,
        categoryId: voterCategoryStats.categoryId,
        totalSettledVotes: voterCategoryStats.totalSettledVotes,
        totalWins: voterCategoryStats.totalWins,
        totalLosses: voterCategoryStats.totalLosses,
        totalStakeWon: voterCategoryStats.totalStakeWon,
        totalStakeLost: voterCategoryStats.totalStakeLost,
        categoryName: category.name,
      })
      .from(voterCategoryStats)
      .leftJoin(category, eq(voterCategoryStats.categoryId, category.id))
      .where(eq(voterCategoryStats.voter, address));

    const statsWithRate = stats
      ? {
          ...stats,
          winRate:
            stats.totalSettledVotes > 0
              ? stats.totalWins / stats.totalSettledVotes
              : 0,
        }
      : null;

    const categories = categoryRows.map((row) => ({
      ...row,
      winRate:
        row.totalSettledVotes > 0 ? row.totalWins / row.totalSettledVotes : 0,
    }));

    return jsonBig(c, { stats: statsWithRate, categories });
  });

  app.get("/rater-reward-status/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const [[profile], [selfCredential], [declaration]] = await Promise.all([
      db
        .select()
        .from(raterProfile)
        .where(eq(raterProfile.address, address))
        .limit(1),
      db
        .select()
        .from(raterSelfCredential)
        .where(eq(raterSelfCredential.rater, address))
        .limit(1),
      db
        .select()
        .from(aiRaterDeclaration)
        .where(eq(aiRaterDeclaration.rater, address))
        .limit(1),
    ]);

    const wallSeconds = BigInt(Math.floor(Date.now() / 1000));
    const declarationVersion = declaration?.version ?? null;
    const [[latestProbe], [challengeStats], [latestChallenge]] =
      declarationVersion
        ? await Promise.all([
            db
              .select()
              .from(aiRaterProbeResult)
              .where(
                and(
                  eq(aiRaterProbeResult.rater, address),
                  eq(aiRaterProbeResult.version, declarationVersion),
                ),
              )
              .orderBy(
                desc(aiRaterProbeResult.recordedAt),
                desc(aiRaterProbeResult.id),
              )
              .limit(1),
            db
              .select({
                openCount: sql<number>`count(*)`,
              })
              .from(aiRaterDeclarationChallenge)
              .where(
                and(
                  eq(aiRaterDeclarationChallenge.rater, address),
                  eq(
                    aiRaterDeclarationChallenge.declarationVersion,
                    declarationVersion,
                  ),
                  eq(aiRaterDeclarationChallenge.status, OPEN_CHALLENGE_STATUS),
                ),
              ),
            db
              .select()
              .from(aiRaterDeclarationChallenge)
              .where(
                and(
                  eq(aiRaterDeclarationChallenge.rater, address),
                  eq(
                    aiRaterDeclarationChallenge.declarationVersion,
                    declarationVersion,
                  ),
                ),
              )
              .orderBy(
                desc(aiRaterDeclarationChallenge.openedAt),
                desc(aiRaterDeclarationChallenge.challengeId),
              )
              .limit(1),
          ])
        : [[], [{ openCount: 0 }], []];

    const indexedChainTimestamp =
      maxBigInt([
        profile?.updatedAt,
        selfCredential?.updatedAt,
        declaration?.updatedAt,
        declaration?.declaredAt,
        latestProbe?.recordedAt,
        latestChallenge?.openedAt,
        latestChallenge?.resolvedAt,
      ]) ?? null;
    const statusTimestamp =
      maxBigInt([indexedChainTimestamp, wallSeconds]) ?? wallSeconds;
    const humanCredentialStatus = credentialStatus(
      selfCredential,
      statusTimestamp,
    );
    const humanMultiplierBps =
      humanCredentialStatus === "verified"
        ? (selfCredential?.multiplierBps ?? BASE_RATER_MULTIPLIER_BPS)
        : BASE_RATER_MULTIPLIER_BPS;
    const openChallengeCount = Number(challengeStats?.openCount ?? 0);
    const aiDeclarationInactiveReason = declarationInactiveReason(
      declaration,
      statusTimestamp,
      openChallengeCount,
    );
    const declaredDeclarationTier = declaration?.tier ?? 0;
    const effectiveDeclarationTier =
      aiDeclarationInactiveReason === "none" ? declaredDeclarationTier : 0;
    const agentTierMultiplierBps = aiTierMultiplierBps(
      effectiveDeclarationTier,
    );
    const combinedMultiplierBps = Math.min(
      Math.floor(
        (humanMultiplierBps * agentTierMultiplierBps) /
          BASE_RATER_MULTIPLIER_BPS,
      ),
      MAX_COMBINED_RATER_WEIGHT_BPS,
    );

    return jsonBig(c, {
      asOf: {
        chainTimestamp: indexedChainTimestamp ?? wallSeconds,
        wallTimestamp: wallSeconds,
        indexedBlockNumber: null,
      },
      rater: address,
      raterType: profile?.raterType ?? 0,
      raterTypeName: raterTypeName(profile?.raterType),
      selfCredential: {
        verified: selfCredential?.verified ?? false,
        legacy: selfCredential?.legacy ?? false,
        revoked: selfCredential?.revoked ?? false,
        status: humanCredentialStatus,
        verifiedAt: selfCredential?.verifiedAt ?? null,
        expiresAt: selfCredential?.expiresAt ?? null,
        multiplierBps: humanMultiplierBps,
        evidenceHash: selfCredential?.evidenceHash ?? null,
      },
      aiDeclaration: declaration
        ? {
            declared: true,
            active: aiDeclarationInactiveReason === "none",
            inactiveReason: aiDeclarationInactiveReason,
            operator: declaration.operator,
            version: declaration.version,
            effectiveEpoch: declaration.effectiveEpoch,
            expiresAtEpoch: declaration.expiresAtEpoch,
            effectiveAt: declaration.effectiveEpoch,
            expiresAt:
              declaration.expiresAtEpoch === 0n
                ? null
                : declaration.expiresAtEpoch,
            declaredTier: declaredDeclarationTier,
            declaredTierName: aiTierName(declaredDeclarationTier),
            effectiveTier: effectiveDeclarationTier,
            effectiveTierName: aiTierName(effectiveDeclarationTier),
            tier: effectiveDeclarationTier,
            tierName: aiTierName(effectiveDeclarationTier),
            tierMultiplierBps: agentTierMultiplierBps,
            behaviorChanged: declaration.behaviorChanged,
            probePending: declaration.probePending,
            probeStatus: probeStatus(declaration, latestProbe),
            declarationHash: declaration.declarationHash,
            modelClass: declaration.modelClass,
            modelId: declaration.modelId,
            provider: declaration.provider,
            promptTemplateHash: declaration.promptTemplateHash,
            retrievalConfigHash: declaration.retrievalConfigHash,
            toolingHash: declaration.toolingHash,
            disclosure: declaration.disclosure,
            declaredAt: declaration.declaredAt,
            retiredAt: declaration.retiredAt ?? null,
            lastProbeResultHash: declaration.lastProbeResultHash ?? null,
            latestProbe: latestProbe
              ? {
                  passed: latestProbe.passed,
                  confidenceBps: latestProbe.confidenceBps,
                  probeLibraryHash: latestProbe.probeLibraryHash,
                  resultHash: latestProbe.resultHash,
                  recordedAt: latestProbe.recordedAt,
                }
              : null,
          }
        : {
            declared: false,
            active: false,
            inactiveReason: "missing",
            operator: null,
            version: 0,
            effectiveEpoch: null,
            expiresAtEpoch: null,
            effectiveAt: null,
            expiresAt: null,
            declaredTier: 0,
            declaredTierName: "A0",
            effectiveTier: 0,
            effectiveTierName: "A0",
            tier: 0,
            tierName: "A0",
            tierMultiplierBps: BASE_RATER_MULTIPLIER_BPS,
            behaviorChanged: false,
            probePending: false,
            probeStatus: "none",
            declarationHash: null,
            modelClass: null,
            modelId: null,
            provider: null,
            promptTemplateHash: null,
            retrievalConfigHash: null,
            toolingHash: null,
            disclosure: null,
            declaredAt: null,
            retiredAt: null,
            lastProbeResultHash: null,
            latestProbe: null,
          },
      challengeStatus: {
        openCount: openChallengeCount,
        latestChallengeId: latestChallenge?.challengeId ?? null,
        latestStatus: latestChallenge?.status ?? 0,
        latestResolvedAt: latestChallenge?.resolvedAt ?? null,
        latestOperatorSlash: latestChallenge?.operatorSlash ?? 0n,
        latestChallengerReward: latestChallenge?.challengerReward ?? 0n,
      },
      rewardPolicy: {
        baseMultiplierBps: BASE_RATER_MULTIPLIER_BPS,
        humanCredentialMultiplierBps: humanMultiplierBps,
        agentTierMultiplierBps,
        combinedMultiplierBps,
        combinedMultiplierCapBps: MAX_COMBINED_RATER_WEIGHT_BPS,
        verifiedAgentsCanAnchorLaunchRewards: false,
        verifiedAgentSignupBonusEligible: false,
      },
    });
  });

  app.get("/ai-rater-declarations", async (c) => {
    const operatorRaw = c.req.query("operator");
    const tier = parseOptionalInteger(c.req.query("tier"));
    const probePending = parseOptionalBoolean(c.req.query("probePending"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (tier === null) return c.json({ error: "Invalid tier" }, 400);
    if (probePending === null) {
      return c.json({ error: "Invalid probePending filter" }, 400);
    }

    const conditions = [];
    if (operatorRaw) {
      if (!isValidAddress(operatorRaw)) {
        return c.json({ error: "Invalid operator address" }, 400);
      }
      conditions.push(
        eq(aiRaterDeclaration.operator, operatorRaw.toLowerCase() as `0x${string}`),
      );
    }
    if (tier !== undefined) conditions.push(eq(aiRaterDeclaration.tier, tier));
    if (probePending !== undefined) {
      conditions.push(eq(aiRaterDeclaration.probePending, probePending));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select()
      .from(aiRaterDeclaration)
      .where(where)
      .orderBy(desc(aiRaterDeclaration.declaredAt), desc(aiRaterDeclaration.version))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items, limit, offset });
  });

  app.get("/ai-rater-declarations/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const [declaration] = await db
      .select()
      .from(aiRaterDeclaration)
      .where(eq(aiRaterDeclaration.rater, address))
      .limit(1);

    return jsonBig(c, { declaration: declaration ?? null });
  });

  app.get("/ai-rater-declarations/:address/history", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const version = parseOptionalInteger(c.req.query("version"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (version === null) return c.json({ error: "Invalid version" }, 400);

    const conditions = [eq(aiRaterDeclarationHistory.rater, address)];
    if (version !== undefined) {
      conditions.push(eq(aiRaterDeclarationHistory.version, version));
    }

    const items = await db
      .select()
      .from(aiRaterDeclarationHistory)
      .where(and(...conditions))
      .orderBy(
        desc(aiRaterDeclarationHistory.version),
        desc(aiRaterDeclarationHistory.declaredAt),
      )
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items, limit, offset });
  });

  app.get("/ai-rater-declarations/:address/probes", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const version = parseOptionalInteger(c.req.query("version"));
    const passed = parseOptionalBoolean(c.req.query("passed"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (version === null) return c.json({ error: "Invalid version" }, 400);
    if (passed === null) return c.json({ error: "Invalid passed filter" }, 400);

    const conditions = [eq(aiRaterProbeResult.rater, address)];
    if (version !== undefined) {
      conditions.push(eq(aiRaterProbeResult.version, version));
    }
    if (passed !== undefined) {
      conditions.push(eq(aiRaterProbeResult.passed, passed));
    }

    const items = await db
      .select()
      .from(aiRaterProbeResult)
      .where(and(...conditions))
      .orderBy(desc(aiRaterProbeResult.recordedAt), desc(aiRaterProbeResult.id))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items, limit, offset });
  });

  app.get("/ai-rater-declarations/:address/drift-flags", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const version = parseOptionalInteger(c.req.query("version"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (version === null) return c.json({ error: "Invalid version" }, 400);

    const conditions = [eq(aiRaterDriftFlag.rater, address)];
    if (version !== undefined) {
      conditions.push(eq(aiRaterDriftFlag.version, version));
    }

    const items = await db
      .select()
      .from(aiRaterDriftFlag)
      .where(and(...conditions))
      .orderBy(desc(aiRaterDriftFlag.flaggedAt), desc(aiRaterDriftFlag.id))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items, limit, offset });
  });

  app.get("/ai-rater-declarations/:address/challenges", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const version = parseOptionalInteger(c.req.query("version"));
    const status = parseOptionalInteger(c.req.query("status"));
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (version === null) return c.json({ error: "Invalid version" }, 400);
    if (status === null) return c.json({ error: "Invalid status filter" }, 400);

    const conditions = [eq(aiRaterDeclarationChallenge.rater, address)];
    if (version !== undefined) {
      conditions.push(
        eq(aiRaterDeclarationChallenge.declarationVersion, version),
      );
    }
    if (status !== undefined) {
      conditions.push(eq(aiRaterDeclarationChallenge.status, status));
    }

    const items = await db
      .select()
      .from(aiRaterDeclarationChallenge)
      .where(and(...conditions))
      .orderBy(
        desc(aiRaterDeclarationChallenge.openedAt),
        desc(aiRaterDeclarationChallenge.challengeId),
      )
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items, limit, offset });
  });

  app.get("/ai-rater-operators/:address/bond", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const [bond] = await db
      .select()
      .from(aiRaterOperatorBond)
      .where(eq(aiRaterOperatorBond.operator, address))
      .limit(1);

    return jsonBig(c, {
      bond: bond ?? { operator: address, totalBond: 0n, updatedAt: null },
    });
  });

  app.get("/avatar/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [stats, streak, streakActivity, voterIdRecord] = await Promise.all([
      db
        .select()
        .from(voterStats)
        .where(eq(voterStats.voter, address))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(voterStreak)
        .where(eq(voterStreak.voter, address))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          date: dailyVoteActivity.date,
        })
        .from(dailyVoteActivity)
        .where(eq(dailyVoteActivity.voter, address))
        .orderBy(asc(dailyVoteActivity.date)),
      db
        .select({
          tokenId: voterId.tokenId,
          mintedAt: voterId.mintedAt,
        })
        .from(voterId)
        .where(and(eq(voterId.holder, address), eq(voterId.revoked, false)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const categoryCutoff = BigInt(
      Math.max(
        0,
        Math.floor(Date.now() / 1000) - AVATAR_CATEGORY_WINDOW_SECONDS,
      ),
    );
    const categoryRows = await db
      .select({
        categoryId: content.categoryId,
        categoryName: category.name,
        settledVotes90d: sql<number>`count(*)`,
        wins90d: sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 1 else 0 end else case when ${vote.isUp} = ${round.upWins} then 1 else 0 end end)`,
        losses90d: sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 0 else 1 end else case when ${vote.isUp} = ${round.upWins} then 0 else 1 end end)`,
        stakeWon90d: sql<bigint>`coalesce(sum(case when ${vote.rbtsStakeReturned} is not null then coalesce(${vote.rbtsStakeReturned}, 0) else case when ${vote.isUp} = ${round.upWins} then ${vote.stake} else 0 end end), 0)`,
        stakeLost90d: sql<bigint>`coalesce(sum(case when ${vote.rbtsForfeitedStake} is not null then coalesce(${vote.rbtsForfeitedStake}, ${vote.stake}) else case when ${vote.isUp} = ${round.upWins} then 0 else ${vote.stake} end end), 0)`,
        lastSettledAt: sql<bigint>`max(${round.settledAt})`,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .innerJoin(content, eq(vote.contentId, content.id))
      .leftJoin(category, eq(content.categoryId, category.id))
      .where(
        and(
          eq(vote.voter, address),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          gte(round.settledAt, categoryCutoff),
        ),
      )
      .groupBy(content.categoryId, category.name);

    const statsWithRate = stats
      ? {
          ...stats,
          winRate:
            stats.totalSettledVotes > 0
              ? stats.totalWins / stats.totalSettledVotes
              : 0,
        }
      : null;

    const categories90d = categoryRows
      .map((row) => {
        const stakeWon =
          typeof row.stakeWon90d === "bigint"
            ? row.stakeWon90d
            : BigInt(row.stakeWon90d ?? 0);
        const stakeLost =
          typeof row.stakeLost90d === "bigint"
            ? row.stakeLost90d
            : BigInt(row.stakeLost90d ?? 0);
        const settledVotes = Number(row.settledVotes90d);
        const wins = Number(row.wins90d);
        const losses = Number(row.losses90d);
        return {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          settledVotes90d: settledVotes,
          wins90d: wins,
          losses90d: losses,
          stakeWon90d: stakeWon,
          stakeLost90d: stakeLost,
          totalStake90d: stakeWon + stakeLost,
          winRate90d: settledVotes > 0 ? wins / settledVotes : 0,
          lastSettledAt: row.lastSettledAt,
        };
      })
      .sort((a, b) => {
        if (b.settledVotes90d !== a.settledVotes90d)
          return b.settledVotes90d - a.settledVotes90d;
        if (a.categoryId < b.categoryId) return -1;
        if (a.categoryId > b.categoryId) return 1;
        return 0;
      });

    const effectiveStreak = deriveEffectiveVoterStreak(
      streakActivity.map((row) => row.date),
      streak,
    );

    return jsonBig(c, {
      address,
      voterId: voterIdRecord,
      stats: statsWithRate,
      streak: effectiveStreak,
      categories90d,
    });
  });

  app.get("/voter-stats-batch", async (c) => {
    const votersParam = c.req.query("voters");
    if (!votersParam) {
      return c.json({ error: "voters parameter required" }, 400);
    }

    const voters = votersParam
      .split(",")
      .slice(0, 50)
      .map((address) => address.trim().toLowerCase() as `0x${string}`)
      .filter((address) => isValidAddress(address));

    if (voters.length === 0) {
      return jsonBig(c, {});
    }

    const items = await db
      .select()
      .from(voterStats)
      .where(inArray(voterStats.voter, voters));

    const statsMap: Record<string, any> = {};
    for (const item of items) {
      statsMap[item.voter.toLowerCase()] = {
        ...item,
        winRate:
          item.totalSettledVotes > 0
            ? item.totalWins / item.totalSettledVotes
            : 0,
      };
    }

    return jsonBig(c, statsMap);
  });

  app.get("/votes", async (c) => {
    const voterRaw = c.req.query("voter");
    const contentId = c.req.query("contentId");
    const roundId = c.req.query("roundId");
    const stateFilter = c.req.query("state");
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const conditions = [];
    if (voterRaw) {
      if (!isValidAddress(voterRaw))
        return c.json({ error: "Invalid voter address" }, 400);
      conditions.push(eq(vote.voter, voterRaw.toLowerCase() as `0x${string}`));
    }
    if (contentId) {
      const parsed = safeBigInt(contentId);
      if (parsed === null) return c.json({ error: "Invalid contentId" }, 400);
      conditions.push(eq(vote.contentId, parsed));
    }
    if (roundId) {
      const parsed = safeBigInt(roundId);
      if (parsed === null) return c.json({ error: "Invalid roundId" }, 400);
      conditions.push(eq(vote.roundId, parsed));
    }
    if (stateFilter !== undefined) {
      const parsed = parseInt(stateFilter);
      if (isNaN(parsed)) return c.json({ error: "Invalid state filter" }, 400);
      conditions.push(eq(round.state, parsed));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        id: vote.id,
        contentId: vote.contentId,
        roundId: vote.roundId,
        voter: vote.voter,
        commitHash: vote.commitHash,
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
      .where(where)
      .orderBy(desc(vote.committedAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({
        settledTotal: sql<number>`sum(case when ${round.state} = ${ROUND_STATE.Settled} then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(vote)
      .leftJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .where(where);

    return jsonBig(c, {
      items,
      total: countResult?.total ?? 0,
      settledTotal: countResult?.settledTotal ?? 0,
      limit,
      offset,
    });
  });

  app.get("/vote-cooldowns", async (c) => {
    const voters = parseAddressList(c.req.query("voters"), 20);
    const contentIds = parseBigIntList(c.req.query("contentIds"), 200);

    if (voters.length === 0) {
      return c.json({ error: "voters parameter required" }, 400);
    }
    if (contentIds.length === 0) {
      return c.json({ error: "contentIds parameter required" }, 400);
    }

    const activeCooldownCutoff = BigInt(
      Math.max(0, Math.floor(Date.now() / 1000) - VOTE_COOLDOWN_SECONDS),
    );
    const items = await db
      .select({
        contentId: vote.contentId,
        latestCommittedAt: sql<bigint>`max(${vote.committedAt})`,
      })
      .from(vote)
      .where(
        and(
          inArray(vote.voter, voters),
          inArray(vote.contentId, contentIds),
          gte(vote.committedAt, activeCooldownCutoff),
        ),
      )
      .groupBy(vote.contentId);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        cooldownEndsAt: item.latestCommittedAt + BigInt(VOTE_COOLDOWN_SECONDS),
      })),
    });
  });

  app.get("/question-reward-claim-candidates", async (c) => {
    const voterRaw = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 100, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    if (!voterRaw) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    const voterAddrs = parseAddressList(voterRaw);
    if (voterAddrs.length === 0) {
      return c.json({ error: "Invalid voter address" }, 400);
    }
    const items = await db
      .select({
        rewardPoolId: questionRewardPool.id,
        contentId: questionRewardPool.contentId,
        asset: questionRewardPool.asset,
        roundId: vote.roundId,
        title: content.title,
        allocation: questionRewardPoolRound.allocation,
        eligibleVoters: questionRewardPoolRound.eligibleVoters,
        rawEligibleVoters: questionRewardPoolRound.rawEligibleVoters,
        effectiveParticipantUnits:
          questionRewardPoolRound.effectiveParticipantUnits,
        totalClaimWeight: questionRewardPoolRound.totalClaimWeight,
        qualified: sql<boolean>`${questionRewardPoolRound.rewardPoolId} is not null`,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .innerJoin(
        questionRewardPool,
        eq(vote.contentId, questionRewardPool.contentId),
      )
      .innerJoin(content, eq(vote.contentId, content.id))
      .leftJoin(
        questionRewardPoolRound,
        and(
          eq(questionRewardPoolRound.rewardPoolId, questionRewardPool.id),
          eq(questionRewardPoolRound.roundId, vote.roundId),
        ),
      )
      .where(
        and(
          inArray(vote.voter, voterAddrs),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          sql`${vote.roundId} >= ${questionRewardPool.startRoundId}`,
          or(
            sql`${questionRewardPoolRound.rewardPoolId} is not null`,
            and(
              eq(questionRewardPool.refunded, false),
              sql`${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}`,
              sql`${round.revealedCount} >= ${questionRewardPool.requiredVoters}`,
              sql`(${questionRewardPool.bountyClosesAt} = 0 or ${round.settledAt} <= ${questionRewardPool.bountyClosesAt})`,
            ),
          ),
        ),
      )
      .orderBy(desc(round.settledAt), desc(questionRewardPool.createdAt))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        currency: item.asset === 0 ? "LREP" : "USDC",
        displayCurrency: item.asset === 0 ? "LREP" : "USD",
        decimals: 6,
      })),
      limit,
      offset,
    });
  });

  app.get("/rewards", async (c) => {
    const voter = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 50, 200);

    if (!voter) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    if (!isValidAddress(voter)) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    // Match on either `voter` (received the voter-pool reward) or `stakePayer`
    // (received the stake refund — different address when a delegate paid the stake).
    const address = voter.toLowerCase() as `0x${string}`;
    const items = await db
      .select()
      .from(rewardClaim)
      .where(
        or(eq(rewardClaim.voter, address), eq(rewardClaim.stakePayer, address)),
      )
      .orderBy(desc(rewardClaim.claimedAt))
      .limit(limit);

    return jsonBig(c, { items });
  });

  app.get("/balance-history", async (c) => {
    const address = c.req.query("address");
    if (!address) {
      return c.json({ error: "address parameter required" }, 400);
    }
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const normalizedAddress = address.toLowerCase() as `0x${string}`;
    const limit = safeLimit(c.req.query("limit"), 500, 1000);

    const transfers = await db
      .select()
      .from(tokenTransfer)
      .where(
        or(
          eq(tokenTransfer.from, normalizedAddress),
          eq(tokenTransfer.to, normalizedAddress),
        ),
      )
      .orderBy(asc(tokenTransfer.blockNumber))
      .limit(limit);

    return jsonBig(c, { transfers, address: normalizedAddress });
  });

  app.get("/stats", async (c) => {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const [
      [stats],
      [rewardPoolStats],
      [bundleRewardStats],
      [feedbackBonusAwardStats],
      [feedbackBonusPoolStats],
      [verifiedHumanStats],
    ] = await Promise.all([
      db
        .select()
        .from(globalStats)
        .where(eq(globalStats.id, "global"))
        .limit(1),
      db
        .select({
          totalQuestionRewardsPaid: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.grossAmount}), 0)`,
          totalQuestionRewardsPaidToVoters: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.amount}), 0)`,
          totalQuestionRewardsPaidToFrontends: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.frontendFee}), 0)`,
        })
        .from(questionRewardPoolClaim),
      db
        .select({
          totalQuestionBundleRewardsPaid: sql<bigint>`coalesce(sum(${questionBundleClaim.grossAmount}), 0)`,
          totalQuestionBundleRewardsPaidToVoters: sql<bigint>`coalesce(sum(${questionBundleClaim.amount}), 0)`,
          totalQuestionBundleRewardsPaidToFrontends: sql<bigint>`coalesce(sum(${questionBundleClaim.frontendFee}), 0)`,
        })
        .from(questionBundleClaim),
      db
        .select({
          totalFeedbackBonusesPaid: sql<bigint>`coalesce(sum(${feedbackBonusAward.grossAmount}), 0)`,
          totalFeedbackBonusesPaidToVoters: sql<bigint>`coalesce(sum(${feedbackBonusAward.recipientAmount}), 0)`,
          totalFeedbackBonusesPaidToFrontends: sql<bigint>`coalesce(sum(${feedbackBonusAward.frontendFee}), 0)`,
        })
        .from(feedbackBonusAward),
      db
        .select({
          totalFeedbackBonusesFunded: sql<bigint>`coalesce(sum(${feedbackBonusPool.fundedAmount}), 0)`,
          totalFeedbackBonusesForfeited: sql<bigint>`coalesce(sum(${feedbackBonusPool.forfeitedAmount}), 0)`,
        })
        .from(feedbackBonusPool),
      db
        .select({
          totalVerifiedHumans: sql<number>`count(*)`,
        })
        .from(raterSelfCredential)
        .where(
          and(
            eq(raterSelfCredential.verified, true),
            eq(raterSelfCredential.revoked, false),
            sql`${raterSelfCredential.expiresAt} > ${nowSeconds}`,
          ),
        ),
    ]);

    const fallbackStats = {
      totalContent: 0,
      totalVotes: 0,
      totalRoundsSettled: 0,
      totalRewardsClaimed: "0",
      totalProfiles: 0,
      totalVoterIds: 0,
      totalVerifiedHumans: 0,
    };

    return jsonBig(c, {
      ...(stats ?? fallbackStats),
      totalVerifiedHumans: verifiedHumanStats?.totalVerifiedHumans ?? 0,
      totalQuestionRewardsPaid: rewardPoolStats?.totalQuestionRewardsPaid ?? 0n,
      totalQuestionRewardsPaidToVoters:
        rewardPoolStats?.totalQuestionRewardsPaidToVoters ?? 0n,
      totalQuestionRewardsPaidToFrontends:
        rewardPoolStats?.totalQuestionRewardsPaidToFrontends ?? 0n,
      totalQuestionBundleRewardsPaid:
        bundleRewardStats?.totalQuestionBundleRewardsPaid ?? 0n,
      totalQuestionBundleRewardsPaidToVoters:
        bundleRewardStats?.totalQuestionBundleRewardsPaidToVoters ?? 0n,
      totalQuestionBundleRewardsPaidToFrontends:
        bundleRewardStats?.totalQuestionBundleRewardsPaidToFrontends ?? 0n,
      totalFeedbackBonusesFunded:
        feedbackBonusPoolStats?.totalFeedbackBonusesFunded ?? 0n,
      totalFeedbackBonusesPaid:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaid ?? 0n,
      totalFeedbackBonusesPaidToVoters:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaidToVoters ?? 0n,
      totalFeedbackBonusesPaidToFrontends:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaidToFrontends ?? 0n,
      totalFeedbackBonusesForfeited:
        feedbackBonusPoolStats?.totalFeedbackBonusesForfeited ?? 0n,
    });
  });

  app.get("/frontends", async (c) => {
    const statusFilter = c.req.query("status") ?? "all";

    let where;
    if (statusFilter === "active" || statusFilter === "eligible") {
      where = eq(frontend.eligible, true);
    } else if (statusFilter === "slashed") {
      where = eq(frontend.slashed, true);
    } else if (statusFilter === "exiting") {
      where = sql`${frontend.exitAvailableAt} is not null`;
    } else if (statusFilter === "inactive" || statusFilter === "pending") {
      where = and(
        eq(frontend.eligible, false),
        eq(frontend.slashed, false),
        sql`${frontend.exitAvailableAt} is null`,
      );
    }
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const items = await db
      .select()
      .from(frontend)
      .where(where)
      .limit(safeLimit(c.req.query("limit"), 100, 500))
      .offset(offset);

    return jsonBig(c, { items });
  });

  app.get("/frontend/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [item] = await db
      .select()
      .from(frontend)
      .where(eq(frontend.address, address))
      .limit(1);

    if (!item) {
      return c.json({ error: "Frontend not found" }, 404);
    }

    return jsonBig(c, { frontend: item });
  });

  app.get("/voter-ids", async (c) => {
    const holder = c.req.query("holder");
    const limit = safeLimit(c.req.query("limit"), 50, 200);

    let where;
    if (holder) {
      if (!isValidAddress(holder))
        return c.json({ error: "Invalid holder address" }, 400);
      where = eq(voterId.holder, holder.toLowerCase() as `0x${string}`);
    }

    const items = await db.select().from(voterId).where(where).limit(limit);

    return jsonBig(c, { items });
  });

  app.get("/voter-streak", async (c) => {
    const voter = c.req.query("voter");
    if (!voter) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    if (!isValidAddress(voter)) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    const voterAddr = voter.toLowerCase() as `0x${string}`;

    const [streak, streakActivity] = await Promise.all([
      db
        .select()
        .from(voterStreak)
        .where(eq(voterStreak.voter, voterAddr))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          date: dailyVoteActivity.date,
        })
        .from(dailyVoteActivity)
        .where(eq(dailyVoteActivity.voter, voterAddr))
        .orderBy(asc(dailyVoteActivity.date)),
    ]);

    const effectiveStreak = deriveEffectiveVoterStreak(
      streakActivity.map((row) => row.date),
      streak,
    );
    const nextMilestone = STREAK_MILESTONES.find(
      (milestone) => milestone.days > effectiveStreak.currentDailyStreak,
    );

    return jsonBig(c, {
      currentDailyStreak: effectiveStreak.currentDailyStreak,
      bestDailyStreak: effectiveStreak.bestDailyStreak,
      totalActiveDays: effectiveStreak.totalActiveDays,
      lastActiveDate: effectiveStreak.lastActiveDate,
      lastMilestoneDay: effectiveStreak.lastMilestoneDay,
      milestones: STREAK_MILESTONES,
      nextMilestone: nextMilestone?.days ?? null,
      nextMilestoneBaseBonus: nextMilestone?.baseBonus ?? null,
    });
  });
}
