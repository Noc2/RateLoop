"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Abi } from "viem";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { ArrowsRightLeftIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { GOVERNANCE_ROUTE } from "~~/constants/routes";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { useDelegation } from "~~/hooks/useDelegation";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionFlowToast } from "~~/hooks/useTransactionFlowToast";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { getLrepTransferErrorMessage } from "~~/lib/lrepTransferErrors";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";
import scaffoldConfig from "~~/scaffold.config";
import { notification } from "~~/utils/scaffold-eth";
import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

const LREP_DECIMALS = 6;

function parseLrepAmount(value: string): bigint | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    return parseUnits(trimmedValue, LREP_DECIMALS);
  } catch {
    return null;
  }
}

function getProfileTransactionPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

function normalizeAddress(value: string | null | undefined) {
  return (value ?? ZERO_ADDRESS).toLowerCase();
}

export function DelegationSection() {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const refreshWalletBalances = useRefreshWalletBalances();
  const { hasActiveHumanCredential, isLoading: credentialLoading } = useRaterRegistryIdentity(address);
  const {
    delegateTo,
    hasDelegate,
    isDelegate,
    delegateOf,
    isLoading,
    isPending: isDelegationPending,
    writeContractAsync,
    refetch,
  } = useDelegation(address);
  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!address },
  });
  const { data: lrepContract } = useDeployedContractInfo({
    contractName: REPUTATION_CONTRACT_NAME,
  });
  const { data: raterRegistryContract } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  } as any);
  const { writeContractAsync: writeLrepContractAsync, isPending: isDirectTransferPending } = useScaffoldWriteContract({
    contractName: REPUTATION_CONTRACT_NAME,
  });
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeContractCallBatch,
    executeSponsoredCalls,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const flowToast = useTransactionFlowToast();
  const { isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    allowInAppSponsorshipSync: false,
    includeExternalSendCalls: true,
  });
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });

  const [delegateInput, setDelegateInput] = useState("");
  const [transferAddressInput, setTransferAddressInput] = useState("");
  const [transferAmountInput, setTransferAmountInput] = useState("");
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [isSponsoredDelegationPending, setIsSponsoredDelegationPending] = useState(false);
  const [isSponsoredTransferPending, setIsSponsoredTransferPending] = useState(false);

  const normalizedDelegateInput = delegateInput.trim();
  const isValidAddress = normalizedDelegateInput.length > 0 && isAddress(normalizedDelegateInput);
  const isSelfAddress = normalizedDelegateInput.toLowerCase() === address?.toLowerCase();
  const isLrepBalanceLoading = !!address && typeof lrepBalance !== "bigint";
  const lrepBalanceMicro = typeof lrepBalance === "bigint" ? lrepBalance : 0n;
  const formattedBalance = isLrepBalanceLoading ? "Loading..." : formatLrepAmount(lrepBalanceMicro, 6);

  const normalizedTransferAddress = transferAddressInput.trim();
  const parsedTransferAmount = useMemo(() => parseLrepAmount(transferAmountInput), [transferAmountInput]);
  const hasTransferAmount = transferAmountInput.trim().length > 0;
  const isValidTransferAddress = normalizedTransferAddress.length > 0 && isAddress(normalizedTransferAddress);
  const isTransferSelfAddress = normalizedTransferAddress.toLowerCase() === address?.toLowerCase();
  const isTransferZeroAddress = normalizedTransferAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase();
  const isValidTransferAmount = parsedTransferAmount !== null && parsedTransferAmount > 0n;
  const exceedsTransferBalance =
    !isLrepBalanceLoading && parsedTransferAmount !== null && parsedTransferAmount > lrepBalanceMicro;
  const isDelegationWritePending = isDelegationPending || isSponsoredDelegationPending;
  const isTransferPending = isDirectTransferPending || isSponsoredTransferPending;
  const canUseBatchedLrepTransferCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const lrepTransferBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const canSubmitTransfer =
    !isLrepBalanceLoading &&
    !isAwaitingSponsoredSubmitCalls &&
    !isAwaitingSelfFundedBatchCalls &&
    isValidTransferAddress &&
    !isTransferZeroAddress &&
    !isTransferSelfAddress &&
    isValidTransferAmount &&
    !exceedsTransferBalance &&
    !walletTransactionReadiness.isBlocked;

  const submitDelegationWrite = async (
    functionName: "setDelegate" | "removeDelegate",
    args: readonly unknown[],
    action: string,
  ) => {
    const canUseBatchedDelegationWrite = Boolean(
      raterRegistryContract && (canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls),
    );

    if (canUseBatchedDelegationWrite && raterRegistryContract) {
      setIsSponsoredDelegationPending(true);
      const delegationBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
      flowToast.beginFlow({
        action,
        sponsored: delegationBatchSponsorshipMode === "sponsored",
      });
      const batchOptions = {
        ...flowToast.getSponsoredBatchOptions({
          action,
          sponsorshipMode: delegationBatchSponsorshipMode,
        }),
        atomicRequired: true,
      };
      try {
        const registryAddress = raterRegistryContract.address as `0x${string}`;
        const registryAbi = raterRegistryContract.abi as Abi;
        const holderAddress = address as `0x${string}` | undefined;
        const readRegistryAddress = async (
          name: "delegateTo" | "delegateOf" | "pendingDelegateTo" | "pendingDelegateOf",
          arg: string,
        ) => {
          if (!publicClient) return ZERO_ADDRESS;
          try {
            return (await publicClient.readContract({
              address: registryAddress,
              abi: registryAbi,
              functionName: name,
              args: [arg],
            } as never)) as string;
          } catch {
            return ZERO_ADDRESS;
          }
        };
        const activeDelegateBefore = holderAddress
          ? await readRegistryAddress("delegateTo", holderAddress)
          : ZERO_ADDRESS;
        const pendingDelegateBefore = holderAddress
          ? await readRegistryAddress("pendingDelegateTo", holderAddress)
          : ZERO_ADDRESS;
        const nextDelegate = functionName === "setDelegate" ? (args[0] as `0x${string}` | undefined) : undefined;
        const canWaitForPostcondition = Boolean(
          publicClient &&
            holderAddress &&
            (functionName === "setDelegate"
              ? nextDelegate && normalizeAddress(pendingDelegateBefore) !== normalizeAddress(nextDelegate)
              : normalizeAddress(activeDelegateBefore) !== normalizeAddress(ZERO_ADDRESS) ||
                normalizeAddress(pendingDelegateBefore) !== normalizeAddress(ZERO_ADDRESS)),
        );

        if (canWaitForPostcondition) {
          await raceTransactionWithPostcondition({
            onPostconditionSuccessThenTransactionError: error => {
              console.warn("[delegation] postcondition succeeded before thirdweb status settled.", {
                error,
                functionName,
              });
            },
            transaction: () =>
              executeContractCallBatch(
                [
                  {
                    abi: registryAbi,
                    address: registryAddress,
                    args,
                    functionName,
                  },
                ],
                batchOptions,
              ),
            waitForPostcondition: shouldStop =>
              waitForTransactionPostcondition(
                async () => {
                  if (!holderAddress) return false;
                  if (functionName === "setDelegate" && nextDelegate) {
                    const [pendingDelegateTo, pendingDelegateOf] = await Promise.all([
                      readRegistryAddress("pendingDelegateTo", holderAddress),
                      readRegistryAddress("pendingDelegateOf", nextDelegate),
                    ]);
                    return (
                      normalizeAddress(pendingDelegateTo) === normalizeAddress(nextDelegate) &&
                      normalizeAddress(pendingDelegateOf) === normalizeAddress(holderAddress)
                    );
                  }

                  const checks = [
                    readRegistryAddress("delegateTo", holderAddress).then(
                      value => normalizeAddress(value) === normalizeAddress(ZERO_ADDRESS),
                    ),
                    readRegistryAddress("pendingDelegateTo", holderAddress).then(
                      value => normalizeAddress(value) === normalizeAddress(ZERO_ADDRESS),
                    ),
                  ];
                  if (normalizeAddress(activeDelegateBefore) !== normalizeAddress(ZERO_ADDRESS)) {
                    checks.push(
                      readRegistryAddress("delegateOf", activeDelegateBefore).then(
                        value => normalizeAddress(value) === normalizeAddress(ZERO_ADDRESS),
                      ),
                    );
                  }
                  if (normalizeAddress(pendingDelegateBefore) !== normalizeAddress(ZERO_ADDRESS)) {
                    checks.push(
                      readRegistryAddress("pendingDelegateOf", pendingDelegateBefore).then(
                        value => normalizeAddress(value) === normalizeAddress(ZERO_ADDRESS),
                      ),
                    );
                  }
                  return (await Promise.all(checks)).every(Boolean);
                },
                "delegation-postcondition",
                {
                  pollingIntervalMs: getProfileTransactionPostconditionPollingInterval(targetNetwork.id),
                  shouldStop,
                },
              ),
          });
        } else {
          await executeContractCallBatch(
            [
              {
                abi: registryAbi,
                address: registryAddress,
                args,
                functionName,
              },
            ],
            batchOptions,
          );
        }
      } finally {
        flowToast.endFlow();
        setIsSponsoredDelegationPending(false);
      }
      return;
    }

    await (writeContractAsync as any)({
      functionName,
      ...(args.length > 0 ? { args } : {}),
    });
  };

  const handleSetDelegate = async () => {
    if (!isValidAddress) {
      setDelegationError("Enter a valid address");
      return;
    }
    if (isSelfAddress) {
      setDelegationError("Cannot delegate to yourself");
      return;
    }
    if (walletTransactionReadiness.isBlocked) {
      setDelegationError(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      return;
    }
    setDelegationError(null);

    try {
      await submitDelegationWrite("setDelegate", [normalizedDelegateInput as `0x${string}`], "set delegate");
      notification.success("Delegate set successfully!");
      setDelegateInput("");
      setTransferAddressInput(currentValue =>
        currentValue.trim().length > 0 ? currentValue : normalizedDelegateInput,
      );
      refetch();
    } catch (e: any) {
      console.error("Set delegate failed:", e);
      const msg = e?.shortMessage || e?.message || "Failed to set delegate";
      if (msg.includes("DelegateIsHolder")) {
        setDelegationError("That address already has its own rater credential");
      } else if (msg.includes("DelegateAlreadyAssigned")) {
        setDelegationError("That address is already delegated");
      } else {
        setDelegationError(msg);
      }
    }
  };

  const handleRemoveDelegate = async () => {
    if (walletTransactionReadiness.isBlocked) {
      setDelegationError(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      return;
    }
    setDelegationError(null);
    try {
      await submitDelegationWrite("removeDelegate", [], "remove delegate");
      notification.success("Delegate removed!");
      refetch();
    } catch (e: any) {
      console.error("Remove delegate failed:", e);
      setDelegationError(e?.shortMessage || "Failed to remove delegate");
    }
  };

  const handleTransfer = async () => {
    if (!isValidTransferAddress) {
      setTransferError("Enter a valid address");
      return;
    }
    if (isTransferZeroAddress) {
      setTransferError("Cannot send to the zero address");
      return;
    }
    if (isTransferSelfAddress) {
      setTransferError("Cannot send to yourself");
      return;
    }
    if (!isValidTransferAmount || parsedTransferAmount === null) {
      setTransferError("Enter a valid amount");
      return;
    }
    if (isLrepBalanceLoading) {
      setTransferError("LREP balance is still loading");
      return;
    }
    if (exceedsTransferBalance) {
      setTransferError("Amount exceeds your balance");
      return;
    }
    if (walletTransactionReadiness.isBlocked) {
      setTransferError(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      return;
    }
    if (isMissingGasBalance) {
      setTransferError(`LREP transfers are not sponsored. Add some ${nativeTokenSymbol} for gas, then retry.`);
      return;
    }

    setTransferError(null);

    try {
      const transferArgs = [normalizedTransferAddress as `0x${string}`, parsedTransferAmount] as const;

      if (canUseBatchedLrepTransferCalls && lrepContract) {
        setIsSponsoredTransferPending(true);
        flowToast.beginFlow({
          action: "LREP transfer",
          sponsored: lrepTransferBatchSponsorshipMode === "sponsored",
        });
        const batchOptions = {
          ...flowToast.getSponsoredBatchOptions({
            action: "LREP transfer",
            sponsorshipMode: lrepTransferBatchSponsorshipMode,
          }),
          allowSelfFundedFallback: true,
        };
        try {
          const tokenAddress = lrepContract.address as `0x${string}`;
          const tokenAbi = lrepContract.abi as Abi;
          const recipientBalanceBefore =
            publicClient && isValidTransferAddress
              ? await publicClient
                  .readContract({
                    address: tokenAddress,
                    abi: tokenAbi,
                    functionName: "balanceOf",
                    args: [normalizedTransferAddress],
                  } as never)
                  .then(value => (typeof value === "bigint" ? value : null))
                  .catch(() => null)
              : null;

          if (publicClient && recipientBalanceBefore !== null) {
            await raceTransactionWithPostcondition({
              onPostconditionSuccessThenTransactionError: error => {
                console.warn("[lrep-transfer] postcondition succeeded before thirdweb status settled.", error);
              },
              transaction: () =>
                executeSponsoredCalls(
                  [
                    {
                      abi: tokenAbi,
                      address: tokenAddress,
                      args: transferArgs,
                      functionName: "transfer",
                    },
                  ],
                  batchOptions,
                ),
              waitForPostcondition: shouldStop =>
                waitForTransactionPostcondition(
                  async () => {
                    const balance = await publicClient.readContract({
                      address: tokenAddress,
                      abi: tokenAbi,
                      functionName: "balanceOf",
                      args: [normalizedTransferAddress],
                    } as never);
                    return typeof balance === "bigint" && balance >= recipientBalanceBefore + parsedTransferAmount;
                  },
                  "lrep-transfer-postcondition",
                  {
                    pollingIntervalMs: getProfileTransactionPostconditionPollingInterval(targetNetwork.id),
                    shouldStop,
                  },
                ),
            });
          } else {
            await executeSponsoredCalls(
              [
                {
                  abi: tokenAbi,
                  address: tokenAddress,
                  args: transferArgs,
                  functionName: "transfer",
                },
              ],
              batchOptions,
            );
          }
        } finally {
          flowToast.endFlow();
          setIsSponsoredTransferPending(false);
        }
      } else {
        await writeLrepContractAsync(
          {
            functionName: "transfer",
            args: transferArgs,
          },
          {
            action: "LREP transfer",
            getErrorMessage: error => getLrepTransferErrorMessage(error, nativeTokenSymbol),
          },
        );
      }
      notification.success(`Sent ${formatLrepAmount(parsedTransferAmount, 6)} LREP`);
      setTransferAmountInput("");
      await refreshWalletBalances(address);
    } catch (e: any) {
      console.error("Transfer LREP failed:", e);
      setTransferError(getLrepTransferErrorMessage(e, nativeTokenSymbol));
    }
  };

  const transferSection = (
    <div className={`${hasActiveHumanCredential ? "border-t border-base-300 pt-5 " : ""}space-y-4`}>
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <ArrowsRightLeftIcon className="w-5 h-5" />
        Transfer LREP
        <InfoTooltip text="Send LREP to your delegate or any other address." />
      </h3>

      <div className="space-y-1 text-base text-base-content/60">
        <p aria-live="polite">Balance {formattedBalance} LREP</p>
        {address ? <p className="font-mono text-sm break-all">Connected wallet {address}</p> : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-base font-medium">Recipient</label>
          {hasDelegate && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setTransferAddressInput(delegateTo);
                if (transferError) {
                  setTransferError(null);
                }
              }}
              disabled={isTransferPending}
            >
              Use delegate
            </button>
          )}
        </div>
        <input
          type="text"
          aria-label="Transfer recipient"
          inputMode="text"
          placeholder="0x..."
          className={`input input-bordered w-full bg-base-100 font-mono ${
            normalizedTransferAddress.length > 0 && !isValidTransferAddress ? "input-error" : ""
          }`}
          value={transferAddressInput}
          onChange={e => {
            setTransferAddressInput(e.target.value);
            if (transferError) {
              setTransferError(null);
            }
          }}
          disabled={isTransferPending}
        />
        {normalizedTransferAddress.length > 0 && !isValidTransferAddress && (
          <p className="text-error text-base">Enter a valid address</p>
        )}
        {isValidTransferAddress && isTransferZeroAddress && (
          <p className="text-warning text-base">Cannot send to the zero address</p>
        )}
        {isTransferSelfAddress && <p className="text-warning text-base">Cannot send to yourself</p>}

        <div className="flex items-center justify-between gap-3">
          <label className="text-base font-medium">Amount</label>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setTransferAmountInput(formatUnits(lrepBalanceMicro, LREP_DECIMALS));
              if (transferError) {
                setTransferError(null);
              }
            }}
            disabled={isTransferPending || isLrepBalanceLoading || lrepBalanceMicro === 0n}
          >
            Max
          </button>
        </div>
        <input
          type="text"
          aria-label="Transfer amount"
          inputMode="decimal"
          placeholder="0.0"
          className={`input input-bordered w-full bg-base-100 font-mono ${
            hasTransferAmount && !isValidTransferAmount ? "input-error" : ""
          }`}
          value={transferAmountInput}
          onChange={e => {
            setTransferAmountInput(e.target.value);
            if (transferError) {
              setTransferError(null);
            }
          }}
          disabled={isTransferPending}
        />
        {hasTransferAmount && parsedTransferAmount === null && (
          <p className="text-error text-base">Enter a valid amount</p>
        )}
        {parsedTransferAmount === 0n && <p className="text-warning text-base">Amount must be greater than 0</p>}
        {exceedsTransferBalance && <p className="text-warning text-base">Amount exceeds your balance</p>}

        <GradientActionButton
          onClick={handleTransfer}
          className="w-full"
          motion={getGradientActionMotion(isTransferPending)}
          disabled={isTransferPending || !canSubmitTransfer}
        >
          {isTransferPending ? (
            <span className="flex items-center gap-2">
              <span className="loading loading-spinner loading-sm"></span>
              Sending...
            </span>
          ) : (
            "Send LREP"
          )}
        </GradientActionButton>
      </div>

      {transferError && (
        <div className="surface-card-nested rounded-lg p-4">
          <p className="text-error text-base">{transferError}</p>
        </div>
      )}
    </div>
  );

  if (credentialLoading || (hasActiveHumanCredential && isLoading)) {
    return (
      <div className="surface-card rounded-2xl p-6">
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-md"></span>
          <span className="ml-2 text-base-content/50">Loading delegation...</span>
        </div>
      </div>
    );
  }

  if (!hasActiveHumanCredential) {
    return (
      <div className="surface-card rounded-2xl p-6 space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheckIcon className="w-6 h-6" />
          Rater credential required for delegation
        </h2>
        <Link href={GOVERNANCE_ROUTE} className="btn btn-primary w-full rounded-lg sm:w-auto">
          Open rater setup
        </Link>
        <div className="border-t border-base-300 pt-5">{transferSection}</div>
      </div>
    );
  }

  return (
    <div className="surface-card rounded-2xl p-6 space-y-5">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <ShieldCheckIcon className="w-6 h-6" />
        Delegated Vote ID
        <InfoTooltip text="Authorize a delegate address (hot wallet) to vote on behalf of your rater credential. Your main key stays safely offline." />
      </h2>

      {/* Current delegation status */}
      {hasDelegate && (
        <div className="bg-success/10 border border-success/20 rounded-xl p-4 space-y-3">
          <p className="text-base font-medium text-success">Active delegate</p>
          <p className="text-base font-mono break-all">{delegateTo}</p>
          <button
            onClick={handleRemoveDelegate}
            className="btn btn-outline btn-error btn-sm"
            disabled={isDelegationWritePending}
          >
            {isDelegationWritePending ? (
              <span className="flex items-center gap-2">
                <span className="loading loading-spinner loading-xs"></span>
                Removing...
              </span>
            ) : (
              "Remove Delegate"
            )}
          </button>
        </div>
      )}

      {isDelegate && (
        <div className="bg-info/10 border border-info/20 rounded-xl p-4">
          <p className="text-base font-medium text-info">You are a delegate for</p>
          <p className="text-base font-mono break-all">{delegateOf}</p>
        </div>
      )}

      {/* Set delegate form */}
      {!hasDelegate && (
        <div className="space-y-3">
          <label className="flex items-center gap-1.5 text-base font-medium">
            Delegate Address
            <InfoTooltip text="Enter the address of your secondary wallet. This address will be able to vote using your rater credential." />
          </label>
          <input
            type="text"
            aria-label="Delegate address"
            placeholder="0x..."
            className={`input input-bordered w-full bg-base-100 font-mono ${
              delegateInput.length > 0 && !isValidAddress ? "input-error" : ""
            }`}
            value={delegateInput}
            onChange={e => {
              setDelegateInput(e.target.value);
              if (delegationError) {
                setDelegationError(null);
              }
            }}
            disabled={isDelegationWritePending}
          />
          {delegateInput.length > 0 && !isValidAddress && (
            <p className="text-error text-base">Enter a valid Ethereum address</p>
          )}
          {isSelfAddress && <p className="text-warning text-base">Cannot delegate to yourself</p>}

          <GradientActionButton
            onClick={handleSetDelegate}
            className="w-full"
            motion={getGradientActionMotion(isDelegationWritePending)}
            disabled={isDelegationWritePending || !isValidAddress || isSelfAddress}
          >
            {isDelegationWritePending ? (
              <span className="flex items-center gap-2">
                <span className="loading loading-spinner loading-sm"></span>
                Setting delegate...
              </span>
            ) : (
              "Set Delegate"
            )}
          </GradientActionButton>
        </div>
      )}

      {delegationError && (
        <div className="surface-card-nested rounded-lg p-4">
          <p className="text-error text-base">{delegationError}</p>
        </div>
      )}

      {transferSection}
    </div>
  );
}
