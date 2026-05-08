import { ponder } from "ponder:registry";
import {
  raterClusterScoreChallenge,
  raterClusterScoreHistory,
  raterClusterScore,
  raterProfile,
  raterSelfCredential,
  raterTrustAttestation,
  raterTrustSeed,
} from "ponder:schema";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

ponder.on("RaterRegistry:RaterProfileUpdated", async ({ event, context }) => {
  const { rater, raterType, metadataHash, updatedAt } = event.args;

  await context.db
    .insert(raterProfile)
    .values({
      address: rater,
      raterType: Number(raterType),
      metadataHash,
      updatedAt,
    })
    .onConflictDoUpdate({
      raterType: Number(raterType),
      metadataHash,
      updatedAt,
    });
});

ponder.on("RaterRegistry:SelfCredentialAttested", async ({ event, context }) => {
  const { rater, nullifierHash, scope, legacy, verifiedAt, expiresAt, multiplierBps, evidenceHash } = event.args;

  await context.db
    .insert(raterSelfCredential)
    .values({
      rater,
      verified: true,
      legacy,
      revoked: false,
      nullifierHash,
      scope,
      verifiedAt,
      expiresAt,
      multiplierBps: Number(multiplierBps),
      evidenceHash,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      verified: true,
      legacy,
      revoked: false,
      nullifierHash,
      scope,
      verifiedAt,
      expiresAt,
      multiplierBps: Number(multiplierBps),
      evidenceHash,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:SelfCredentialRevoked", async ({ event, context }) => {
  const { rater } = event.args;

  await context.db
    .insert(raterSelfCredential)
    .values({
      rater,
      verified: false,
      legacy: false,
      revoked: true,
      nullifierHash: event.args.nullifierHash,
      scope: ZERO_HASH,
      verifiedAt: event.block.timestamp,
      expiresAt: event.block.timestamp,
      multiplierBps: 10_000,
      evidenceHash: ZERO_HASH,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      revoked: true,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:TrustSeedSet", async ({ event, context }) => {
  const { rater, seededAt, sunsetAt, trustBudgetBps, seedRoot } = event.args;

  await context.db
    .insert(raterTrustSeed)
    .values({
      rater,
      active: true,
      seededAt,
      sunsetAt,
      trustBudgetBps: Number(trustBudgetBps),
      seedRoot,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      active: true,
      seededAt,
      sunsetAt,
      trustBudgetBps: Number(trustBudgetBps),
      seedRoot,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:TrustSeedRevoked", async ({ event, context }) => {
  const { rater } = event.args;

  await context.db
    .insert(raterTrustSeed)
    .values({
      rater,
      active: false,
      seededAt: event.block.timestamp,
      sunsetAt: event.block.timestamp,
      trustBudgetBps: 0,
      seedRoot: ZERO_HASH,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      active: false,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:ClusterScoreUpdated", async ({ event, context }) => {
  const { rater, clusterId, discountBps, scorerEpoch, updatedAt } = event.args;

  await context.db
    .insert(raterClusterScore)
    .values({
      rater,
      clusterId,
      discountBps: Number(discountBps),
      scorerEpoch,
      algorithmHash: ZERO_HASH,
      modelVersionHash: ZERO_HASH,
      scoreRoot: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      challengeWindowEndsAt: 0n,
      scoreKey: ZERO_HASH,
      updatedAt,
    })
    .onConflictDoUpdate({
      clusterId,
      discountBps: Number(discountBps),
      scorerEpoch,
      algorithmHash: ZERO_HASH,
      modelVersionHash: ZERO_HASH,
      scoreRoot: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      challengeWindowEndsAt: 0n,
      scoreKey: ZERO_HASH,
      updatedAt,
    });
});

ponder.on(
  "RaterRegistry:VersionedClusterScorePublished",
  async ({ event, context }) => {
    const {
      rater,
      scorerEpoch,
      modelVersionHash,
      clusterId,
      discountBps,
      algorithmHash,
      scoreRoot,
      evidenceHash,
      challengeWindowEndsAt,
      updatedAt,
      scoreKey,
    } = event.args;

    const values = {
      rater,
      clusterId,
      discountBps: Number(discountBps),
      scorerEpoch,
      algorithmHash,
      modelVersionHash,
      scoreRoot,
      evidenceHash,
      challengeWindowEndsAt,
      scoreKey,
      updatedAt,
    };

    await context.db
      .insert(raterClusterScore)
      .values(values)
      .onConflictDoUpdate(values);

    await context.db
      .insert(raterClusterScoreHistory)
      .values({
        id: scoreKey,
        ...values,
      })
      .onConflictDoUpdate(values);
  },
);

ponder.on(
  "RaterRegistry:ClusterScoreChallengeOpened",
  async ({ event, context }) => {
    const {
      challengeId,
      challenger,
      scoreKey,
      rater,
      scorerEpoch,
      algorithmHash,
      modelVersionHash,
      evidenceHash,
      openedAt,
    } = event.args;

    await context.db
      .insert(raterClusterScoreChallenge)
      .values({
        challengeId,
        challenger,
        rater,
        scorerEpoch,
        algorithmHash,
        modelVersionHash,
        scoreKey,
        evidenceHash,
        resolutionHash: null,
        status: 1,
        openedAt,
        resolvedAt: null,
      })
      .onConflictDoNothing();
  },
);

ponder.on(
  "RaterRegistry:ClusterScoreChallengeResolved",
  async ({ event, context }) => {
    const { challengeId, status, resolutionHash, resolvedAt } = event.args;

    await context.db.update(raterClusterScoreChallenge, { challengeId }).set({
      status: Number(status),
      resolutionHash,
      resolvedAt,
    });
  },
);

ponder.on("RaterRegistry:TrustAttestationSet", async ({ event, context }) => {
  const { attestationId, issuer, subject, categoryId, trustBudget, maxBoostBps, expiresAt, metadataHash } =
    event.args;

  await context.db
    .insert(raterTrustAttestation)
    .values({
      id: attestationId,
      issuer,
      subject,
      categoryId,
      trustBudget,
      maxBoostBps: Number(maxBoostBps),
      expiresAt,
      metadataHash,
      issuedAt: event.block.timestamp,
      revoked: false,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      issuer,
      subject,
      categoryId,
      trustBudget,
      maxBoostBps: Number(maxBoostBps),
      expiresAt,
      metadataHash,
      revoked: false,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:TrustAttestationRevoked", async ({ event, context }) => {
  const { attestationId, issuer, subject } = event.args;

  await context.db
    .insert(raterTrustAttestation)
    .values({
      id: attestationId,
      issuer,
      subject,
      categoryId: 0n,
      trustBudget: 0n,
      maxBoostBps: 10_000,
      expiresAt: event.block.timestamp,
      metadataHash: ZERO_HASH,
      issuedAt: event.block.timestamp,
      revoked: true,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      revoked: true,
      updatedAt: event.block.timestamp,
    });
});
