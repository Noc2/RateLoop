import { and, eq, inArray, or, sql } from "ponder";
import { encodeAbiParameters, keccak256, zeroHash } from "viem";
import { raterHumanCredential, raterIdentityBan, voterStats } from "ponder:schema";
import { addressIdentityKey } from "@rateloop/node-utils/identityKeys";

const HUMAN_CREDENTIAL_PROVIDER_NONE = 0;
const HUMAN_CREDENTIAL_PROVIDER_WORLD_ID = 1;
const HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4 = 2;

export type CorrelationBanState = {
  addressIdentityKeys: Set<string>;
  identityKeys: Set<string>;
  launchIdentityKeys: Set<string>;
};

export type CorrelationInputSnapshot = {
  verifiedHuman: boolean;
  historicalVoteCount: number;
  credentialProvider: number | null;
  credentialNullifierHash: `0x${string}` | null;
  credentialVerifiedAt: bigint | null;
  credentialExpiresAt: bigint | null;
  banReasons: string[];
};

function normalizeHex32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return null;
  }
  return value.toLowerCase() as `0x${string}`;
}

function credentialIdentityKey(provider: number, nullifierHash: `0x${string}`) {
  if (provider === HUMAN_CREDENTIAL_PROVIDER_NONE || nullifierHash === zeroHash)
    return zeroHash;
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "bytes32" }],
      ["rateloop.human-identity-v1", provider, nullifierHash],
    ),
  );
}

function launchHumanIdentityKey(
  provider: number,
  nullifierHash: `0x${string}`,
) {
  if (provider === HUMAN_CREDENTIAL_PROVIDER_NONE || nullifierHash === zeroHash)
    return zeroHash;
  if (
    provider === HUMAN_CREDENTIAL_PROVIDER_WORLD_ID ||
    provider === HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4
  ) {
    return keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "bytes32" }],
        ["rateloop.launch-world-id-human-v1", nullifierHash],
      ),
    );
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes32" }],
      [provider, nullifierHash],
    ),
  );
}

export async function loadCorrelationBanStateAt(
  context: any,
  timestamp: bigint,
): Promise<CorrelationBanState> {
  const activeBans = await context.db.sql
    .select({
      provider: raterIdentityBan.provider,
      nullifierHash: raterIdentityBan.nullifierHash,
    })
    .from(raterIdentityBan)
    .where(
      and(
        eq(raterIdentityBan.active, true),
        or(
          eq(raterIdentityBan.permanent, true),
          sql`${raterIdentityBan.expiresAt} > ${timestamp}`,
        ),
      ),
    );

  const identityKeys = new Set<string>();
  const launchIdentityKeys = new Set<string>();
  const sourceKeys = new Set<string>();
  const nullifierHashes: `0x${string}`[] = [];
  const seenNullifierHashes = new Set<string>();
  for (const ban of activeBans) {
    const nullifierHash = normalizeHex32(ban.nullifierHash);
    if (nullifierHash === null) continue;
    const provider = Number(ban.provider);
    const identityKey = credentialIdentityKey(provider, nullifierHash);
    if (identityKey !== zeroHash) identityKeys.add(identityKey.toLowerCase());
    const launchIdentity = launchHumanIdentityKey(provider, nullifierHash);
    if (launchIdentity !== zeroHash)
      launchIdentityKeys.add(launchIdentity.toLowerCase());
    sourceKeys.add(`${provider}:${nullifierHash}`);
    if (!seenNullifierHashes.has(nullifierHash)) {
      seenNullifierHashes.add(nullifierHash);
      nullifierHashes.push(nullifierHash);
    }
  }

  const addressIdentityKeys = new Set<string>();
  if (nullifierHashes.length > 0) {
    const credentialRows = await context.db.sql
      .select({
        rater: raterHumanCredential.rater,
        provider: raterHumanCredential.provider,
        nullifierHash: raterHumanCredential.nullifierHash,
      })
      .from(raterHumanCredential)
      .where(inArray(raterHumanCredential.nullifierHash, nullifierHashes));

    for (const credential of credentialRows) {
      const nullifierHash = normalizeHex32(credential.nullifierHash);
      if (nullifierHash === null) continue;
      if (!sourceKeys.has(`${Number(credential.provider)}:${nullifierHash}`))
        continue;
      addressIdentityKeys.add(
        addressIdentityKey(credential.rater).toLowerCase(),
      );
    }
  }

  return { addressIdentityKeys, identityKeys, launchIdentityKeys };
}

function activeCredentialAt(
  credential:
    | {
        verified: boolean | null;
        revoked: boolean | null;
        expiresAt: bigint | null;
      }
    | null
    | undefined,
  timestamp: bigint,
) {
  return (
    credential?.verified === true &&
    credential.revoked !== true &&
    credential.expiresAt !== null &&
    (credential.expiresAt === 0n || credential.expiresAt > timestamp)
  );
}

function storedBanReasons(args: {
  account: `0x${string}`;
  banState: CorrelationBanState;
  identityKey: `0x${string}` | null | undefined;
  includeLaunchIdentityBan?: boolean;
  credentialProvider: number | null;
  credentialNullifierHash: `0x${string}` | null;
  voter: `0x${string}`;
}) {
  const reasons: string[] = [];
  const identityKey = normalizeHex32(args.identityKey);
  if (identityKey && args.banState.identityKeys.has(identityKey.toLowerCase())) {
    reasons.push("identity_banned");
  }
  if (
    args.banState.addressIdentityKeys.has(
      addressIdentityKey(args.voter).toLowerCase(),
    )
  ) {
    reasons.push("voter_address_banned");
  }
  if (
    args.account.toLowerCase() !== args.voter.toLowerCase() &&
    args.banState.addressIdentityKeys.has(
      addressIdentityKey(args.account).toLowerCase(),
    )
  ) {
    reasons.push("holder_address_banned");
  }
  if (
    args.includeLaunchIdentityBan === true &&
    args.credentialProvider !== null &&
    args.credentialNullifierHash !== null
  ) {
    const launchIdentity = launchHumanIdentityKey(
      args.credentialProvider,
      args.credentialNullifierHash,
    );
    if (
      launchIdentity !== zeroHash &&
      args.banState.launchIdentityKeys.has(launchIdentity.toLowerCase())
    ) {
      reasons.push("launch_identity_banned");
    }
  }
  return reasons.sort();
}

export async function snapshotCorrelationInputForAccount(args: {
  account: `0x${string}`;
  banState: CorrelationBanState;
  context: any;
  historicalVotes?: number | null;
  identityKey?: `0x${string}` | null;
  includeLaunchIdentityBan?: boolean;
  timestamp: bigint;
  voter?: `0x${string}` | null;
}): Promise<CorrelationInputSnapshot> {
  const account = args.account;
  const voter = args.voter ?? account;
  const [stats, credential] = await Promise.all([
    args.historicalVotes === undefined
      ? contextFindVoterStats(args.context, account)
      : Promise.resolve(null),
    args.context.db.find(raterHumanCredential, { rater: account }),
  ]);
  const historicalVoteCount =
    args.historicalVotes ??
    (stats?.totalSettledVotes !== undefined ? Number(stats.totalSettledVotes) : 0);
  const nullifierHash = normalizeHex32(credential?.nullifierHash);
  const provider =
    credential?.provider !== undefined && credential?.provider !== null
      ? Number(credential.provider)
      : null;
  const verifiedHuman = activeCredentialAt(credential, args.timestamp);
  const credentialProvider =
    verifiedHuman && provider !== null ? provider : null;
  const credentialNullifierHash =
    verifiedHuman && nullifierHash !== null ? nullifierHash : null;

  return {
    verifiedHuman,
    historicalVoteCount,
    credentialProvider,
    credentialNullifierHash,
    credentialVerifiedAt: verifiedHuman ? (credential?.verifiedAt ?? null) : null,
    credentialExpiresAt: verifiedHuman ? (credential?.expiresAt ?? null) : null,
    banReasons: storedBanReasons({
      account,
      banState: args.banState,
      credentialProvider,
      credentialNullifierHash,
      identityKey: args.identityKey,
      includeLaunchIdentityBan: args.includeLaunchIdentityBan,
      voter,
    }),
  };
}

async function contextFindVoterStats(context: any, account: `0x${string}`) {
  return context.db.find(voterStats, { voter: account });
}
