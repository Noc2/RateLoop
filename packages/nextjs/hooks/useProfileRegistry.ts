"use client";

import { useCallback, useState } from "react";
import type { Abi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { avatarAccentRgbToHex } from "~~/lib/avatar/avatarAccent";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import scaffoldConfig from "~~/scaffold.config";

interface Profile {
  name: string;
  selfReport: string;
  createdAt: bigint;
  updatedAt: bigint;
}

interface AvatarAccent {
  enabled: boolean;
  rgb: bigint | null;
  hex: string | null;
}

function getProfileRegistryPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

function readProfileTuple(profileData: unknown): Pick<Profile, "name" | "selfReport"> {
  const tuple = Array.isArray(profileData) ? (profileData as unknown[]) : [];
  const record =
    !Array.isArray(profileData) && profileData && typeof profileData === "object"
      ? (profileData as Record<string, unknown>)
      : {};
  return {
    name: typeof record.name === "string" ? record.name : typeof tuple[0] === "string" ? tuple[0] : "",
    selfReport:
      typeof record.selfReport === "string" ? record.selfReport : typeof tuple[1] === "string" ? tuple[1] : "",
  };
}

function readAvatarAccentTuple(avatarAccentData: unknown): Pick<AvatarAccent, "enabled" | "rgb"> {
  const tuple = Array.isArray(avatarAccentData) ? (avatarAccentData as unknown[]) : [];
  const record =
    !Array.isArray(avatarAccentData) && avatarAccentData && typeof avatarAccentData === "object"
      ? (avatarAccentData as Record<string, unknown>)
      : {};
  const enabled = record.enabled === true || tuple[0] === true;
  const rgb = typeof record.rgb === "bigint" ? record.rgb : typeof tuple[1] === "bigint" ? tuple[1] : null;
  return { enabled, rgb };
}

function useProfileRegistryWrite() {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: profileRegistryContract } = useDeployedContractInfo({
    contractName: "ProfileRegistry" as any,
  });
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "ProfileRegistry" as any,
  });
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls, isAwaitingSponsoredSubmitCalls } =
    useThirdwebSponsoredSubmitCalls();
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });
  const [isSponsoredWritePending, setIsSponsoredWritePending] = useState(false);

  const writeProfileRegistry = useCallback(
    async (functionName: string, args: readonly unknown[], action: string) => {
      if (walletTransactionReadiness.isBlocked) {
        throw new Error(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      }

      if (canUseSponsoredSubmitCalls && profileRegistryContract) {
        setIsSponsoredWritePending(true);
        try {
          const contractAddress = profileRegistryContract.address as `0x${string}`;
          const contractAbi = profileRegistryContract.abi as Abi;
          const canWaitForPostcondition = Boolean(address && publicClient);
          if (canWaitForPostcondition) {
            await raceTransactionWithPostcondition({
              onPostconditionSuccessThenTransactionError: error => {
                console.warn("[profile-registry] postcondition succeeded before thirdweb status settled.", {
                  error,
                  functionName,
                });
              },
              transaction: () =>
                executeSponsoredCalls(
                  [
                    {
                      abi: contractAbi,
                      address: contractAddress,
                      args,
                      functionName,
                    },
                  ],
                  { action, suppressStatusToast: true },
                ),
              waitForPostcondition: shouldStop =>
                waitForTransactionPostcondition(
                  async () => {
                    if (!address || !publicClient) return false;
                    if (functionName === "setProfile") {
                      const [expectedName, expectedSelfReport] = args as readonly [string, string];
                      const profile = readProfileTuple(
                        await publicClient.readContract({
                          address: contractAddress,
                          abi: contractAbi,
                          functionName: "getProfile",
                          args: [address],
                        } as never),
                      );
                      return profile.name === expectedName && profile.selfReport === expectedSelfReport;
                    }
                    if (functionName === "setAvatarAccent") {
                      const [expectedRgb] = args as readonly [bigint];
                      const avatarAccent = readAvatarAccentTuple(
                        await publicClient.readContract({
                          address: contractAddress,
                          abi: contractAbi,
                          functionName: "getAvatarAccent",
                          args: [address],
                        } as never),
                      );
                      return avatarAccent.enabled && avatarAccent.rgb === expectedRgb;
                    }
                    if (functionName === "clearAvatarAccent") {
                      const avatarAccent = readAvatarAccentTuple(
                        await publicClient.readContract({
                          address: contractAddress,
                          abi: contractAbi,
                          functionName: "getAvatarAccent",
                          args: [address],
                        } as never),
                      );
                      return !avatarAccent.enabled;
                    }
                    return false;
                  },
                  "profile-registry-postcondition",
                  {
                    pollingIntervalMs: getProfileRegistryPostconditionPollingInterval(targetNetwork.id),
                    shouldStop,
                  },
                ),
            });
          } else {
            await executeSponsoredCalls(
              [
                {
                  abi: contractAbi,
                  address: contractAddress,
                  args,
                  functionName,
                },
              ],
              { action },
            );
          }
          return;
        } finally {
          setIsSponsoredWritePending(false);
        }
      }

      await (writeContractAsync as any)(
        {
          args,
          functionName,
        },
        { action },
      );
    },
    [
      address,
      canUseSponsoredSubmitCalls,
      executeSponsoredCalls,
      profileRegistryContract,
      publicClient,
      targetNetwork.id,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
      writeContractAsync,
    ],
  );

  return {
    isPending: isPending || isSponsoredWritePending,
    writeProfileRegistry,
  };
}

/**
 * Hook to fetch a user's profile from the ProfileRegistry contract.
 */
export function useProfileRegistry(address?: string) {
  const {
    data: profileData,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "ProfileRegistry" as any,
    functionName: "getProfile",
    args: [address],
    query: {
      enabled: !!address,
    },
  } as any);

  const profile: Profile | null = profileData
    ? (() => {
        const d = profileData as unknown as Record<string, unknown>;
        const tuple = Array.isArray(profileData) ? (profileData as unknown[]) : [];
        return {
          name: typeof d.name === "string" ? d.name : typeof tuple[0] === "string" ? tuple[0] : "",
          selfReport: typeof d.selfReport === "string" ? d.selfReport : typeof tuple[1] === "string" ? tuple[1] : "",
          createdAt: typeof d.createdAt === "bigint" ? d.createdAt : typeof tuple[2] === "bigint" ? tuple[2] : 0n,
          updatedAt: typeof d.updatedAt === "bigint" ? d.updatedAt : typeof tuple[3] === "bigint" ? tuple[3] : 0n,
        };
      })()
    : null;

  const hasProfile = profile && profile.createdAt > 0n;

  return {
    profile,
    hasProfile,
    isLoading,
    refetch,
  };
}

/**
 * Hook to check if a profile name is taken.
 */
export function useIsNameTaken(name: string) {
  const { data: isTaken, isLoading } = useScaffoldReadContract({
    contractName: "ProfileRegistry" as any,
    functionName: "isNameTaken",
    args: [name],
    query: {
      enabled: name.length >= 3,
    },
  } as any);

  return {
    isTaken: isTaken ?? false,
    isLoading,
  };
}

/**
 * Hook to set or update a profile.
 */
export function useSetProfile() {
  const { isPending, writeProfileRegistry } = useProfileRegistryWrite();

  const setProfile = async (name: string, selfReport: string) => {
    await writeProfileRegistry("setProfile", [name, selfReport], "profile update");
  };

  return {
    setProfile,
    isPending,
  };
}

/**
 * Hook to fetch a user's avatar gradient seed override from the ProfileRegistry contract.
 */
export function useAvatarAccent(address?: string) {
  const {
    data: avatarAccentData,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "ProfileRegistry" as any,
    functionName: "getAvatarAccent",
    args: [address],
    query: {
      enabled: !!address,
    },
  } as any);

  const avatarAccent: AvatarAccent | null = avatarAccentData
    ? (() => {
        const tuple = avatarAccentData as unknown as Record<string, unknown> & unknown[];
        const enabled = tuple.enabled === true || tuple[0] === true;
        const rgb = typeof tuple.rgb === "bigint" ? tuple.rgb : typeof tuple[1] === "bigint" ? tuple[1] : null;
        return {
          enabled,
          rgb: enabled ? rgb : null,
          hex: enabled && rgb !== null ? avatarAccentRgbToHex(rgb) : null,
        };
      })()
    : null;

  return {
    avatarAccent,
    isLoading,
    refetch,
  };
}

/**
 * Hook to store an avatar gradient seed override.
 */
export function useSetAvatarAccent() {
  const { isPending, writeProfileRegistry } = useProfileRegistryWrite();

  const setAvatarAccent = async (rgb: number) => {
    await writeProfileRegistry("setAvatarAccent", [BigInt(rgb)], "avatar gradient update");
  };

  return {
    setAvatarAccent,
    isPending,
  };
}

/**
 * Hook to clear an avatar gradient seed override.
 */
export function useClearAvatarAccent() {
  const { isPending, writeProfileRegistry } = useProfileRegistryWrite();

  const clearAvatarAccent = async () => {
    await writeProfileRegistry("clearAvatarAccent", [], "avatar gradient reset");
  };

  return {
    clearAvatarAccent,
    isPending,
  };
}
