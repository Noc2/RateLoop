"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
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
import { usePageVisibility } from "~~/hooks/usePageVisibility";
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
import { formatEthTokenAmount } from "~~/lib/ui/tokenAmountDisplay";
import scaffoldConfig from "~~/scaffold.config";
import { notification } from "~~/utils/scaffold-eth";
import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

const STAKE_AMOUNT = 1000; // Fixed 1,000 LREP stake

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEthBalanceLabel(value: bigint | undefined) {
  if (value === undefined) return "Loading ETH";
  if (value === 0n) return "0 ETH";

  const formatted = formatEthTokenAmount(value);
  return `${formatted === "0.0000" ? "<0.0001" : formatted} ETH`;
}

function FrontendOperatorAddressRow({
  label,
  address,
  showNativeBalance = false,
}: {
  label?: string;
  address?: string;
  showNativeBalance?: boolean;
}) {
  const { copyToClipboard, isCopiedToClipboard } = useCopyToClipboard();
  const { targetNetwork } = useTargetNetwork();
  const walletAddress = address && isAddress(address) ? (address as `0x${string}`) : undefined;
  const { data: nativeBalance, isLoading: nativeBalanceLoading } = useBalance({
    address: walletAddress,
    chainId: targetNetwork.id,
    query: {
      enabled: Boolean(showNativeBalance && walletAddress),
    },
  });
  const nativeBalanceValue = nativeBalance?.value;
  const shouldShowNativeBalance = Boolean(showNativeBalance && walletAddress);
  const nativeBalanceIsZero = nativeBalanceValue === 0n;
  const nativeBalanceLabel =
    nativeBalanceValue !== undefined
      ? formatEthBalanceLabel(nativeBalanceValue)
      : nativeBalanceLoading
        ? "Loading ETH"
        : "ETH unavailable";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-base">
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
          {shouldShowNativeBalance && (
            <span
              className={`font-mono text-sm tabular-nums ${
                nativeBalanceIsZero ? "font-semibold text-error" : "text-base-content/60"
              }`}
              title={nativeBalanceValue === undefined ? undefined : `${nativeBalanceValue.toString()} wei`}
            >
              {nativeBalanceLabel}
            </span>
          )}
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
  const isPageVisible = usePageVisibility();
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
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    canUseUnmeteredSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const { showWalletRpcOverloadNotification } = useWalletRpcRecovery();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isDeregistering, setIsDeregistering] = useState(false);
  const [isCompletingDeregister, setIsCompletingDeregister] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isCompletingWithdrawal, setIsCompletingWithdrawal] = useState(false);
  const [isClaimingAllRoundFees, setIsClaimingAllRoundFees] = useState(false);
  const [snapshotProposerInput, setSnapshotProposerInput] = useState("");
  const [isSettingSnapshotProposer, setIsSettingSnapshotProposer] = useState(false);
  const [isClearingSnapshotProposer, setIsClearingSnapshotProposer] = useState(false);
  const [accessRecorderInput, setAccessRecorderInput] = useState("");
  const [isSettingAccessRecorder, setIsSettingAccessRecorder] = useState(false);
  const [isClearingAccessRecorder, setIsClearingAccessRecorder] = useState(false);
  const [claimingRoundKey, setClaimingRoundKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const configuredFrontendCode = scaffoldConfig.frontendCode;
  const deploymentIsConfigured = !!configuredFrontendCode;
  const deploymentMatchesConnectedAddress =
    !!address && !!configuredFrontendCode && configuredFrontendCode.toLowerCase() === address.toLowerCase();
  const canUseSponsoredFrontendRegistrationCalls = canUseSponsoredSubmitCalls || canUseUnmeteredSponsoredSubmitCalls;
  const canUseBatchedFrontendRegistrationCalls = canUseSponsoredFrontendRegistrationCalls || canUseSelfFundedBatchCalls;
  const frontendRegistrationBatchSponsorshipMode = canUseSponsoredFrontendRegistrationCalls
    ? "sponsored"
    : "self-funded";
  const canUseBatchedFrontendRegistryCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const frontendRegistryBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";

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

  // Read the delayed-withdrawal bucket (requested fees stay slashable until release)
  const { data: pendingWithdrawalAmountRaw, refetch: refetchPendingWithdrawal } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "pendingFeeWithdrawalAmount",
    args: [address],
    query: {
      enabled: !!address,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 30_000 : false,
    },
  });

  const { data: pendingWithdrawalReleaseAtRaw, refetch: refetchPendingWithdrawalReleaseAt } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "pendingFeeWithdrawalReleaseAt",
    args: [address],
    query: {
      enabled: !!address,
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 30_000 : false,
    },
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

  const { data: accessRecorderRaw, refetch: refetchAccessRecorder } = useScaffoldReadContract({
    contractName: "FrontendRegistry",
    functionName: "accessRecorderForFrontend",
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
  const operator = frontendInfo ? frontendInfo[0] : undefined;
  const isRegistered = Boolean(operator && operator !== ZERO_ADDRESS);
  const stakedAmount = frontendInfo ? Number(frontendInfo[1]) / 1e6 : 0;
  const isEligible = frontendInfo ? frontendInfo[2] : false;
  const isSlashed = frontendInfo ? frontendInfo[3] : false;
  const exitAvailableAt = exitAvailableAtRaw ? Number(exitAvailableAtRaw) : 0;
  const isExitPending = exitAvailableAt > 0;
  const canCompleteDeregister = isExitPending && nowMs >= exitAvailableAt * 1000;
  const exitAvailableAtLabel = isExitPending ? new Date(exitAvailableAt * 1000).toLocaleString() : "";
  const snapshotProposer =
    snapshotProposerRaw && snapshotProposerRaw !== ZERO_ADDRESS ? snapshotProposerRaw : undefined;
  const normalizedSnapshotProposerInput = snapshotProposerInput.trim();
  const snapshotProposerInputIsValid =
    normalizedSnapshotProposerInput.length > 0 &&
    isAddress(normalizedSnapshotProposerInput) &&
    (!address || normalizedSnapshotProposerInput.toLowerCase() !== address.toLowerCase());
  const accessRecorder = accessRecorderRaw && accessRecorderRaw !== ZERO_ADDRESS ? accessRecorderRaw : undefined;
  const normalizedAccessRecorderInput = accessRecorderInput.trim();
  const accessRecorderInputIsValid =
    normalizedAccessRecorderInput.length > 0 &&
    isAddress(normalizedAccessRecorderInput) &&
    (!address || normalizedAccessRecorderInput.toLowerCase() !== address.toLowerCase());
  // Parse fees (LREP only)
  const lrepFees = accumulatedFees ? Number(accumulatedFees) / 1e6 : 0;
  const hasFees = lrepFees > 0;
  const pendingWithdrawalLrep = pendingWithdrawalAmountRaw ? Number(pendingWithdrawalAmountRaw) / 1e6 : 0;
  const hasPendingWithdrawal = pendingWithdrawalLrep > 0;
  const pendingWithdrawalReleaseAt = pendingWithdrawalReleaseAtRaw ? Number(pendingWithdrawalReleaseAtRaw) : 0;
  const pendingWithdrawalMatured = hasPendingWithdrawal && nowMs >= pendingWithdrawalReleaseAt * 1000;
  const pendingWithdrawalReleaseLabel = hasPendingWithdrawal
    ? new Date(pendingWithdrawalReleaseAt * 1000).toLocaleString()
    : "";
  const hasPendingDeadline = isExitPending || hasPendingWithdrawal;
  const canUseSponsoredGasForRegistration = !isRegistered && canUseSponsoredFrontendRegistrationCalls;
  const showGasBalanceWarning = isMissingGasBalance && !canUseSponsoredGasForRegistration;
  const isRegisterButtonAwaitingWallet =
    !canUseSponsoredFrontendRegistrationCalls && (isAwaitingSponsoredSubmitCalls || isAwaitingSelfFundedSubmitCalls);
  const isRegisterButtonMissingGas = isMissingGasBalance && !canUseSponsoredFrontendRegistrationCalls;

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
    if (!hasPendingDeadline) return;

    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasPendingDeadline]);

  const ensureGasBalance = (options: { usesSponsoredGas?: boolean } = {}) => {
    if (!options.usesSponsoredGas && (isAwaitingSponsoredSubmitCalls || isAwaitingSelfFundedSubmitCalls)) {
      notification.warning("Wallet reconnecting. Retry in a moment.");
      return false;
    }

    if (options.usesSponsoredGas) {
      return true;
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
    const registrationUsesSponsoredGas = frontendRegistrationBatchSponsorshipMode === "sponsored";
    if (!ensureGasBalance({ usesSponsoredGas: registrationUsesSponsoredGas })) return;

    if (lrepFormatted < STAKE_AMOUNT) {
      notification.error("Insufficient LREP balance");
      return;
    }

    setIsRegistering(true);
    try {
      const amountWei = BigInt(STAKE_AMOUNT * 1e6);

      if (canUseBatchedFrontendRegistrationCalls && lrepInfo && lrepAddress) {
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
          {
            allowSelfFundedFallback: frontendRegistrationBatchSponsorshipMode !== "sponsored",
            allowUnmeteredSponsoredCalls:
              frontendRegistrationBatchSponsorshipMode === "sponsored" && !canUseSponsoredSubmitCalls,
            atomicRequired: true,
            sponsorshipMode: frontendRegistrationBatchSponsorshipMode,
          },
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
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "requestDeregister",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
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
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "completeDeregister",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
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

  const handleRequestFeeWithdrawal = async () => {
    if (!address || !hasFees || hasPendingWithdrawal || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsClaiming(true);
    try {
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "requestFeeWithdrawal",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
      } else {
        await writeFrontendRegistry({
          functionName: "requestFeeWithdrawal",
        });
      }

      notification.success(
        `Withdrawal of ${lrepFees.toFixed(2)} LREP requested. It unlocks after the 21-day review window.`,
      );
      refetchFees();
      refetchPendingWithdrawal();
      refetchPendingWithdrawalReleaseAt();
    } catch (e: any) {
      console.error("Withdrawal request failed:", e);
      notifyTransactionError(e, "Failed to request fee withdrawal");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCompleteFeeWithdrawal = async () => {
    if (!address || !pendingWithdrawalMatured || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsCompletingWithdrawal(true);
    try {
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "completeFeeWithdrawal",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
      } else {
        await writeFrontendRegistry({
          functionName: "completeFeeWithdrawal",
        });
      }

      notification.success(`Withdrew ${pendingWithdrawalLrep.toFixed(2)} LREP!`);
      await refreshWalletBalances(address);
      refetchPendingWithdrawal();
      refetchPendingWithdrawalReleaseAt();
    } catch (e: any) {
      console.error("Withdrawal failed:", e);
      notifyTransactionError(e, "Failed to complete fee withdrawal");
    } finally {
      setIsCompletingWithdrawal(false);
    }
  };

  const handleClaimRoundFee = async (contentId: string, roundId: string, claimableFee: string) => {
    if (!address) return;
    if (!ensureGasBalance()) return;

    const roundKey = `${contentId}-${roundId}`;
    setClaimingRoundKey(roundKey);
    try {
      if (canUseBatchedFrontendRegistryCalls && rewardDistributorInfo && rewardDistributorAddress) {
        await executeSponsoredCalls(
          [
            {
              abi: rewardDistributorInfo.abi,
              address: rewardDistributorAddress,
              args: [BigInt(contentId), BigInt(roundId), address],
              functionName: "claimFrontendFee",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
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
      if (canUseBatchedFrontendRegistryCalls && rewardDistributorInfo && rewardDistributorAddress) {
        await executeSponsoredCalls(
          claimableRoundFees.map(item => ({
            abi: rewardDistributorInfo.abi,
            address: rewardDistributorAddress,
            args: [BigInt(item.contentId), BigInt(item.roundId), address],
            functionName: "claimFrontendFee",
          })),
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
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
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              args: [snapshotProposerAddress],
              functionName: "setSnapshotProposer",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
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
      notifyTransactionError(
        e,
        "Failed to update keeper address. Use an unregistered wallet that is not assigned elsewhere.",
      );
    } finally {
      setIsSettingSnapshotProposer(false);
    }
  };

  const handleClearSnapshotProposer = async () => {
    if (!address || !snapshotProposer || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsClearingSnapshotProposer(true);
    try {
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "clearSnapshotProposer",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
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

  const handleSetAccessRecorder = async () => {
    if (!address || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    if (!accessRecorderInputIsValid) {
      notification.error("Enter a separate valid access recorder wallet address.");
      return;
    }

    const accessRecorderAddress = normalizedAccessRecorderInput as `0x${string}`;

    setIsSettingAccessRecorder(true);
    try {
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              args: [accessRecorderAddress],
              functionName: "setAccessRecorder",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
      } else {
        await writeFrontendRegistry({
          functionName: "setAccessRecorder",
          args: [accessRecorderAddress],
        });
      }

      notification.success("Access recorder updated.");
      setAccessRecorderInput("");
      refetchAccessRecorder();
    } catch (e: any) {
      console.error("Access recorder update failed:", e);
      notifyTransactionError(
        e,
        "Failed to update access recorder. Use an unregistered wallet that is not assigned elsewhere.",
      );
    } finally {
      setIsSettingAccessRecorder(false);
    }
  };

  const handleClearAccessRecorder = async () => {
    if (!address || !accessRecorder || !frontendRegistryInfo || !frontendRegistryAddress) return;
    if (!ensureGasBalance()) return;

    setIsClearingAccessRecorder(true);
    try {
      if (canUseBatchedFrontendRegistryCalls) {
        await executeSponsoredCalls(
          [
            {
              abi: frontendRegistryInfo.abi,
              address: frontendRegistryAddress,
              functionName: "clearAccessRecorder",
            },
          ],
          { sponsorshipMode: frontendRegistryBatchSponsorshipMode },
        );
      } else {
        await writeFrontendRegistry({
          functionName: "clearAccessRecorder",
        });
      }

      notification.success("Access recorder cleared.");
      refetchAccessRecorder();
    } catch (e: any) {
      console.error("Access recorder clear failed:", e);
      notifyTransactionError(e, "Failed to clear access recorder");
    } finally {
      setIsClearingAccessRecorder(false);
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

      {showGasBalanceWarning && (
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

          <GradientActionButton
            className="w-full"
            onClick={handleRegister}
            motion={getGradientActionMotion(isRegistering || isRegisterButtonAwaitingWallet)}
            disabled={
              isRegistering ||
              isRegisterButtonAwaitingWallet ||
              isRegisterButtonMissingGas ||
              lrepFormatted < STAKE_AMOUNT
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
              </div>
              {snapshotProposer ? (
                <FrontendOperatorAddressRow address={snapshotProposer} showNativeBalance />
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-1.5 font-medium">
                  Access Recorder
                  <InfoTooltip text="Optional operational wallet that can publish confidentiality log roots for this bonded frontend." />
                </p>
              </div>
              {accessRecorder ? (
                <FrontendOperatorAddressRow address={accessRecorder} showNativeBalance />
              ) : (
                <span className="rounded-full bg-base-200 px-2 py-0.5 text-sm text-base-content/60">Not set</span>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={accessRecorderInput}
                onChange={event => setAccessRecorderInput(event.target.value)}
                placeholder="0x recorder address"
                className="input input-bordered input-sm min-w-0 flex-1 font-mono text-sm"
                disabled={
                  isExitPending ||
                  isSlashed ||
                  isSettingAccessRecorder ||
                  isClearingAccessRecorder ||
                  isAwaitingSponsoredSubmitCalls
                }
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSetAccessRecorder}
                disabled={
                  isExitPending ||
                  isSlashed ||
                  isMissingGasBalance ||
                  isSettingAccessRecorder ||
                  isClearingAccessRecorder ||
                  isAwaitingSponsoredSubmitCalls ||
                  !accessRecorderInputIsValid
                }
              >
                {isSettingAccessRecorder ? <span className="loading loading-spinner loading-xs" /> : "Set Recorder"}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleClearAccessRecorder}
                disabled={
                  !accessRecorder ||
                  isExitPending ||
                  isSlashed ||
                  isMissingGasBalance ||
                  isSettingAccessRecorder ||
                  isClearingAccessRecorder ||
                  isAwaitingSponsoredSubmitCalls
                }
              >
                {isClearingAccessRecorder ? <span className="loading loading-spinner loading-xs" /> : "Clear"}
              </button>
            </div>

            {normalizedAccessRecorderInput &&
              isAddress(normalizedAccessRecorderInput) &&
              address &&
              normalizedAccessRecorderInput.toLowerCase() === address.toLowerCase() && (
                <p className="text-sm text-warning">
                  Use a separate wallet here, or clear the access recorder to publish from the registered wallet.
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
            ) : claimableRoundFees.length > 0 ? (
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
            ) : null}
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
                onClick={handleRequestFeeWithdrawal}
                motion={getGradientActionMotion(isClaiming || isAwaitingSponsoredSubmitCalls)}
                disabled={
                  isClaiming ||
                  isAwaitingSponsoredSubmitCalls ||
                  isMissingGasBalance ||
                  !hasFees ||
                  hasPendingWithdrawal ||
                  isExitPending
                }
              >
                {isClaiming ? <span className="loading loading-spinner loading-xs" /> : "Start withdrawal"}
              </GradientActionButton>
            </div>
            <p className="text-sm text-base-content/50 mt-2">
              Withdrawals unlock after a 21-day review window and stay slashable until then.
            </p>
            {hasPendingWithdrawal && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-base-300">
                <div>
                  <p className="text-base text-base-content/60">Pending withdrawal</p>
                  <p className="text-lg font-bold text-primary">{pendingWithdrawalLrep.toFixed(2)}</p>
                  <p className="text-sm text-base-content/50">
                    {pendingWithdrawalMatured ? "Ready to withdraw" : `Unlocks ${pendingWithdrawalReleaseLabel}`}
                  </p>
                </div>
                <GradientActionButton
                  className="min-w-24"
                  size="sm"
                  onClick={handleCompleteFeeWithdrawal}
                  motion={getGradientActionMotion(isCompletingWithdrawal || isAwaitingSponsoredSubmitCalls)}
                  disabled={
                    isCompletingWithdrawal ||
                    isAwaitingSponsoredSubmitCalls ||
                    isMissingGasBalance ||
                    !pendingWithdrawalMatured ||
                    isExitPending
                  }
                >
                  {isCompletingWithdrawal ? <span className="loading loading-spinner loading-xs" /> : "Withdraw"}
                </GradientActionButton>
              </div>
            )}
            {isExitPending && (
              <p className="text-sm text-base-content/50 mt-2">
                Completing deregistration after the unbonding period also withdraws fees still held in the registry.
              </p>
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
