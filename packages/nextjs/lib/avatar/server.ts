import "server-only";
import { isAddress } from "viem";
import type { ReputationAvatarPayload } from "~~/lib/avatar/avatarPayload";
import { getOptionalPonderUrl } from "~~/lib/env/server";
import { readLrepBalances, readProfileRegistryAvatarAccent } from "~~/lib/profileRegistry/server";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { getPonderAvailabilityStatus } from "~~/services/ponder/client";

type ReputationAvatarApiResponse = Omit<ReputationAvatarPayload, "balance" | "avatarAccentHex"> & {
  avatarAccentHex?: string | null;
};

const AVATAR_REVALIDATE_SECONDS = 300;

function createEmptyReputationAvatarPayload(address: string): ReputationAvatarPayload {
  const normalizedAddress = isAddress(address) ? (address.toLowerCase() as `0x${string}`) : address;

  return {
    address: normalizedAddress,
    balance: "0",
    avatarAccentHex: null,
    voterId: null,
    stats: null,
    streak: {
      currentDailyStreak: 0,
      bestDailyStreak: 0,
      totalActiveDays: 0,
      lastActiveDate: null,
      lastMilestoneDay: 0,
    },
    categories90d: [],
  };
}

export async function getReputationAvatarPayload(
  address: string,
  options: { chainId?: number; cacheKey?: string | null } = {},
): Promise<ReputationAvatarPayload> {
  if (!isAddress(address)) {
    return createEmptyReputationAvatarPayload(address);
  }

  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const fallbackPayload = createEmptyReputationAvatarPayload(normalizedAddress);
  const ponderUrl = getOptionalPonderUrl();
  const expectedDeploymentKey =
    typeof options.chainId === "number" ? resolveProtocolDeploymentScope(options.chainId)?.deploymentKey : null;
  const avatarPath = `${ponderUrl?.replace(/\/$/, "") ?? ""}/avatar/${normalizedAddress}`;
  const avatarUrl =
    ponderUrl && options.cacheKey ? `${avatarPath}?v=${encodeURIComponent(options.cacheKey)}` : avatarPath;

  const apiPayloadPromise = (async () => {
    if (!ponderUrl) return null;
    if (typeof options.chainId === "number" && !expectedDeploymentKey) return null;
    if (expectedDeploymentKey) {
      const status = await getPonderAvailabilityStatus(expectedDeploymentKey);
      if (!status.available) return null;
    }

    return fetch(avatarUrl, {
      next: { revalidate: AVATAR_REVALIDATE_SECONDS },
    })
      .then(async response => {
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as ReputationAvatarApiResponse;
      })
      .catch(() => null);
  })();

  const [apiPayload, balances, avatarAccent] = await Promise.all([
    apiPayloadPromise,
    readLrepBalances([normalizedAddress], { chainId: options.chainId }).catch(
      () => ({ [normalizedAddress]: 0n }) as Record<string, bigint>,
    ),
    readProfileRegistryAvatarAccent(normalizedAddress, { chainId: options.chainId }).catch(() => ({
      enabled: false,
      rgb: null,
      hex: null,
    })),
  ]);

  return {
    ...fallbackPayload,
    ...(apiPayload ?? {}),
    address: normalizedAddress,
    balance: (balances[normalizedAddress] ?? 0n).toString(),
    avatarAccentHex: avatarAccent.hex,
    categories90d: apiPayload?.categories90d ?? [],
    stats: apiPayload?.stats ?? null,
    streak: apiPayload?.streak ?? fallbackPayload.streak,
    voterId: apiPayload?.voterId ?? null,
  };
}
