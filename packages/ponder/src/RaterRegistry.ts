import { ponder } from "ponder:registry";
import {
  raterFollow,
  raterHumanCredential,
  raterProfile,
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

ponder.on("RaterRegistry:HumanCredentialVerified", async ({ event, context }) => {
  const { rater, nullifierHash, scope, provider, verifiedAt, expiresAt, evidenceHash } = event.args;

  await context.db
    .insert(raterHumanCredential)
    .values({
      rater,
      verified: true,
      revoked: false,
      provider: Number(provider),
      nullifierHash,
      scope,
      verifiedAt,
      expiresAt,
      evidenceHash,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      verified: true,
      revoked: false,
      provider: Number(provider),
      nullifierHash,
      scope,
      verifiedAt,
      expiresAt,
      evidenceHash,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:HumanCredentialRevoked", async ({ event, context }) => {
  const { rater } = event.args;

  await context.db
    .insert(raterHumanCredential)
    .values({
      rater,
      verified: false,
      revoked: true,
      provider: 0,
      nullifierHash: event.args.nullifierHash,
      scope: ZERO_HASH,
      verifiedAt: event.block.timestamp,
      expiresAt: event.block.timestamp,
      evidenceHash: ZERO_HASH,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      revoked: true,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:TrustSeedSet", async ({ event, context }) => {
  const { rater, seededAt, sunsetAt, seedRoot } = event.args;

  await context.db
    .insert(raterTrustSeed)
    .values({
      rater,
      active: true,
      seededAt,
      sunsetAt,
      seedRoot,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      active: true,
      seededAt,
      sunsetAt,
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
      seedRoot: ZERO_HASH,
      updatedAt: event.block.timestamp,
    })
    .onConflictDoUpdate({
      active: false,
      updatedAt: event.block.timestamp,
    });
});

ponder.on("RaterRegistry:TrustAttestationSet", async ({ event, context }) => {
  const { attestationId, issuer, subject, categoryId, maxBoostBps, expiresAt, metadataHash } = event.args;

  await context.db
    .insert(raterTrustAttestation)
    .values({
      id: attestationId,
      issuer,
      subject,
      categoryId,
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
