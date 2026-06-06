import { ContentRegistryAbi } from "@rateloop/contracts/abis";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { eq } from "ponder";
import { decodeEventLog } from "viem";
import { ponder } from "ponder:registry";
import {
  category,
  content,
  contentMedia,
  globalStats,
  profile,
  questionBundleQuestion,
  ratingChange,
  round,
} from "ponder:schema";
import { getCanonicalUrlParts } from "./urlCanonicalization.js";

const CONTENT_REGISTRY_MEDIA_VALIDATOR_ABI = [
  {
    type: "function",
    name: "submissionMediaValidator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

function displayRatingFromBps(ratingBps: number) {
  return Math.min(100, Math.max(0, Math.round(ratingBps / 100)));
}

function contentRegistryAddress(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
) {
  const address = Array.isArray(context.contracts.ContentRegistry.address)
    ? context.contracts.ContentRegistry.address[0]
    : context.contracts.ContentRegistry.address;

  if (!address) {
    throw new Error("Missing ContentRegistry address in Ponder context");
  }

  return address;
}

async function readRatingStateAtEventBlock(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  contentId: bigint,
) {
  return context.client.readContract({
    abi: ContentRegistryAbi,
    address: contentRegistryAddress(context),
    functionName: "getRatingState",
    args: [contentId],
  });
}

async function readContentRoundConfigAtEventBlock(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  contentId: bigint,
) {
  return context.client.readContract({
    abi: ContentRegistryAbi,
    address: contentRegistryAddress(context),
    functionName: "getContentRoundConfig",
    args: [contentId],
  });
}

async function readSubmissionMediaValidatorAddress(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
) {
  return (
    await context.client.readContract({
      abi: CONTENT_REGISTRY_MEDIA_VALIDATOR_ABI,
      address: contentRegistryAddress(context),
      functionName: "submissionMediaValidator",
    })
  ).toLowerCase();
}

function mediaRowId(contentId: bigint, mediaIndex: number) {
  return `${contentId.toString()}-${mediaIndex}`;
}

function mediaUrlParts(url: string) {
  const canonical = getCanonicalUrlParts(url);
  return {
    canonicalUrl: canonical?.canonicalUrl ?? url.trim(),
    urlHost: canonical?.urlHost ?? "",
  };
}

async function resolveQuestionContentAnchorsFromReceipt(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  event: Parameters<Parameters<typeof ponder.on>[1]>[0]["event"],
  contentId: bigint,
) {
  const txHash = event.transaction?.hash;
  if (!txHash) return [];

  const mediaValidatorAddress =
    await readSubmissionMediaValidatorAddress(context);
  const receipt = await context.client.getTransactionReceipt({ hash: txHash });
  const anchors: Array<{
    mediaIndex: number;
    mediaType: number;
    questionMetadataHash: `0x${string}`;
    resultSpecHash: `0x${string}`;
    url: string;
  }> = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== mediaValidatorAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: ContentRegistryAbi,
        data: log.data,
        topics: log.topics,
      });

      if (
        decoded.eventName === "QuestionContentAnchored" &&
        decoded.args.contentId === contentId
      ) {
        anchors.push({
          mediaIndex: Number(decoded.args.mediaIndex),
          mediaType: Number(decoded.args.mediaType),
          questionMetadataHash: decoded.args.questionMetadataHash,
          resultSpecHash: decoded.args.resultSpecHash,
          url: decoded.args.url,
        });
      }
    } catch {
      // Ignore unrelated logs in the same transaction.
    }
  }

  return anchors.sort((a, b) => a.mediaIndex - b.mediaIndex);
}

async function upsertContentAnchors(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  contentId: bigint,
  anchors: Awaited<ReturnType<typeof resolveQuestionContentAnchorsFromReceipt>>,
) {
  const firstAnchor = anchors[0];
  if (!firstAnchor) return;

  await context.db.update(content, { id: contentId }).set({
    questionMetadataHash: firstAnchor.questionMetadataHash,
    resultSpecHash: firstAnchor.resultSpecHash,
  });

  for (const anchor of anchors) {
    if (anchor.mediaType !== 1 && anchor.mediaType !== 2) continue;
    if (!anchor.url) continue;
    const urlParts = mediaUrlParts(anchor.url);

    await context.db
      .insert(contentMedia)
      .values({
        id: mediaRowId(contentId, anchor.mediaIndex),
        contentId,
        mediaIndex: anchor.mediaIndex,
        mediaType: anchor.mediaType === 1 ? "image" : "video",
        url: anchor.url,
        canonicalUrl: urlParts.canonicalUrl,
        urlHost: urlParts.urlHost,
      })
      .onConflictDoUpdate(() => ({
        mediaType: anchor.mediaType === 1 ? "image" : "video",
        url: anchor.url,
        canonicalUrl: urlParts.canonicalUrl,
        urlHost: urlParts.urlHost,
      }));
  }
}

async function findBundleQuestionByContentId(
  context: Parameters<Parameters<typeof ponder.on>[1]>[0]["context"],
  contentId: bigint,
) {
  const [bundleQuestion] = await context.db.sql
    .select()
    .from(questionBundleQuestion)
    .where(eq(questionBundleQuestion.contentId, contentId))
    .limit(1);

  return bundleQuestion;
}

ponder.on("ContentRegistry:ContentSubmitted", async ({ event, context }) => {
  const {
    contentId,
    submitter,
    contentHash,
    url,
    title,
    description,
    tags,
    categoryId,
  } = event.args;
  const canonicalUrl = getCanonicalUrlParts(url);
  const roundConfig = await readContentRoundConfigAtEventBlock(
    context,
    contentId,
  );
  const bundleQuestion = await findBundleQuestionByContentId(
    context,
    contentId,
  );

  await context.db
    .insert(content)
    .values({
      id: contentId,
      submitter,
      contentHash,
      url,
      canonicalUrl: canonicalUrl?.canonicalUrl ?? url.trim(),
      urlHost: canonicalUrl?.urlHost ?? "",
      title,
      description,
      tags,
      categoryId,
      status: 0,
      rating: 50,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      ratingConfidenceMass: 0n,
      ratingEffectiveEvidence: 0n,
      ratingUpEvidence: 0n,
      ratingDownEvidence: 0n,
      ratingSettledRounds: 0,
      ratingLowSince: 0n,
      createdAt: event.block.timestamp,
      lastActivityAt: event.block.timestamp,
      totalVotes: 0,
      totalRounds: 0,
      roundEpochDuration: Number(roundConfig.epochDuration),
      roundMaxDuration: Number(roundConfig.maxDuration),
      roundMinVoters: Number(roundConfig.minVoters),
      roundMaxVoters: Number(roundConfig.maxVoters),
      ...(bundleQuestion
        ? {
            bundleId: bundleQuestion.bundleId,
            bundleIndex: bundleQuestion.bundleIndex,
          }
        : {}),
    })
    .onConflictDoNothing();

  const anchors = await resolveQuestionContentAnchorsFromReceipt(
    context,
    event,
    contentId,
  );
  await upsertContentAnchors(context, contentId, anchors);

  // Increment category content count (skip if category not yet indexed)
  const existingCategory = await context.db.find(category, { id: categoryId });
  if (existingCategory) {
    await context.db
      .update(category, { id: categoryId })
      .set((row) => ({ totalContent: row.totalContent + 1 }));
  }

  // Increment profile content count (skip if profile not yet indexed)
  const existingProfile = await context.db.find(profile, {
    address: submitter,
  });
  if (existingProfile) {
    await context.db
      .update(profile, { address: submitter })
      .set((row) => ({ totalContent: row.totalContent + 1 }));
  }

  // Update global stats
  await context.db
    .insert(globalStats)
    .values({
      id: "global",
      totalContent: 1,
      totalVotes: 0,
      totalRoundsSettled: 0,
      totalRewardsClaimed: 0n,
      totalFrontendFeesClaimed: 0n,
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalContent: row.totalContent + 1,
    }));
});

ponder.on(
  "ContentRegistry:ContentRoundConfigSet",
  async ({ event, context }) => {
    const { contentId, epochDuration, maxDuration, minVoters, maxVoters } =
      event.args;
    const existingContent = await context.db.find(content, { id: contentId });
    if (!existingContent) return;

    await context.db.update(content, { id: contentId }).set({
      roundEpochDuration: Number(epochDuration),
      roundMaxDuration: Number(maxDuration),
      roundMinVoters: Number(minVoters),
      roundMaxVoters: Number(maxVoters),
    });
  },
);

ponder.on(
  "ContentRegistry:ContentDetailsSubmitted",
  async ({ event, context }) => {
    const { contentId, detailsUrl, detailsHash } = event.args;
    const existingContent = await context.db.find(content, { id: contentId });
    if (!existingContent) return;

    await context.db.update(content, { id: contentId }).set({
      detailsUrl,
      detailsHash,
      lastActivityAt: event.block.timestamp,
    });
  },
);

ponder.on(
  "ContentRegistry:QuestionBundleContentLinked",
  async ({ event, context }) => {
    const { bundleId, contentId, bundleIndex } = event.args;
    const normalizedBundleIndex = Number(bundleIndex);
    if (
      !Number.isSafeInteger(normalizedBundleIndex) ||
      normalizedBundleIndex < 0
    ) {
      return;
    }

    const existingContent = await context.db.find(content, { id: contentId });
    if (existingContent) {
      await context.db.update(content, { id: contentId }).set({
        bundleId,
        bundleIndex: normalizedBundleIndex,
        lastActivityAt: event.block.timestamp,
      });
    }

    await context.db
      .insert(questionBundleQuestion)
      .values({
        id: `${bundleId}-${normalizedBundleIndex}`,
        bundleId,
        contentId,
        bundleIndex: normalizedBundleIndex,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate(() => ({
        contentId,
        bundleIndex: normalizedBundleIndex,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on("ContentRegistry:ContentDormant", async ({ event, context }) => {
  const { contentId } = event.args;
  await context.db.update(content, { id: contentId }).set({
    status: 1,
  });
});

ponder.on("ContentRegistry:ContentRevived", async ({ event, context }) => {
  const { contentId } = event.args;
  await context.db.update(content, { id: contentId }).set({
    status: 0,
    lastActivityAt: event.block.timestamp,
  });
});

ponder.on("ContentRegistry:ContentCancelled", async ({ event, context }) => {
  const { contentId } = event.args;
  await context.db.update(content, { id: contentId }).set({
    status: 2,
  });
});

ponder.on("ContentRegistry:RatingUpdated", async ({ event, context }) => {
  const { contentId, newRating } = event.args;
  const newRatingNum = Number(newRating);
  const newRatingBps = newRatingNum * 100;

  await context.db.update(content, { id: contentId }).set({
    rating: newRatingNum,
    ratingBps: newRatingBps,
    conservativeRatingBps: newRatingBps,
    lastActivityAt: event.block.timestamp,
  });
});

ponder.on("ContentRegistry:RatingStateUpdated", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    referenceRatingBps,
    oldRatingBps,
    newRatingBps,
    conservativeRatingBps,
    upEvidence,
    downEvidence,
    confidenceMass,
    effectiveEvidence,
    settledRounds,
  } = event.args;
  const ratingState = await readRatingStateAtEventBlock(context, contentId);
  const lowSince = BigInt(ratingState.lowSince);
  const oldRating = displayRatingFromBps(Number(oldRatingBps));
  const newRating = displayRatingFromBps(Number(newRatingBps));

  await context.db.update(content, { id: contentId }).set({
    rating: newRating,
    ratingBps: Number(newRatingBps),
    conservativeRatingBps: Number(conservativeRatingBps),
    ratingConfidenceMass: confidenceMass,
    ratingEffectiveEvidence: effectiveEvidence,
    ratingUpEvidence: upEvidence,
    ratingDownEvidence: downEvidence,
    ratingSettledRounds: Number(settledRounds),
    ratingLowSince: lowSince,
    lastActivityAt: event.block.timestamp,
  });

  const existingRound = await context.db.find(round, {
    id: `${contentId}-${roundId}`,
  });
  if (existingRound) {
    await context.db.update(round, { id: `${contentId}-${roundId}` }).set({
      referenceRatingBps: Number(referenceRatingBps),
      ratingBps: Number(newRatingBps),
      conservativeRatingBps: Number(conservativeRatingBps),
      confidenceMass,
      effectiveEvidence,
      upEvidence,
      downEvidence,
      settledRounds: Number(settledRounds),
      lowSince,
    });
  } else {
    await context.db.insert(round).values({
      id: `${contentId}-${roundId}`,
      contentId,
      roundId,
      state: ROUND_STATE.Settled,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: Number(referenceRatingBps),
      ratingBps: Number(newRatingBps),
      conservativeRatingBps: Number(conservativeRatingBps),
      confidenceMass,
      effectiveEvidence,
      upEvidence,
      downEvidence,
      settledRounds: Number(settledRounds),
      lowSince,
    });
  }

  await context.db
    .insert(ratingChange)
    .values({
      id: `${contentId}-${roundId}-${event.block.number}`,
      contentId,
      roundId,
      oldRating,
      newRating,
      referenceRatingBps: Number(referenceRatingBps),
      oldRatingBps: Number(oldRatingBps),
      newRatingBps: Number(newRatingBps),
      conservativeRatingBps: Number(conservativeRatingBps),
      confidenceMass,
      effectiveEvidence,
      upEvidence,
      downEvidence,
      settledRounds: Number(settledRounds),
      lowSince,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
});
