import { ponder } from "ponder:registry";
import {
  raterClusterScore,
  raterProfile,
  raterSelfCredential,
  raterTrustAttestation,
  raterTrustSeed,
} from "ponder:schema";

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
      scope: "0x0000000000000000000000000000000000000000000000000000000000000000",
      verifiedAt: event.block.timestamp,
      expiresAt: event.block.timestamp,
      multiplierBps: 10_000,
      evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
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
      seedRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
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
      updatedAt,
    })
    .onConflictDoUpdate({
      clusterId,
      discountBps: Number(discountBps),
      scorerEpoch,
      updatedAt,
    });
});

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
      metadataHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      issuedAt: event.block.timestamp,
      revoked: true,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      revoked: true,
      updatedAt: event.block.timestamp,
    });
});
