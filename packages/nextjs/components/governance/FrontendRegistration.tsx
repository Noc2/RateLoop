"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/scaffold-eth";
import { GasBalanceWarning, shouldShowGasWarningTransactionCostsLink } from "~~/components/shared/GasBalanceWarning";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useCopyToClipboard } from "~~/hooks/scaffold-eth";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useFrontendClaimableFees } from "~~/hooks/useFrontendClaimableFees";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletRpcRecovery } from "~~/hooks/useWalletRpcRecovery";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import {
  getGasBalanceErrorMessage,
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
  isWalletRpcOverloadedError,
} from "~~/lib/transactionErrors";
import scaffoldConfig from "~~/scaffold.config";
import { notification } from "~~/utils/scaffold-eth";
import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

const STAKE_AMOUNT = 1000; // Fixed 1,000 LREP stake

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function FrontendOperatorAddressRow({ label, address }: { label?: string; address?: string }) {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();

  return (
    <div className="flex items-center gap-2 text-base">
      {label && <span className="text-base-content/60">{label}</span>}
      {address ? (
        <>
          <BlockieAvatar address={address} size={24} />
          <span className="font-mono" title={address}>
            {truncateAddress(address)}
          </span>
          <button
            type="button"
            onClick={() => copyToClipboard(address)}
            className="btn btn-ghost btn-xs btn-square"
            aria-label="Copy address"
            title="Copy address"
          >
            {isCopiedToClipboard ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
          </button>
        </>
      ) : (
        <span className="text-base-content/50">Sign in</span>
      )}
    </div>
  );
}

/**
 * Frontend Registration section for developers to register as frontend operators
 */
export function FrontendRegistration() {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const refreshWalletBalances = useRefreshWalletBalances();
  const {
    canSponsorTransactions,
    freeTransactionRemaining,
    freeTransactionVerified,
    isMissingGasBalance,
    nativeTokenSymbol,
  } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const showGasWarningTransactionCostsLink = shouldShowGasWarningTransactionCostsLink({
    freeTransactionRemaining,
    freeTransactionVerified,
  });
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls, isAwaitingSponsoredSubmitCalls } =
    useThirdwebSponsoredSubmitCalls();
  const { showWalletRpcOverloadNotification } = useWalletRpcRecovery();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isDeregistering, setIsDeregistering] = useState(false);
  const [isCompletingDeregister, setIsCompletingDeregister] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isClaimingAllRoundFees, setIsClaimingAllRoundFees] = useState(false);
  const [snapshotProposerInput, setSnapshotProposerInput] = useState("");
  const [snapshotFrontendApprovalInput, setSnapshotFrontendApprovalInput] = useState("");
  const [isSettingSnapshotProposer, setIsSettingSnapshotProposer] = useState(false);
  const [isClearingSnapshotProposer, setIsClearingSnapshotProposer] = useState(false);
  const [isApprovingSnapshotFrontend, setIsApprovingSnapshotFrontend] = useState(false);
  const [isRevokingSnapshotFrontendApproval, setIsRevokingSnapshotFrontendApproval] = useState(false);
  const [claimingRoundKey, setClaimingRoundKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const configuredFrontendCode = scaffoldConfig.frontendCode;
  const deploymentIsConfigured = !!configuredFrontendCode;
  const deploymentMatchesConnectedAddress =
    !!address && !!configuredFrontendCode && configuredFrontendCode.toLowerCase() === address.toLowerCase();

  // Contract info
  const { data: frontendRegistryInfo } = useDeployedContractInfo({ contractName: "FrontendRegistry" });
  const { data: lrepInfo } = useDeployedContractInfo({ contractName: REPUTATION_CONTRACT_NAME });
  const { data: rewardDistributorInfo } = useDeployedContractInfo({ contractName: "RoundRewardDistributor" });
  const frontendRegistryAddress = frontendRegistryInfo?.address as `0x${string}` | undefined;
  const lrepAddress = lrepInfo?.address as `0x${string}` | undefined;
  const rewardDistributorAddress = rewardDistributorInfo?.address as `0x${string}` | undefined;
  const { writeContractAsync: writeRewardDistributor } = useScaffoldWriteContract({
    contractName: "RoundRewardDistributor",
  });

  // Read frontend info
  const { data: frontendInfo, refetch: refetchFrontendInfo } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "getFrontendInfo",
    args: [address],
  });

  // Read accumulated fees
  const { data: accumulatedFees, refetch: refetchFees } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "getAccumulatedFees",
    args: [address],
  });

  const { data: exitAvailableAtRaw, refetch: refetchExitAvailableAt } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "frontendExitAvailableAt",
    args: [address],
  });

  const { data: snapshotProposerRaw, refetch: refetchSnapshotProposer } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "snapshotProposerForFrontend",
    args: [address],
  });

  const { data: assignedSnapshotFrontendRaw, refetch: refetchAssignedSnapshotFrontend } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "frontendForSnapshotProposer",
    args: [address],
  });

  const { data: approvedSnapshotFrontendRaw, refetch: refetchApprovedSnapshotFrontend } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "approvedSnapshotFrontendForProposer",
    args: [address],
  });

  // Read LREP balance
  const { data: lrepBalance, refetch: refetchRateLoop } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
  });

  // Write contracts
  const { writeContractAsync: writeLrep } = useScaffoldWriteContract({ contractName: REPUTATION_CONTRACT_NAME });
  const { writeContractAsync: writeFrontendRegistry } = useScaffoldWriteContract({ contractName: "FrontendRegistry" });
  // Separate hook with simulation disabled for register (follows an approve tx,
  // so the simulation may run against stale state before the approve is reflected).
  const { writeContractAsync: writeFrontendRegistryNoSim } = useScaffoldWriteContract({
    contractName: "FrontendRegistry",
    disableSimulate: true,
  });

  // Parse frontend info
  const isRegistered = frontendInfo && frontendInfo[1] > 0n; // stakedAmount > 0
  const stakedAmount = frontendInfo ? Number(frontendInfo[1]) / 1e6 : 0;
  const isEligible = frontendInfo ? frontendInfo[2] : false;
  const isSlashed = frontendInfo ? frontendInfo[3] : false;
  const exitAvailableAt = exitAvailableAtRaw ? Number(exitAvailableAtRaw) : 0;
  const isExitPending = exitAvailableAt > 0;
  const canCompleteDeregister = isExitPending && nowMs >= exitAvailableAt * 1000;
  const exitAvailableAtLabel = isExitPending ? new Date(exitAvailableAt * 1000).toLocaleString() : "";
  const snapshotProposer =
    snapshotProposerRaw && snapshotProposerRaw !== ZERO_ADDRESS ? snapshotProposerRaw : undefined;
  const assignedSnapshotFrontend =
    assignedSnapshotFrontendRaw && assignedSnapshotFrontendRaw !== ZERO_ADDRESS
      ? assignedSnapshotFrontendRaw
      : undefined;
  const approvedSnapshotFrontend =
    approvedSnapshotFrontendRaw && approvedSnapshotFrontendRaw !== ZERO_ADDRESS
      ? approvedSnapshotFrontendRaw
      : undefined;
  const normalizedSnapshotProposerInput = snapshotProposerInput.trim();
  const snapshotProposerInputIsValid =
    normalizedSnapshotProposerInput.length > 0 &&
    isAddress(normalizedSnapshotProposerInput) &&
    (!address || normalizedSnapshotProposerInput.toLowerCase() !== address.toLowerCase());
  const normalizedSnapshotFrontendApprovalInput = snapshotFrontendApprovalInput.trim();
  const snapshotFrontendApprovalInputIsValid =
    normalizedSnapshotFrontendApprovalInput.length > 0 &&
    isAddress(normalizedSnapshotFrontendApprovalInput) &&
    (!address || normalizedSnapshotFrontendApprovalInput.toLowerCase() !== address.toLowerCase());
  // Parse fees (LREP only)
  const lrepFees = accumulatedFees ? Number(accumulatedFees) / 1e6 : 0;
  const hasFees = lrepFees > 0;

  // LREP balance
  const lrepFormatted = lrepBalance ? Number(lrepBalance) / 1e6 : 0;
  const {
    items: claimableRoundFees,
    totalClaimable: totalClaimableRoundFees,
    isLoading: claimableRoundFeesLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch: refetchClaimableRoundFees,
  } = useFrontendClaimableFees(isRegistered && address ? (address as `0x${string}`) : undefined, targetNetwork.id);
  const totalClaimableRoundFeesFormatted = Number(totalClaimableRoundFees) / 1e6;

  useEffect(() => {
    if (!isExitPending) return;

    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isExitPending]);

  const ensureGasBalance = () => {
    if (isAwaitingSponsoredSubmitCalls) {
      notification.warning("Wallet reconnecting. Retry in a moment.");
      return false;
    }

    if (!isMissingGasBalance) {
      return true;
    }

    notification.error(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
    return false;
  };

  const notifyTransactionError = (error: unknown, fallback: string) => {
    if (isFreeTransactionExhaustedError(error) || isInsufficientFundsError(error)) {
      notification.error(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      return;
    }

    if (isWalletRpcOverloadedError(error)) {
      showWalletRpcOverloadNotification();
      return;
    }

    notification.error(
      (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
        (error as { shortMessage?: string; message?: string } | undefined)?.message ||
        fallback,
    );
  };

  const handleRegister = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    if (lrepFormatted < STAKE_AMOUNT) {
      notification.error("Insufficient LREP balance");
      return;
    }

    setIsRegistering(true);
    try {
      const amountWei = BigInt(STAKE_AMOUNT * 1e6);

      if (canUseSponsoredSubmitCalls && lrepInfo && lrepAddress) {
        await executeSponsoredCalls(
          [
            {
              abi: lrepInfo.abi,
              address: lrepAddress,
              args: [frontendRegistryAddress, amountWei],
              functionName: "approve",
            },
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "register",
            },
          ],
          { atomicRequired: true },
        );
      } else {
        await writeLrep({
          functionName: "approve",
          args: [frontendRegistryAddress, amountWei],
        });

        if (!address) {
          notification.error("Wallet disconnected after approval. Please reconnect and retry.");
          return;
        }

        await writeFrontendRegistryNoSim({
          functionName: "register",
        });
      }
      notification.success("Registered.");

      refetchFrontendInfo();
      refetchRateLoop();
    } catch (e: any) {
      console.error("Registration failed:", e);
      notifyTransactionError(e, "Failed to register");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleDeregister = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsDeregistering(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            functionName: "requestDeregister",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "requestDeregister",
        });
      }

      notification.success("Exit started.");
      refetchFrontendInfo();
      refetchExitAvailableAt();
      refetchFees();
      refetchRateLoop();
    } catch (e: any) {
      console.error("Deregister failed:", e);
      notifyTransactionError(e, "Failed to deregister");
    } finally {
      setIsDeregistering(false);
    }
  };

  const handleCompleteDeregister = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsCompletingDeregister(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            functionName: "completeDeregister",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "completeDeregister",
        });
      }

      notification.success("Deregistration completed. Stake and pending fees withdrawn.");
      refetchFrontendInfo();
      refetchExitAvailableAt();
      refetchFees();
      refetchRateLoop();
    } catch (e: any) {
      console.error("Complete deregister failed:", e);
      notifyTransactionError(e, "Failed to complete deregistration");
    } finally {
      setIsCompletingDeregister(false);
    }
  };

  const handleClaimFees = async () => {
    if (!address || !hasFees || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsClaiming(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            functionName: "claimFees",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "claimFees",
        });
      }

      notification.success(`Claimed ${lrepFees.toFixed(2)} LREP!`);
      await refreshWalletBalances(address);
      refetchFees();
    } catch (e: any) {
      console.error("Claim failed:", e);
      notifyTransactionError(e, "Failed to claim fees");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClaimRoundFee = async (contentId: string, roundId: string, claimableFee: string) => {
    if (!address) return;
    if (!ensureGasBalance()) return;

    const roundKey = `${contentId}-${roundId}`;
    setClaimingRoundKey(roundKey);
    try {
      if (canUseSponsoredSubmitCalls && rewardDistributorInfo && rewardDistributorAddress) {
        await executeSponsoredCalls([
          {
            abi: rewardDistributorInfo.abi,
            address: rewardDistributorAddress,
            args: [BigInt(contentId), BigInt(roundId), address],
            functionName: "claimFrontendFee",
          },
        ]);
      } else {
        await writeRewardDistributor({
          functionName: "claimFrontendFee",
          args: [BigInt(contentId), BigInt(roundId), address],
        });
      }

      notification.success(`Credited ${(Number(BigInt(claimableFee)) / 1e6).toFixed(2)} LREP from round ${roundId}.`);
      await refreshWalletBalances(address);
      await Promise.all([refetchClaimableRoundFees(), refetchFees()]);
    } catch (e: any) {
      console.error("Frontend round fee claim failed:", e);
      notifyTransactionError(e, "Failed to credit round fee");
    } finally {
      setClaimingRoundKey(current => (current === roundKey ? null : current));
    }
  };

  const handleClaimAllRoundFees = async () => {
    if (!address || claimableRoundFees.length === 0) return;
    if (!ensureGasBalance()) return;

    setIsClaimingAllRoundFees(true);
    let claimedCount = 0;

    try {
      if (canUseSponsoredSubmitCalls && rewardDistributorInfo && rewardDistributorAddress) {
        await executeSponsoredCalls(
          claimableRoundFees.map(item => ({
            abi: rewardDistributorInfo.abi,
            address: rewardDistributorAddress,
            args: [BigInt(item.contentId), BigInt(item.roundId), address],
            functionName: "claimFrontendFee",
          })),
        );
        claimedCount = claimableRoundFees.length;
      } else {
        for (const item of claimableRoundFees) {
          try {
            await writeRewardDistributor({
              functionName: "claimFrontendFee",
              args: [BigInt(item.contentId), BigInt(item.roundId), address],
            });
            claimedCount += 1;
          } catch (error) {
            console.error(`Failed to claim frontend fee for ${item.contentId}-${item.roundId}:`, error);
          }
        }
      }

      if (claimedCount > 0) {
        notification.success(
          `Credited frontend fees from ${claimedCount} settled round${claimedCount === 1 ? "" : "s"}.`,
        );
      }
      if (claimedCount < claimableRoundFees.length) {
        notification.warning("Some frontend fee claims failed. You can retry the remaining rounds individually.");
      }

      if (claimedCount > 0) {
        await refreshWalletBalances(address);
      }
      await Promise.all([refetchClaimableRoundFees(), refetchFees()]);
    } catch (e: any) {
      console.error("Claim all frontend round fees failed:", e);
      notifyTransactionError(e, "Failed to credit round fees");
    } finally {
      setIsClaimingAllRoundFees(false);
      setClaimingRoundKey(null);
    }
  };

  const handleSetSnapshotProposer = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    if (!snapshotProposerInputIsValid) {
      notification.error("Enter a separate valid keeper wallet address.");
      return;
    }

    const snapshotProposerAddress = normalizedSnapshotProposerInput as `0x${string}`;

    setIsSettingSnapshotProposer(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            args: [snapshotProposerAddress],
            functionName: "setSnapshotProposer",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "setSnapshotProposer",
          args: [snapshotProposerAddress],
        });
      }

      notification.success("Keeper address updated.");
      setSnapshotProposerInput("");
      refetchSnapshotProposer();
    } catch (e: any) {
      console.error("Keeper address update failed:", e);
      notifyTransactionError(e, "Failed to update keeper address. The keeper wallet must approve this frontend first.");
    } finally {
      setIsSettingSnapshotProposer(false);
    }
  };

  const handleClearSnapshotProposer = async () => {
    if (!address || !snapshotProposer || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsClearingSnapshotProposer(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            functionName: "clearSnapshotProposer",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "clearSnapshotProposer",
        });
      }

      notification.success("Keeper address cleared.");
      refetchSnapshotProposer();
    } catch (e: any) {
      console.error("Keeper address clear failed:", e);
      notifyTransactionError(e, "Failed to clear keeper address");
    } finally {
      setIsClearingSnapshotProposer(false);
    }
  };

  const handleApproveSnapshotFrontend = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    if (!snapshotFrontendApprovalInputIsValid) {
      notification.error("Enter a separate valid frontend operator address.");
      return;
    }

    const frontendAddress = normalizedSnapshotFrontendApprovalInput as `0x${string}`;

    setIsApprovingSnapshotFrontend(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            args: [frontendAddress],
            functionName: "approveSnapshotFrontend",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "approveSnapshotFrontend",
          args: [frontendAddress],
        });
      }

      notification.success("Frontend approval updated.");
      setSnapshotFrontendApprovalInput("");
      refetchAssignedSnapshotFrontend();
      refetchApprovedSnapshotFrontend();
    } catch (e: any) {
      console.error("Snapshot frontend approval failed:", e);
      notifyTransactionError(e, "Failed to approve frontend. The address must be a registered active frontend.");
    } finally {
      setIsApprovingSnapshotFrontend(false);
    }
  };

  const handleRevokeSnapshotFrontendApproval = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!approvedSnapshotFrontend && !assignedSnapshotFrontend) return;
    if (!ensureGasBalance()) return;

    setIsRevokingSnapshotFrontendApproval(true);
    try {
      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls([
          {
            abi: frontendRegistryInfo.abi,
            address: frontendRegistryAddress,
            args: [ZERO_ADDRESS],
            functionName: "approveSnapshotFrontend",
          },
        ]);
      } else {
        await writeFrontendRegistry({
          functionName: "approveSnapshotFrontend",
          args: [ZERO_ADDRESS],
        });
      }

      notification.success("Snapshot keeper approval cleared.");
      refetchAssignedSnapshotFrontend();
      refetchApprovedSnapshotFrontend();
    } catch (e: any) {
      console.error("Snapshot frontend approval clear failed:", e);
      notifyTransactionError(e, "Failed to clear snapshot keeper approval");
    } finally {
      setIsRevokingSnapshotFrontendApproval(false);
    }
  };

  // Status badge
  const getStatusBadge = () => {
    if (isSlashed) {
      return <span className="px-2 py-0.5 rounded-full text-base font-medium bg-error/20 text-error">Penalized</span>;
    }
    if (isExitPending) {
      return <span className="px-2 py-0.5 rounded-full text-base font-medium bg-info/20 text-info">Exit Pending</span>;
    }
    if (isEligible) {
      return <span className="px-2 py-0.5 rounded-full text-base font-medium bg-success/20 text-success">Active</span>;
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-base font-medium bg-warning/20 text-warning">Underbonded</span>
    );
  };

  return (
    <div className="surface-card rounded-2xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <h2 className={surfaceSectionHeadingClassName}>Frontend Registration</h2>
        <InfoTooltip text="Stake 1,000 LREP to earn frontend fees from predictions submitted through your interface." />
      </div>

      <p className="text-base text-base-content/60">
        Stake 1,000 LREP and earn frontend fees.{" "}
        <Link href="/docs/frontend-codes" className="link link-primary">
          Learn about frontend integrations →
        </Link>
      </p>

      {isMissingGasBalance && (
        <GasBalanceWarning
          nativeTokenSymbol={nativeTokenSymbol}
          showTransactionCostsLink={showGasWarningTransactionCostsLink}
        />
      )}

      <div className="rounded-2xl bg-base-300 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">This deployment&apos;s frontend code</p>
          {deploymentIsConfigured ? (
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-sm font-medium text-success">Configured</span>
          ) : (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-sm font-medium text-warning">Missing</span>
          )}
        </div>
        {deploymentIsConfigured ? (
          <FrontendOperatorAddressRow address={configuredFrontendCode} />
        ) : (
          <p className="text-sm text-base-content/70">
            Set <code>NEXT_PUBLIC_FRONTEND_CODE</code> to the frontend operator address before launch. Otherwise
            predictions from this deployment will not accrue frontend fees.
          </p>
        )}
        {deploymentIsConfigured && !deploymentMatchesConnectedAddress && (
          <p className="text-sm text-warning">
            This deployment currently attributes votes to {configuredFrontendCode}, not the wallet connected here.
          </p>
        )}
        {deploymentMatchesConnectedAddress && (
          <p className="text-sm text-success">
            This deployment is already pointing at the connected frontend operator address.
          </p>
        )}
      </div>

      {!isRegistered ? (
        // Registration Form
        <div className="space-y-4">
          {/* Address being registered */}
          <FrontendOperatorAddressRow label="Registering address:" address={address} />

          {/* Stake info */}
          <div className="surface-card-nested rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
                  Frontend Stake
                  <InfoTooltip text="Returned when you withdraw, forfeited if you act maliciously. Receive the governed frontend share from predictions submitted via your interface." />
                </p>
              </div>
              <div className="text-right">
                <span className="text-xl font-bold text-base-content">{STAKE_AMOUNT.toLocaleString()} LREP</span>
              </div>
            </div>
          </div>

          <div className="surface-card-nested rounded-2xl p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-base font-medium text-base-content">
                  Snapshot Keeper Approval
                  <InfoTooltip text="Approve a registered frontend before that frontend can assign this wallet as its snapshot keeper." />
                </p>
                <p className="text-sm text-base-content/60">
                  Use this from a separate keeper wallet before the frontend operator sets it.
                </p>
              </div>
              <div className="space-y-1 sm:text-right">
                {assignedSnapshotFrontend ? (
                  <FrontendOperatorAddressRow label="Active frontend:" address={assignedSnapshotFrontend} />
                ) : (
                  <p className="text-sm text-base-content/50">No active frontend</p>
                )}
                {approvedSnapshotFrontend ? (
                  <FrontendOperatorAddressRow label="Pending approval:" address={approvedSnapshotFrontend} />
                ) : (
                  <p className="text-sm text-base-content/50">No pending approval</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={snapshotFrontendApprovalInput}
                onChange={event => setSnapshotFrontendApprovalInput(event.target.value)}
                placeholder="0x frontend operator"
                className="input input-bordered input-sm min-w-0 flex-1 font-mono text-sm"
                disabled={
                  isApprovingSnapshotFrontend || isRevokingSnapshotFrontendApproval || isAwaitingSponsoredSubmitCalls
                }
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleApproveSnapshotFrontend}
                disabled={
                  isMissingGasBalance ||
                  isApprovingSnapshotFrontend ||
                  isRevokingSnapshotFrontendApproval ||
                  isAwaitingSponsoredSubmitCalls ||
                  !snapshotFrontendApprovalInputIsValid
                }
              >
                {isApprovingSnapshotFrontend ? <span className="loading loading-spinner loading-xs" /> : "Approve"}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleRevokeSnapshotFrontendApproval}
                disabled={
                  isMissingGasBalance ||
                  isApprovingSnapshotFrontend ||
                  isRevokingSnapshotFrontendApproval ||
                  isAwaitingSponsoredSubmitCalls ||
                  (!approvedSnapshotFrontend && !assignedSnapshotFrontend)
                }
              >
                {isRevokingSnapshotFrontendApproval ? <span className="loading loading-spinner loading-xs" /> : "Clear"}
              </button>
            </div>

            {normalizedSnapshotFrontendApprovalInput &&
              isAddress(normalizedSnapshotFrontendApprovalInput) &&
              address &&
              normalizedSnapshotFrontendApprovalInput.toLowerCase() === address.toLowerCase() && (
                <p className="text-sm text-warning">Approve the registered frontend, not this keeper wallet.</p>
              )}
          </div>

          <GradientActionButton
            className="w-full"
            onClick={handleRegister}
            motion={getGradientActionMotion(isRegistering || isAwaitingSponsoredSubmitCalls)}
            disabled={
              isRegistering || isAwaitingSponsoredSubmitCalls || isMissingGasBalance || lrepFormatted < STAKE_AMOUNT
            }
          >
            {isRegistering ? (
              <span className="flex items-center gap-2">
                <span className="loading loading-spinner loading-sm" />
                Registering...
              </span>
            ) : (
              "Register as Frontend Operator"
            )}
          </GradientActionButton>
        </div>
      ) : (
        // Registered State
        <div className="space-y-4">
          {/* Registered address */}
          <FrontendOperatorAddressRow label="Registered address:" address={address} />

          {/* Status and Stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base-content/60">Status:</span>
              {getStatusBadge()}
            </div>
            <div className="text-right">
              <p className="text-base text-base-content/60">Staked</p>
              <p className="text-lg font-bold">{stakedAmount.toLocaleString()} LREP</p>
            </div>
          </div>

          <div className="surface-card-nested rounded-xl p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-medium">
                  Snapshot Keeper
                  <InfoTooltip text="Optional operational wallet that can publish payout roots for this bonded frontend." />
                </p>
                <p className="text-sm text-base-content/60">
                  Keep the registered frontend wallet offline. The keeper wallet must approve this frontend before it
                  can be set.
                </p>
              </div>
              {snapshotProposer ? (
                <FrontendOperatorAddressRow address={snapshotProposer} />
              ) : (
                <span className="rounded-full bg-base-200 px-2 py-0.5 text-sm text-base-content/60">Not set</span>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={snapshotProposerInput}
                onChange={event => setSnapshotProposerInput(event.target.value)}
                placeholder="0x keeper address"
                className="input input-bordered input-sm min-w-0 flex-1 font-mono text-sm"
                disabled={
                  isExitPending ||
                  isSlashed ||
                  isSettingSnapshotProposer ||
                  isClearingSnapshotProposer ||
                  isAwaitingSponsoredSubmitCalls
                }
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSetSnapshotProposer}
                disabled={
                  isExitPending ||
                  isSlashed ||
                  isMissingGasBalance ||
                  isSettingSnapshotProposer ||
                  isClearingSnapshotProposer ||
                  isAwaitingSponsoredSubmitCalls ||
                  !snapshotProposerInputIsValid
                }
              >
                {isSettingSnapshotProposer ? <span className="loading loading-spinner loading-xs" /> : "Set Keeper"}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleClearSnapshotProposer}
                disabled={
                  !snapshotProposer ||
                  isExitPending ||
                  isSlashed ||
                  isMissingGasBalance ||
                  isSettingSnapshotProposer ||
                  isClearingSnapshotProposer ||
                  isAwaitingSponsoredSubmitCalls
                }
              >
                {isClearingSnapshotProposer ? <span className="loading loading-spinner loading-xs" /> : "Clear"}
              </button>
            </div>

            {normalizedSnapshotProposerInput &&
              isAddress(normalizedSnapshotProposerInput) &&
              address &&
              normalizedSnapshotProposerInput.toLowerCase() === address.toLowerCase() && (
                <p className="text-sm text-warning">
                  Use a separate wallet here, or clear the keeper address to publish from the registered wallet.
                </p>
              )}
          </div>

          <div className="surface-card-nested rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Unclaimed Round Fees</p>
                <p className="text-sm text-base-content/60">
                  Claim settled round fees into the registry first, then withdraw them below.
                </p>
              </div>
              <div className="text-right">
                <p className="text-base text-base-content/60">Claimable</p>
                <p className="text-lg font-bold text-secondary">{totalClaimableRoundFeesFormatted.toFixed(2)} LREP</p>
              </div>
            </div>

            {isSlashed ? (
              <p className="text-sm text-warning">Round fee claims stay locked while this frontend is slashed.</p>
            ) : claimableRoundFeesLoading && claimableRoundFees.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-base-content/60">
                <span className="loading loading-spinner loading-xs" />
                Scanning settled rounds for claimable frontend fees...
              </div>
            ) : claimableRoundFees.length === 0 ? (
              <p className="text-sm text-base-content/60">
                No unclaimed frontend fees were found in settled rounds for this frontend.
              </p>
            ) : (
              <div className="space-y-3">
                <GradientActionButton
                  className="w-full"
                  size="sm"
                  onClick={handleClaimAllRoundFees}
                  motion={getGradientActionMotion(isClaimingAllRoundFees || isAwaitingSponsoredSubmitCalls)}
                  disabled={
                    isClaimingAllRoundFees || isAwaitingSponsoredSubmitCalls || isMissingGasBalance || isSlashed
                  }
                >
                  {isClaimingAllRoundFees ? (
                    <span className="flex items-center gap-2">
                      <span className="loading loading-spinner loading-xs" />
                      Claiming round fees...
                    </span>
                  ) : (
                    "Claim All Round Fees"
                  )}
                </GradientActionButton>

                <div className="space-y-2">
                  {claimableRoundFees.map(item => {
                    const roundKey = `${item.contentId}-${item.roundId}`;
                    const isClaimingRound = claimingRoundKey === roundKey;

                    return (
                      <div key={roundKey} className="surface-card-nested rounded-xl p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium line-clamp-2">
                              {item.title || item.url || `Content ${item.contentId}`}
                            </p>
                            <p className="text-sm text-base-content/60">
                              Round {item.roundId}
                              {item.settledAt
                                ? ` • Settled ${new Date(Number(item.settledAt) * 1000).toLocaleString()}`
                                : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm text-base-content/60">Claimable</p>
                            <p className="font-semibold">{(Number(BigInt(item.claimableFee)) / 1e6).toFixed(2)} LREP</p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <p className="text-xs text-base-content/50 truncate">
                            Pool {(Number(BigInt(item.totalFrontendPool)) / 1e6).toFixed(2)} LREP
                          </p>
                          <button
                            className="btn btn-outline btn-primary btn-sm"
                            onClick={() => handleClaimRoundFee(item.contentId, item.roundId, item.claimableFee)}
                            disabled={
                              isClaimingRound ||
                              isClaimingAllRoundFees ||
                              isAwaitingSponsoredSubmitCalls ||
                              isMissingGasBalance ||
                              isSlashed
                            }
                          >
                            {isClaimingRound ? <span className="loading loading-spinner loading-xs" /> : "Claim round"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hasNextPage && (
                  <button
                    className="btn btn-ghost btn-sm w-full"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <span className="flex items-center gap-2">
                        <span className="loading loading-spinner loading-xs" />
                        Scanning older rounds...
                      </span>
                    ) : (
                      "Scan Older Settled Rounds"
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Accumulated Fees */}
          <div className="surface-card-nested rounded-xl p-4">
            <p className="font-medium mb-3">Accumulated Fees</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base text-base-content/60">LREP</p>
                <p className="text-lg font-bold text-primary">{lrepFees.toFixed(2)}</p>
              </div>
              <GradientActionButton
                className="min-w-24"
                size="sm"
                onClick={handleClaimFees}
                motion={getGradientActionMotion(isClaiming || isAwaitingSponsoredSubmitCalls)}
                disabled={
                  isClaiming || isAwaitingSponsoredSubmitCalls || isMissingGasBalance || !hasFees || isExitPending
                }
              >
                {isClaiming ? <span className="loading loading-spinner loading-xs" /> : "Claim"}
              </GradientActionButton>
            </div>
            {isExitPending && (
              <p className="text-sm text-base-content/50 mt-2">Fee withdrawals stay locked until exit is completed.</p>
            )}
          </div>

          {/* Deregister */}
          {!isSlashed && (
            <div className="pt-2 border-t border-base-300">
              {isExitPending ? (
                <>
                  <button
                    className="btn btn-outline btn-error btn-sm w-full"
                    onClick={handleCompleteDeregister}
                    disabled={
                      isCompletingDeregister ||
                      isAwaitingSponsoredSubmitCalls ||
                      isMissingGasBalance ||
                      !canCompleteDeregister
                    }
                  >
                    {isCompletingDeregister ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      "Complete Deregistration"
                    )}
                  </button>
                  <p className="text-sm text-base-content/50 mt-1">
                    Exit requested. Complete it after the unbonding period to withdraw your{" "}
                    {stakedAmount.toLocaleString()} LREP stake and any pending fees.
                    {exitAvailableAtLabel ? ` Available after ${exitAvailableAtLabel}.` : ""}
                  </p>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-outline btn-error btn-sm w-full"
                    onClick={handleDeregister}
                    disabled={isDeregistering || isAwaitingSponsoredSubmitCalls || isMissingGasBalance}
                  >
                    {isDeregistering ? <span className="loading loading-spinner loading-xs" /> : "Start Deregistration"}
                  </button>
                  <p className="text-sm text-base-content/50 mt-1">
                    Starts a 14-day unbonding period. After that, you can complete deregistration to withdraw your{" "}
                    {stakedAmount.toLocaleString()} LREP stake and any pending fees.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
