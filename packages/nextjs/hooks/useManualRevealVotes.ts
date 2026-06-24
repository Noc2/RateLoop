"use client";

import { useCallback, useMemo, useState } from "react";
import { ProtocolConfigAbi, RaterRegistryAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import {
  buildCommitKey,
  decryptTlockVoteCiphertext,
  deriveVoteTlockRevealAvailableAtSeconds,
  getVoteTlockChainInfo,
  parseTlockCiphertextMetadata,
} from "@rateloop/contracts/voting";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Address, isAddress, keccak256, zeroAddress, zeroHash } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { invalidateRecentUserVotes, useRecentUserVotes } from "~~/hooks/useRecentUserVotes";
import { useUnixTime } from "~~/hooks/useUnixTime";
import { getVoteHistoryQueryKey } from "~~/hooks/useVoteHistoryQuery";
import { getVotingStakesQueryKey } from "~~/hooks/useVotingStakes";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { waitForPublicClientTransactionReceiptWithRetry } from "~~/lib/transactions/receiptWait";
import { getSubmittingTransactionMessage } from "~~/lib/ui/transactionStatusCopy";
import scaffoldConfig from "~~/scaffold.config";
import type { PonderVoteItem } from "~~/services/ponder/client";
import { CommitData } from "~~/types/votingTypes";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";
import { notification } from "~~/utils/scaffold-eth/notification";

export interface ManualRevealVote {
  contentId: bigint;
  roundId: bigint;
  voter: Address;
  stake: bigint;
  epochIndex: number;
  committedAt: string;
  revealableAfter: bigint;
  revealAvailableAt: bigint;
  commitHash: `0x${string}`;
  commitKey: `0x${string}`;
  ciphertextHash: `0x${string}`;
  ciphertext: `0x${string}`;
  targetRound: bigint;
  drandChainHash: `0x${string}`;
  secondsUntilReveal: number;
  isReady: boolean;
}

const BENIGN_REVEAL_ERRORS = ["AlreadyRevealed", "RoundNotOpen", "EpochNotEnded"];

export function isBenignRevealError(message: string): boolean {
  const lower = message.toLowerCase();
  return BENIGN_REVEAL_ERRORS.some(error => lower.includes(error.toLowerCase()));
}

type LiveDrandConfig = {
  drandGenesisTime: bigint;
  drandPeriod: bigint;
};

type PublicClient = NonNullable<ReturnType<typeof usePublicClient>>;

type CommitReference = {
  commitHash: `0x${string}`;
  commitKey: `0x${string}`;
};

function isNonZeroAddress(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value) && value.toLowerCase() !== zeroAddress;
}

function isNonZeroBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value) && value.toLowerCase() !== zeroHash;
}

function indexedCommitHash(vote: PonderVoteItem): `0x${string}` {
  return isNonZeroBytes32(vote.commitHash) ? vote.commitHash : zeroHash;
}

function normalizeCommitData(rawCommit: unknown): CommitData {
  const commit = rawCommit as Record<string, unknown> & readonly unknown[];
  if (commit?.ciphertextHash != null) {
    return {
      ciphertextHash: commit.ciphertextHash as `0x${string}`,
      targetRound: commit.targetRound as bigint | undefined,
      drandChainHash: commit.drandChainHash as `0x${string}` | undefined,
      revealableAfter: (commit.revealableAfter as bigint | undefined) ?? 0n,
      revealed: Boolean(commit.revealed),
      stakeAmount: (commit.stakeAmount as bigint | undefined) ?? 0n,
    };
  }

  if (Array.isArray(commit) && commit.length >= 6) {
    return {
      ciphertextHash: commit[0] as `0x${string}`,
      targetRound: commit[1] as bigint,
      drandChainHash: commit[2] as `0x${string}`,
      revealableAfter: commit[3] as bigint,
      revealed: Boolean(commit[4]),
      stakeAmount: commit[5] as bigint,
    };
  }

  return {
    ciphertextHash: zeroHash,
    targetRound: 0n,
    drandChainHash: zeroHash,
    revealableAfter: 0n,
    revealed: true,
    stakeAmount: 0n,
  };
}

type RevealReceiptRevertResolution = "already-revealed" | "round-closed" | "reverted";

/**
 * A receipt-level revert carries no revert reason, so it must not be assumed benign.
 * Re-check on-chain state: only report the friendly "already revealed / round closed"
 * outcome when it is actually verified; otherwise surface an honest failure.
 */
export async function resolveRevealReceiptRevert(params: {
  publicClient: Pick<PublicClient, "readContract">;
  engineAddress: Address;
  contentId: bigint;
  roundId: bigint;
  commitKey: `0x${string}`;
}): Promise<RevealReceiptRevertResolution> {
  try {
    const rawCommit = await params.publicClient.readContract({
      address: params.engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "commitRevealData",
      args: [params.contentId, params.roundId, params.commitKey],
    });
    if (normalizeCommitData(rawCommit).revealed) return "already-revealed";
  } catch {
    // Fall through to the round-state check.
  }

  try {
    const rawRoundCore = (await params.publicClient.readContract({
      address: params.engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "roundCore",
      args: [params.contentId, params.roundId],
    })) as unknown;
    const state = Array.isArray(rawRoundCore)
      ? (rawRoundCore[1] as number | bigint | undefined)
      : (rawRoundCore as { state?: number | bigint } | null)?.state;
    if (state != null && Number(state) !== ROUND_STATE.Open) return "round-closed";
  } catch {
    // Could not verify a benign cause; report the revert honestly.
  }

  return "reverted";
}

async function readLiveDrandConfig(publicClient: PublicClient, engineAddress: Address): Promise<LiveDrandConfig> {
  const protocolConfigAddress = (await publicClient.readContract({
    address: engineAddress,
    abi: RoundVotingEngineAbi,
    functionName: "protocolConfig",
  })) as Address;

  const [drandGenesisTime, drandPeriod] = await Promise.all([
    publicClient.readContract({
      address: protocolConfigAddress,
      abi: [
        {
          type: "function",
          name: "drandGenesisTime",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint64" }],
        },
      ],
      functionName: "drandGenesisTime",
    }),
    publicClient.readContract({
      address: protocolConfigAddress,
      abi: [
        {
          type: "function",
          name: "drandPeriod",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint64" }],
        },
      ],
      functionName: "drandPeriod",
    }),
  ]);

  return {
    drandGenesisTime: drandGenesisTime as bigint,
    drandPeriod: drandPeriod as bigint,
  };
}

async function readProtocolRaterRegistry(publicClient: PublicClient, engineAddress: Address): Promise<Address | null> {
  try {
    const protocolConfigAddress = (await publicClient.readContract({
      address: engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "protocolConfig",
    })) as Address;
    if (!isNonZeroAddress(protocolConfigAddress)) return null;

    const raterRegistry = (await publicClient.readContract({
      address: protocolConfigAddress,
      abi: ProtocolConfigAbi,
      functionName: "raterRegistry",
    })) as Address;
    return isNonZeroAddress(raterRegistry) ? raterRegistry : null;
  } catch {
    return null;
  }
}

async function readRoundRaterRegistry(
  publicClient: PublicClient,
  engineAddress: Address,
  contentId: bigint,
  roundId: bigint,
): Promise<Address | null> {
  try {
    const snapshot = (await publicClient.readContract({
      address: engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "roundRaterRegistrySnapshot",
      args: [contentId, roundId],
    })) as Address;
    if (isNonZeroAddress(snapshot)) return snapshot;
  } catch {
    return null;
  }

  return readProtocolRaterRegistry(publicClient, engineAddress);
}

async function readDirectCommitReference(params: {
  publicClient: PublicClient;
  engineAddress: Address;
  contentId: bigint;
  roundId: bigint;
  voter: Address;
}): Promise<CommitReference | null> {
  try {
    const commitState = (await params.publicClient.readContract({
      address: params.engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "voterCommitKey",
      args: [params.contentId, params.roundId, params.voter],
    })) as readonly [`0x${string}`, `0x${string}`];
    const [commitHash, commitKey] = commitState;
    if (!isNonZeroBytes32(commitHash)) return null;
    return {
      commitHash,
      commitKey: isNonZeroBytes32(commitKey) ? commitKey : buildCommitKey(params.voter, commitHash),
    };
  } catch {
    return null;
  }
}

async function readIdentityCommitReference(params: {
  publicClient: PublicClient;
  engineAddress: Address;
  contentId: bigint;
  roundId: bigint;
  voter: Address;
  indexedCommitHash: `0x${string}`;
}): Promise<CommitReference | null> {
  const raterRegistry = await readRoundRaterRegistry(
    params.publicClient,
    params.engineAddress,
    params.contentId,
    params.roundId,
  );
  if (!raterRegistry) return null;

  let identityKey: `0x${string}` = zeroHash;
  try {
    const resolved = (await params.publicClient.readContract({
      address: raterRegistry,
      abi: RaterRegistryAbi,
      functionName: "resolveRater",
      args: [params.voter],
    })) as { identityKey?: `0x${string}` } | readonly [Address, `0x${string}`, `0x${string}`, boolean, boolean];
    identityKey = Array.isArray(resolved)
      ? (resolved as readonly [Address, `0x${string}`, `0x${string}`, boolean, boolean])[1]
      : ((resolved as { identityKey?: `0x${string}` }).identityKey ?? zeroHash);
  } catch {
    return null;
  }
  if (!isNonZeroBytes32(identityKey)) return null;

  try {
    const identityCommitState = (await params.publicClient.readContract({
      address: params.engineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "identityCommitState",
      args: [params.contentId, params.roundId, identityKey, params.voter],
    })) as readonly [`0x${string}`, `0x${string}`, bigint];
    const commitKey = identityCommitState[0];
    if (isNonZeroBytes32(commitKey)) {
      return { commitHash: params.indexedCommitHash, commitKey };
    }
  } catch {
    return null;
  }
  return null;
}

function readIndexedCommitReference(vote: PonderVoteItem): CommitReference | null {
  if (!isAddress(vote.voter) || !isNonZeroBytes32(vote.commitHash)) return null;
  const voter = vote.voter as Address;
  return {
    commitHash: vote.commitHash,
    commitKey: buildCommitKey(voter, vote.commitHash),
  };
}

async function resolveManualRevealCommitReference(params: {
  publicClient: PublicClient;
  engineAddress: Address;
  voter: Address;
  vote: PonderVoteItem;
}): Promise<CommitReference | null> {
  const contentId = BigInt(params.vote.contentId);
  const roundId = BigInt(params.vote.roundId);
  return (
    (await readDirectCommitReference({
      publicClient: params.publicClient,
      engineAddress: params.engineAddress,
      contentId,
      roundId,
      voter: params.voter,
    })) ??
    (await readIdentityCommitReference({
      publicClient: params.publicClient,
      engineAddress: params.engineAddress,
      contentId,
      roundId,
      voter: params.voter,
      indexedCommitHash: indexedCommitHash(params.vote),
    })) ??
    readIndexedCommitReference(params.vote)
  );
}

function deriveRevealAvailableAtFromLiveConfig(
  revealableAfterSeconds: bigint,
  targetRound: bigint,
  liveDrandConfig: LiveDrandConfig,
) {
  if (targetRound <= 0n || liveDrandConfig.drandPeriod <= 0n) {
    return revealableAfterSeconds;
  }

  const drandRoundRevealableAt = liveDrandConfig.drandGenesisTime + (targetRound - 1n) * liveDrandConfig.drandPeriod;
  return revealableAfterSeconds > drandRoundRevealableAt ? revealableAfterSeconds : drandRoundRevealableAt;
}

async function deriveRevealAvailableAtSeconds(params: {
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  engineAddress: Address;
  revealableAfter: bigint;
  targetRound: bigint;
  drandChainHash: `0x${string}`;
  tlockChainInfo?: Awaited<ReturnType<typeof getVoteTlockChainInfo>> | null;
  liveDrandConfig?: LiveDrandConfig | null;
}) {
  const { publicClient, engineAddress, revealableAfter, targetRound, drandChainHash } = params;

  if (targetRound <= 0n) {
    return {
      revealAvailableAt: revealableAfter,
      tlockChainInfo: params.tlockChainInfo ?? null,
      liveDrandConfig: params.liveDrandConfig ?? null,
    };
  }

  let tlockChainInfo = params.tlockChainInfo;
  if (tlockChainInfo === undefined || tlockChainInfo?.drandChainHash.toLowerCase() !== drandChainHash.toLowerCase()) {
    try {
      tlockChainInfo = await getVoteTlockChainInfo({ drandChainHash });
    } catch {
      tlockChainInfo = null;
    }
  }

  if (tlockChainInfo && tlockChainInfo.drandChainHash.toLowerCase() === drandChainHash.toLowerCase()) {
    const tlockRevealAvailableAt = deriveVoteTlockRevealAvailableAtSeconds(targetRound, tlockChainInfo);
    return {
      revealAvailableAt: revealableAfter > tlockRevealAvailableAt ? revealableAfter : tlockRevealAvailableAt,
      tlockChainInfo,
      liveDrandConfig: params.liveDrandConfig ?? null,
    };
  }

  let liveDrandConfig = params.liveDrandConfig;
  if (liveDrandConfig === undefined) {
    liveDrandConfig = await readLiveDrandConfig(publicClient, engineAddress);
  }

  return {
    revealAvailableAt: liveDrandConfig
      ? deriveRevealAvailableAtFromLiveConfig(revealableAfter, targetRound, liveDrandConfig)
      : revealableAfter,
    tlockChainInfo,
    liveDrandConfig,
  };
}

export function useManualRevealVotes(voter?: Address) {
  const { address, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const queryClient = useQueryClient();
  const now = useUnixTime();
  const isPageVisible = usePageVisibility();
  const [pendingCommitKey, setPendingCommitKey] = useState<`0x${string}` | null>(null);

  const { data: engineInfo } = useDeployedContractInfo({ contractName: "RoundVotingEngine" as any });
  const { openVotes, isLoading: isLoadingVotes } = useRecentUserVotes(voter);

  const pendingVotes = useMemo(() => {
    return openVotes.filter(vote => !vote.revealed);
  }, [openVotes]);
  const normalizedVoter = voter?.toLowerCase();

  const pendingVoteKey = useMemo(() => {
    return pendingVotes.map(vote => `${vote.contentId}-${vote.roundId}-${vote.committedAt}`).join("|");
  }, [pendingVotes]);

  const { data: rawVotes, isLoading: isLoadingCommits } = useQuery({
    queryKey: ["manualRevealVotesOnchain", targetNetwork.id, normalizedVoter, pendingVoteKey],
    enabled: Boolean(voter && publicClient && engineInfo?.address && pendingVotes.length > 0),
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
    queryFn: async (): Promise<ManualRevealVote[]> => {
      if (!voter || !publicClient || !engineInfo?.address || pendingVotes.length === 0) return [];

      const withCommitHashes = (
        await Promise.all(
          pendingVotes.map(async vote => {
            const commitReference = await resolveManualRevealCommitReference({
              publicClient,
              engineAddress: engineInfo.address,
              voter,
              vote,
            });
            return commitReference ? { vote, ...commitReference } : null;
          }),
        )
      ).flatMap(reference => (reference ? [reference] : []));

      if (withCommitHashes.length === 0) return [];

      const commitResults = await publicClient.multicall({
        allowFailure: true,
        contracts: withCommitHashes.map(({ vote, commitKey }) => ({
          address: engineInfo.address,
          abi: RoundVotingEngineAbi,
          functionName: "commitRevealData",
          args: [BigInt(vote.contentId), BigInt(vote.roundId), commitKey],
        })) as any,
      });

      let tlockChainInfo: Awaited<ReturnType<typeof getVoteTlockChainInfo>> | null | undefined;
      let liveDrandConfig: LiveDrandConfig | null | undefined;
      const votesWithRevealTimes = await Promise.all(
        withCommitHashes.map(async ({ vote, commitHash, commitKey }, index) => {
          const commitResult = commitResults[index];
          if (commitResult?.status !== "success") return null;

          const commit = normalizeCommitData(commitResult.result);
          if (commit.revealed) {
            return null;
          }
          const ciphertext = vote.ciphertext as `0x${string}` | undefined;
          const indexedCiphertextHash = vote.ciphertextHash as `0x${string}` | undefined;
          if (!ciphertext || !indexedCiphertextHash) return null;
          if (indexedCiphertextHash.toLowerCase() !== commit.ciphertextHash.toLowerCase()) return null;
          if (keccak256(ciphertext) !== commit.ciphertextHash) return null;

          const timing = await deriveRevealAvailableAtSeconds({
            publicClient,
            engineAddress: engineInfo.address,
            revealableAfter: commit.revealableAfter,
            targetRound: commit.targetRound ?? 0n,
            drandChainHash: (commit.drandChainHash ?? zeroHash) as `0x${string}`,
            tlockChainInfo,
            liveDrandConfig,
          });
          tlockChainInfo = timing.tlockChainInfo;
          liveDrandConfig = timing.liveDrandConfig;

          return {
            contentId: BigInt(vote.contentId),
            roundId: BigInt(vote.roundId),
            voter: vote.voter as Address,
            stake: BigInt(vote.stake),
            epochIndex: vote.epochIndex,
            committedAt: vote.committedAt,
            revealableAfter: commit.revealableAfter,
            revealAvailableAt: timing.revealAvailableAt,
            commitHash,
            commitKey,
            ciphertextHash: commit.ciphertextHash,
            ciphertext,
            targetRound: commit.targetRound ?? 0n,
            drandChainHash: commit.drandChainHash ?? zeroHash,
            secondsUntilReveal: 0,
            isReady: false,
          } satisfies ManualRevealVote;
        }),
      );

      return votesWithRevealTimes.flatMap(vote => (vote ? [vote] : []));
    },
  });

  const votes = useMemo(() => {
    return (rawVotes ?? [])
      .map(vote => {
        const secondsUntilReveal = Math.max(0, Number(vote.revealAvailableAt) - now);
        return {
          ...vote,
          secondsUntilReveal,
          isReady: secondsUntilReveal === 0,
        };
      })
      .sort((a, b) => {
        if (a.isReady !== b.isReady) return a.isReady ? -1 : 1;
        return Number(a.revealAvailableAt - b.revealAvailableAt);
      });
  }, [now, rawVotes]);

  const readyVotes = useMemo(() => votes.filter(vote => vote.isReady), [votes]);
  const waitingVotes = useMemo(() => votes.filter(vote => !vote.isReady), [votes]);

  const refresh = useCallback(async () => {
    const deployment = resolveProtocolDeploymentScope(targetNetwork.id);
    const deploymentKey = deployment?.deploymentKey ?? null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["manualRevealVotesOnchain", targetNetwork.id, normalizedVoter] }),
      invalidateRecentUserVotes(queryClient, voter, targetNetwork.id, deploymentKey),
      queryClient.invalidateQueries({ queryKey: getVotingStakesQueryKey(voter, targetNetwork.id, deploymentKey) }),
      queryClient.invalidateQueries({ queryKey: getVoteHistoryQueryKey(voter, targetNetwork.id, deploymentKey) }),
    ]);
  }, [normalizedVoter, queryClient, targetNetwork.id, voter]);

  const revealVote = useCallback(
    async (vote: ManualRevealVote) => {
      if (!walletClient || !publicClient || !engineInfo?.address || !address) {
        notification.error("Connect your wallet to reveal a vote.");
        return false;
      }
      if (chain?.id !== targetNetwork.id) {
        notification.error(`Switch to ${targetNetwork.name} to reveal votes.`);
        return false;
      }

      setPendingCommitKey(vote.commitKey);
      let toastId: string | undefined;

      try {
        const rawLatestCommit = await publicClient.readContract({
          address: engineInfo.address,
          abi: RoundVotingEngineAbi,
          functionName: "commitRevealData",
          args: [vote.contentId, vote.roundId, vote.commitKey],
        });
        const latestCommit = normalizeCommitData(rawLatestCommit);

        if (latestCommit.revealed) {
          notification.info("That vote has already been revealed.");
          await refresh();
          return true;
        }

        const timing = await deriveRevealAvailableAtSeconds({
          publicClient,
          engineAddress: engineInfo.address,
          revealableAfter: latestCommit.revealableAfter,
          targetRound: latestCommit.targetRound ?? 0n,
          drandChainHash: (latestCommit.drandChainHash ?? zeroHash) as `0x${string}`,
        });
        const revealAvailableAt = timing.revealAvailableAt;
        if (BigInt(now) < revealAvailableAt) {
          notification.info("That vote is not revealable yet.");
          await refresh();
          return false;
        }

        if (latestCommit.targetRound == null || latestCommit.drandChainHash == null) {
          notification.error("The stored vote is missing tlock metadata and cannot be manually revealed.");
          return false;
        }

        if (keccak256(vote.ciphertext) !== latestCommit.ciphertextHash) {
          notification.error("The indexed vote ciphertext does not match the on-chain commitment.");
          return false;
        }

        const parsedMetadata = parseTlockCiphertextMetadata(vote.ciphertext);
        if (!parsedMetadata) {
          notification.error("The stored vote ciphertext is malformed and cannot be manually revealed.");
          return false;
        }

        if (
          parsedMetadata.targetRound !== latestCommit.targetRound ||
          parsedMetadata.drandChainHash !== latestCommit.drandChainHash
        ) {
          notification.error("The stored vote ciphertext does not match the committed drand metadata.");
          return false;
        }

        const decrypted = await decryptTlockVoteCiphertext(vote.ciphertext, {
          drandChainHash: latestCommit.drandChainHash,
        });
        if (!decrypted) {
          notification.error("The stored ciphertext could not be decoded.");
          return false;
        }

        toastId = notification.loading(getSubmittingTransactionMessage("reveal"));

        const hash = await walletClient.writeContract({
          address: engineInfo.address,
          abi: RoundVotingEngineAbi,
          functionName: "revealVoteByCommitKey",
          args: [
            vote.contentId,
            vote.roundId,
            vote.commitKey,
            decrypted.isUp,
            decrypted.predictedUpBps,
            decrypted.salt,
          ],
          account: address,
          chain: targetNetwork,
        } as any);

        const receipt = await waitForPublicClientTransactionReceiptWithRetry(publicClient, {
          hash,
          pollingInterval: getTransactionReceiptPollingInterval(targetNetwork.id, {
            preconfirmation: scaffoldConfig.useBasePreconfRpc,
          }),
        });
        notification.remove(toastId);
        toastId = undefined;
        if (receipt.status === "reverted") {
          const resolution = await resolveRevealReceiptRevert({
            publicClient,
            engineAddress: engineInfo.address,
            contentId: vote.contentId,
            roundId: vote.roundId,
            commitKey: vote.commitKey,
          });
          if (resolution !== "reverted") {
            notification.info("That vote was already revealed or the round already closed.");
            await refresh();
            return true;
          }
          notification.error("The reveal transaction reverted on-chain and the vote was not revealed. Try again.");
          await refresh();
          return false;
        }
        notification.success("Vote revealed.");
        await refresh();
        return true;
      } catch (error) {
        if (toastId) notification.remove(toastId);
        const message = getParsedErrorWithAllAbis(error, targetNetwork.id as any);
        if (isBenignRevealError(message)) {
          notification.info("That vote was already revealed or the round already closed.");
          await refresh();
          return true;
        }
        notification.error(message);
        return false;
      } finally {
        setPendingCommitKey(null);
      }
    },
    [address, chain?.id, engineInfo?.address, now, publicClient, refresh, targetNetwork, walletClient],
  );

  return {
    votes,
    readyVotes,
    waitingVotes,
    readyCount: readyVotes.length,
    isLoading: isLoadingVotes || isLoadingCommits,
    revealingCommitKey: pendingCommitKey,
    revealVote,
    refresh,
  };
}
