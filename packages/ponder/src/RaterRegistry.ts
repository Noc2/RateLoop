import { ponder } from "ponder:registry";
import {
  raterFollow,
  raterProfile,
  raterSelfCredential,
  raterTrustAttestation,
  raterTrustSeed,
} from "ponder:schema";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

function followId(follower: `0x${string}`, target: `0x${string}`) {
  return `${follower}-${target}`;
}

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

ponder.on("RaterRegistry:ProfileFollowed", async ({ event, context }) => {
  const { follower, target, followedAt } = event.args;

  await context.db
    .insert(raterFollow)
    .values({
      id: followId(follower, target),
      follower,
      target,
      active: true,
      createdAt: followedAt,
      unfollowedAt: null,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      follower,
      target,
      active: true,
      createdAt: followedAt,
      unfollowedAt: null,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:ProfileUnfollowed", async ({ event, context }) => {
  const { follower, target, unfollowedAt } = event.args;

  await context.db
    .insert(raterFollow)
    .values({
      id: followId(follower, target),
      follower,
      target,
      active: false,
      createdAt: unfollowedAt,
      unfollowedAt,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      follower,
      target,
      active: false,
      unfollowedAt,
      updatedAt: event.block.timestamp,
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
