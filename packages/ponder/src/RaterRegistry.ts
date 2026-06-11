import { ponder } from "ponder:registry";
import {
  raterFollow,
  raterHumanCredential,
  raterHumanPresence,
  raterIdentityBan,
  raterProfile,
  raterWorldCredential,
} from "ponder:schema";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const WORLD_CREDENTIAL_PROOF_OF_HUMAN = 3;
const HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4 = 2;

type WorldCredentialVerifiedArgs = {
  rater: `0x${string}`;
  kind: number | bigint;
  nullifierHash: `0x${string}`;
  scope: `0x${string}`;
  verifiedAt: bigint;
  expiresAt: bigint;
  evidenceHash: `0x${string}`;
};

type WorldCredentialRevokedArgs = {
  rater: `0x${string}`;
  kind: number | bigint;
  nullifierHash: `0x${string}`;
};

type HumanPresenceVerifiedArgs = {
  rater: `0x${string}`;
  kind: number | bigint;
  nullifierHash: `0x${string}`;
  lastRecheckedAt: bigint;
  freshUntil: bigint;
  evidenceHash: `0x${string}`;
};

function followId(follower: `0x${string}`, target: `0x${string}`) {
  return `${follower}-${target}`;
}

function credentialKindId(rater: `0x${string}`, kind: number) {
  return `${rater}-${kind}`;
}

function identityBanId(provider: number, nullifierHash: `0x${string}`) {
  return `${provider}-${nullifierHash}`;
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
      // Unknown for an unfollow-only row; ProfileFollowed restores the true
      // follow timestamp if that event is later indexed.
      createdAt: 0n,
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
  "RaterRegistry:IdentityBanned" as never,
  async ({ event, context }: any) => {
    const {
      provider,
      nullifierHash,
      expiresAt,
      permanent,
      evidenceHash,
      reason,
    } = event.args as {
      provider: number | bigint;
      nullifierHash: `0x${string}`;
      expiresAt: bigint;
      permanent: boolean;
      evidenceHash: `0x${string}`;
      reason: string;
    };
    const normalizedProvider = Number(provider);

    await context.db
      .insert(raterIdentityBan)
      .values({
        id: identityBanId(normalizedProvider, nullifierHash),
        provider: normalizedProvider,
        nullifierHash,
        active: true,
        permanent,
        expiresAt,
        evidenceHash,
        reason,
        bannedAt: event.block.timestamp,
        unbannedAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        active: true,
        permanent,
        expiresAt,
        evidenceHash,
        reason,
        bannedAt: event.block.timestamp,
        unbannedAt: null,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "RaterRegistry:IdentityUnbanned" as never,
  async ({ event, context }: any) => {
    const { provider, nullifierHash } = event.args as {
      provider: number | bigint;
      nullifierHash: `0x${string}`;
    };
    const normalizedProvider = Number(provider);

    await context.db
      .insert(raterIdentityBan)
      .values({
        id: identityBanId(normalizedProvider, nullifierHash),
        provider: normalizedProvider,
        nullifierHash,
        active: false,
        permanent: false,
        expiresAt: 0n,
        evidenceHash: ZERO_HASH,
        reason: "",
        bannedAt: 0n,
        unbannedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        active: false,
        unbannedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      });
  },
);

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
  "RaterRegistry:WorldCredentialVerified" as never,
  async ({ event, context }: any) => {
    const {
      rater,
      kind,
      nullifierHash,
      scope,
      verifiedAt,
      expiresAt,
      evidenceHash,
    } = event.args as WorldCredentialVerifiedArgs;
    const credentialKind = Number(kind);

    await context.db
      .insert(raterWorldCredential)
      .values({
        id: credentialKindId(rater, credentialKind),
        rater,
        kind: credentialKind,
        verified: true,
        revoked: false,
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
        nullifierHash,
        scope,
        verifiedAt,
        expiresAt,
        evidenceHash,
        updatedAt: event.block.timestamp,
      });

    if (credentialKind === WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
      await context.db
        .insert(raterHumanCredential)
        .values({
          rater,
          verified: true,
          revoked: false,
          provider: HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4,
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
          provider: HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4,
          nullifierHash,
          scope,
          verifiedAt,
          expiresAt,
          evidenceHash,
          updatedAt: event.block.timestamp,
        });
    }
  },
);

ponder.on(
  "RaterRegistry:WorldCredentialRevoked" as never,
  async ({ event, context }: any) => {
    const { rater, kind, nullifierHash } =
      event.args as WorldCredentialRevokedArgs;
    const credentialKind = Number(kind);

    await context.db
      .insert(raterWorldCredential)
      .values({
        id: credentialKindId(rater, credentialKind),
        rater,
        kind: credentialKind,
        verified: false,
        revoked: true,
        nullifierHash,
        scope: ZERO_HASH,
        verifiedAt: event.block.timestamp,
        expiresAt: event.block.timestamp,
        evidenceHash: ZERO_HASH,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        verified: false,
        revoked: true,
        nullifierHash,
        updatedAt: event.block.timestamp,
      });

    if (credentialKind === WORLD_CREDENTIAL_PROOF_OF_HUMAN) {
      await context.db
        .insert(raterHumanCredential)
        .values({
          rater,
          verified: false,
          revoked: true,
          provider: HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4,
          nullifierHash,
          scope: ZERO_HASH,
          verifiedAt: event.block.timestamp,
          expiresAt: event.block.timestamp,
          evidenceHash: ZERO_HASH,
          updatedAt: event.block.timestamp,
        })
        .onConflictDoUpdate({
          verified: false,
          revoked: true,
          nullifierHash,
          updatedAt: event.block.timestamp,
        });
    }
  },
);

ponder.on(
  "RaterRegistry:HumanPresenceVerified" as never,
  async ({ event, context }: any) => {
    const {
      rater,
      kind,
      nullifierHash,
      lastRecheckedAt,
      freshUntil,
      evidenceHash,
    } = event.args as HumanPresenceVerifiedArgs;
    const credentialKind = Number(kind);

    await context.db
      .insert(raterHumanPresence)
      .values({
        id: credentialKindId(rater, credentialKind),
        rater,
        kind: credentialKind,
        verified: true,
        nullifierHash,
        lastRecheckedAt,
        freshUntil,
        evidenceHash,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        verified: true,
        nullifierHash,
        lastRecheckedAt,
        freshUntil,
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
