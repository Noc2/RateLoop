import { ponder } from "ponder:registry";
import { raterFollow, raterHumanCredential, raterProfile } from "ponder:schema";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

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
      // Fallback createdAt for an unfollow seen before its ProfileFollowed (e.g. the
      // follow predates the indexer start block). The true follow time is unknown
      // here; use the block timestamp. If ProfileFollowed is later indexed, its
      // onConflictDoUpdate restores the real createdAt — and the unfollow path's
      // onConflictDoUpdate below intentionally omits createdAt so it never clobbers it.
      createdAt: event.block.timestamp,
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

ponder.on(
  "RaterRegistry:HumanCredentialVerified",
  async ({ event, context }) => {
    const {
      rater,
      nullifierHash,
      scope,
      provider,
      verifiedAt,
      expiresAt,
      evidenceHash,
    } = event.args;

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
  },
);

ponder.on(
  "RaterRegistry:HumanCredentialRevoked",
  async ({ event, context }) => {
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
  },
);
