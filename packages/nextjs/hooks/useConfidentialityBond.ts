"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Abi, Address } from "viem";
import { isAddress, zeroHash } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useTargetNetwork, useTransactor } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { ERC20_APPROVAL_ABI, getDefaultLrepAddress, getDefaultUsdcAddress } from "~~/lib/questionRewardPools";
import { getGasBalanceErrorMessage } from "~~/lib/transactionErrors";
import { createTransactionTimingRun } from "~~/lib/transactions/timing";
import type { ConfidentialityBondRequirement } from "~~/lib/vote/confidentialContext";
import scaffoldConfig from "~~/scaffold.config";
import { contracts } from "~~/utils/scaffold-eth/contract";

export const CONFIDENTIALITY_ESCROW_ABI = [
  {
    type: "function",
    name: "hasActiveBond",
    inputs: [
      { name: "contentId", type: "uint256" },
      { name: "identityKey", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "postBond",
    inputs: [{ name: "contentId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const CONFIDENTIALITY_BOND_POSTED_EVENT = "rateloop:confidentiality-bond-posted";
const LOCAL_DEVELOPMENT_CHAIN_IDS = new Set([31337]);
const CONFIDENTIALITY_BOND_REUSABLE_ALLOWANCE_MULTIPLIER = 10n;
const CONFIDENTIALITY_BOND_POSTCONDITION_TIMEOUT_MS = 20_000;
const CONFIDENTIALITY_BOND_POSTCONDITION_SLOW_MS = 4_000;

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeAddress(value: string | undefined): Address | undefined {
  const trimmed = value?.trim();
  return trimmed && isAddress(trimmed) ? (trimmed as Address) : undefined;
}

function getPublicConfidentialityEscrowAddressOverride(): Address | undefined {
  return normalizeAddress(process.env.NEXT_PUBLIC_CONFIDENTIALITY_ESCROW_ADDRESS);
}

export function getConfiguredConfidentialityEscrowAddress(chainId: number): Address | undefined {
  const override = getPublicConfidentialityEscrowAddressOverride();
  const deploymentAddress = normalizeAddress(
    (contracts?.[chainId]?.ConfidentialityEscrow as { address?: string } | undefined)?.address,
  );
  if (!deploymentAddress) return override;
  if (!override || LOCAL_DEVELOPMENT_CHAIN_IDS.has(chainId)) return override ?? deploymentAddress;
  return deploymentAddress;
}

function dispatchConfidentialityBondPosted(contentId: bigint, identityKey?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONFIDENTIALITY_BOND_POSTED_EVENT, {
      detail: {
        contentId: contentId.toString(),
        identityKey,
      },
    }),
  );
}

function getConfidentialityBondPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

function getReusableBondApprovalAmount(requiredAmount: bigint) {
  return requiredAmount > 0n ? requiredAmount * CONFIDENTIALITY_BOND_REUSABLE_ALLOWANCE_MULTIPLIER : requiredAmount;
}

interface UseConfidentialityBondParams {
  bondRequirement: ConfidentialityBondRequirement;
  contentId: bigint;
  enabled?: boolean;
}

export function useConfidentialityBond({ bondRequirement, contentId, enabled = true }: UseConfidentialityBondParams) {
  const { address } = useAccount();
  const identityReadAddress = enabled ? address : undefined;
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(identityReadAddress, targetNetwork.id);
  const writeTx = useTransactor(localE2ETestWalletClient);
  const contractWrite = useWriteContract();
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const {
    hasActiveHumanCredential,
    identityKey,
    isLoading: isIdentityLoading,
    isResolved: isIdentityResolved,
    refetch: refetchIdentity,
  } = useRaterRegistryIdentity(identityReadAddress);
  const [hasActiveBond, setHasActiveBond] = useState(false);
  const [isCheckingBond, setIsCheckingBond] = useState(false);
  const [isPostingBond, setIsPostingBond] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escrowAddress = useMemo(() => getConfiguredConfidentialityEscrowAddress(targetNetwork.id), [targetNetwork.id]);
  const tokenAddress = useMemo(
    () =>
      bondRequirement.asset === "USDC"
        ? getDefaultUsdcAddress(targetNetwork.id)
        : getDefaultLrepAddress(targetNetwork.id),
    [bondRequirement.asset, targetNetwork.id],
  );
  const shouldCheckBond = Boolean(
    enabled && bondRequirement.isRequired && publicClient && escrowAddress && identityKey && identityKey !== zeroHash,
  );
  const bondCheckKey =
    shouldCheckBond && escrowAddress && identityKey
      ? `${targetNetwork.id}:${contentId.toString()}:${escrowAddress}:${identityKey}:${bondRequirement.asset}:${bondRequirement.amount.toString()}`
      : null;
  const [checkedBondKey, setCheckedBondKey] = useState<string | null>(null);
  const hasCheckedBond = !bondRequirement.isRequired || (bondCheckKey !== null && checkedBondKey === bondCheckKey);

  const refreshBond = useCallback(async () => {
    if (!bondRequirement.isRequired) {
      setHasActiveBond(true);
      setCheckedBondKey(null);
      return true;
    }

    if (!shouldCheckBond || !publicClient || !escrowAddress || !identityKey) {
      setHasActiveBond(false);
      return false;
    }

    setIsCheckingBond(true);
    setError(null);
    try {
      const active = await publicClient.readContract({
        address: escrowAddress,
        abi: CONFIDENTIALITY_ESCROW_ABI,
        functionName: "hasActiveBond",
        args: [contentId, identityKey],
      });
      const normalizedActive = active === true;
      setHasActiveBond(normalizedActive);
      setCheckedBondKey(bondCheckKey);
      return normalizedActive;
    } catch (bondError) {
      console.warn("[confidentiality] failed to check active confidentiality bond.", {
        contentId: contentId.toString(),
        error: bondError,
      });
      setHasActiveBond(false);
      setCheckedBondKey(bondCheckKey);
      setError("Could not check confidentiality bond status.");
      return false;
    } finally {
      setIsCheckingBond(false);
    }
  }, [bondCheckKey, bondRequirement.isRequired, contentId, escrowAddress, identityKey, publicClient, shouldCheckBond]);

  const waitForPostedBondPostcondition = useCallback(async () => {
    if (!publicClient || !escrowAddress || !identityKey) return false;

    const timingLog = createTransactionTimingRun({
      action: "post confidentiality bond",
      callCount: 1,
      callTypes: ["hasActiveBond"],
      chainId: targetNetwork.id,
      metadata: {
        asset: bondRequirement.asset,
        contentId: contentId.toString(),
      },
      route: "postcondition",
      source: "confidentiality-bond",
    });
    const startedAt = Date.now();
    let pollCount = 0;
    let slowLogged = false;
    timingLog.emit("postcondition-wait-start");

    for (;;) {
      pollCount += 1;
      try {
        const active = await publicClient.readContract({
          address: escrowAddress,
          abi: CONFIDENTIALITY_ESCROW_ABI,
          functionName: "hasActiveBond",
          args: [contentId, identityKey],
        });

        if (active === true) {
          timingLog.emit("postcondition-wait-complete", {
            pollCount,
            status: "active",
          });
          return true;
        }
      } catch (postconditionError) {
        timingLog.emit("postcondition-poll-error", {
          message: postconditionError instanceof Error ? postconditionError.message : "Unknown error",
          pollCount,
        });
      }

      const elapsedMs = Date.now() - startedAt;
      if (!slowLogged && elapsedMs >= CONFIDENTIALITY_BOND_POSTCONDITION_SLOW_MS) {
        slowLogged = true;
        timingLog.emit("postcondition-wait-slow", {
          pollCount,
          status: "pending",
        });
      }
      if (elapsedMs >= CONFIDENTIALITY_BOND_POSTCONDITION_TIMEOUT_MS) {
        timingLog.emit("postcondition-wait-timeout", {
          pollCount,
          status: "pending",
        });
        return false;
      }

      await delay(
        Math.max(
          200,
          Math.min(
            getConfidentialityBondPollingInterval(targetNetwork.id),
            CONFIDENTIALITY_BOND_POSTCONDITION_TIMEOUT_MS - elapsedMs,
          ),
        ),
      );
    }
  }, [bondRequirement.asset, contentId, escrowAddress, identityKey, publicClient, targetNetwork.id]);

  useEffect(() => {
    void refreshBond();
  }, [refreshBond]);

  useEffect(() => {
    if (!enabled || !bondRequirement.isRequired || typeof window === "undefined") return;

    const handleBondPosted = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (detail?.contentId === contentId.toString()) {
        void refreshBond();
      }
    };

    window.addEventListener(CONFIDENTIALITY_BOND_POSTED_EVENT, handleBondPosted);
    return () => {
      window.removeEventListener(CONFIDENTIALITY_BOND_POSTED_EVENT, handleBondPosted);
    };
  }, [bondRequirement.isRequired, contentId, enabled, refreshBond]);

  const writeContractCall = useCallback(
    async (
      request: {
        abi: Abi;
        address: Address;
        args: readonly unknown[];
        functionName: string;
      },
      action: string,
    ) => {
      if (!address || !publicClient) {
        throw new Error("Please connect your wallet");
      }

      const estimatedGas = await publicClient.estimateContractGas({
        account: address as Address,
        address: request.address,
        abi: request.abi,
        args: request.args as never,
        functionName: request.functionName as never,
      } as any);
      const requestWithGas = {
        ...request,
        account: address as Address,
        chainId: targetNetwork.id,
        gas: (estimatedGas * 120n) / 100n,
      };

      contractWrite.reset();
      const hash = await writeTx(
        () =>
          localE2ETestWalletClient
            ? localE2ETestWalletClient.writeContract(requestWithGas as any)
            : contractWrite.writeContractAsync(requestWithGas as any),
        { action, suppressSuccessToast: true },
      );
      if (!hash) {
        throw new Error(`${action} transaction was not submitted.`);
      }
      return hash;
    },
    [address, contractWrite, localE2ETestWalletClient, publicClient, targetNetwork.id, writeTx],
  );

  const postBond = useCallback(async () => {
    if (!bondRequirement.isRequired) return true;
    if (!address) {
      setError("Connect a wallet to post the confidentiality bond.");
      return false;
    }
    if (isAwaitingSponsoredBatchCalls) {
      setError("Preparing wallet. Try again in a moment.");
      return false;
    }
    if (isAwaitingSelfFundedBatchCalls) {
      setError("Wallet switching to paid gas. Retry in a moment.");
      return false;
    }
    if (isMissingGasBalance) {
      const message = getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions });
      setError(message);
      return false;
    }
    if (isIdentityLoading) {
      setError("Checking your private-context eligibility. Try again in a moment.");
      return false;
    }
    if (!hasActiveHumanCredential || !identityKey) {
      setError("Private-context questions require an active human credential before posting a bond.");
      return false;
    }
    if (!publicClient) {
      setError("Preparing wallet. Try again in a moment.");
      return false;
    }
    if (!escrowAddress) {
      setError("Confidentiality bond posting is not configured for this deployment yet.");
      return false;
    }
    if (!tokenAddress) {
      setError(`${bondRequirement.asset} bond token is not configured for this network.`);
      return false;
    }

    setIsPostingBond(true);
    setError(null);
    try {
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_APPROVAL_ABI,
        functionName: "allowance",
        args: [address as Address, escrowAddress],
      })) as bigint;

      const batchEscrowAddress = escrowAddress as `0x${string}`;
      const batchTokenAddress = tokenAddress as `0x${string}`;
      const approvalAmount = getReusableBondApprovalAmount(bondRequirement.amount);
      const approvalCall =
        allowance < bondRequirement.amount
          ? ({
              abi: ERC20_APPROVAL_ABI as Abi,
              address: batchTokenAddress,
              args: [escrowAddress, approvalAmount] as const,
              functionName: "approve",
            } as const)
          : null;
      const postBondCall = {
        abi: CONFIDENTIALITY_ESCROW_ABI as Abi,
        address: batchEscrowAddress,
        args: [contentId] as const,
        functionName: "postBond",
      } as const;
      const canUseBatchedBondPost =
        !localE2ETestWalletClient && (canUseSponsoredBatchCalls || canUseSelfFundedBatchCalls);

      if (canUseBatchedBondPost) {
        let postconditionSatisfied = false;
        const batchPromise = executeContractCallBatch([...(approvalCall ? [approvalCall] : []), postBondCall], {
          action: "post confidentiality bond",
          atomicRequired: true,
          sponsorshipMode: canUseSponsoredBatchCalls ? "sponsored" : "self-funded",
        });
        void batchPromise.catch(batchError => {
          if (postconditionSatisfied) {
            console.warn("[confidentiality] bond postcondition succeeded before thirdweb status settled.", batchError);
          }
        });

        const firstCompletion = await Promise.race([
          batchPromise.then(() => "batch" as const),
          waitForPostedBondPostcondition().then(active => (active ? ("postcondition" as const) : ("timeout" as const))),
        ]);

        if (firstCompletion === "postcondition") {
          postconditionSatisfied = true;
        } else if (firstCompletion === "timeout") {
          await batchPromise;
        }
      } else {
        if (approvalCall) {
          await writeContractCall(approvalCall, `approve ${bondRequirement.asset} bond`);
        }

        await writeContractCall(postBondCall, "post confidentiality bond");
      }

      await refetchIdentity();
      setHasActiveBond(true);
      setCheckedBondKey(bondCheckKey);
      dispatchConfidentialityBondPosted(contentId, identityKey);
      void refreshBond();
      return true;
    } catch (bondError) {
      console.error("[confidentiality] failed to post confidentiality bond.", bondError);
      const message =
        bondError instanceof Error ? bondError.message : "Could not post the required confidentiality bond.";
      setError(message);
      return false;
    } finally {
      setIsPostingBond(false);
    }
  }, [
    address,
    bondCheckKey,
    bondRequirement.amount,
    bondRequirement.asset,
    bondRequirement.isRequired,
    canSponsorTransactions,
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    contentId,
    escrowAddress,
    executeContractCallBatch,
    hasActiveHumanCredential,
    identityKey,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
    isIdentityLoading,
    isMissingGasBalance,
    localE2ETestWalletClient,
    nativeTokenSymbol,
    publicClient,
    refetchIdentity,
    refreshBond,
    tokenAddress,
    waitForPostedBondPostcondition,
    writeContractCall,
  ]);

  return {
    error,
    escrowAddress,
    hasCheckedBond,
    hasActiveBond: bondRequirement.isRequired ? hasActiveBond : true,
    hasActiveHumanCredential,
    identityKey,
    isBondRequired: bondRequirement.isRequired,
    isCheckingBond,
    isIdentityLoading,
    isIdentityResolved,
    isPostingBond,
    postBond,
    refetchIdentity,
    refreshBond,
    tokenAddress,
  };
}
