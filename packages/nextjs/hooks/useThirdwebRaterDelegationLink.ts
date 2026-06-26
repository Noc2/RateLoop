"use client";

import { useCallback, useMemo, useState } from "react";
import { useActiveWallet } from "thirdweb/react";
import { type Account } from "thirdweb/wallets";
import type { Abi, Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useDeployedContractInfo, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionFlowToast } from "~~/hooks/useTransactionFlowToast";
import { getThirdwebRaterDelegationCandidate } from "~~/lib/thirdweb/raterDelegation";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import { buildRaterDelegateAuthorizationTypedData, getDefaultSignatureDeadline } from "~~/lib/walletSignatures";
import scaffoldConfig from "~~/scaffold.config";

type TypedDataSigner = Pick<Account, "address" | "signTypedData">;

function getRaterDelegationPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

function normalizeAddress(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

export function useThirdwebRaterDelegationLink({ enabled = true }: { enabled?: boolean } = {}) {
  const { address, chain } = useAccount();
  const activeWallet = useActiveWallet();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: raterRegistryContract } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });
  const { writeContractAsync, isMining: isWriteMining } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const { canUseSelfFundedBatchCalls, canUseSponsoredSubmitCalls, executeSponsoredCalls } =
    useThirdwebSponsoredSubmitCalls();
  const flowToast = useTransactionFlowToast();
  const canUseBatchedDelegationLinkCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const delegationLinkBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeWalletAccountAddress = activeWallet?.getAccount()?.address;
  const activeWalletAdminAccount = activeWallet?.getAdminAccount?.() as TypedDataSigner | undefined;
  const activeWalletAdminAddress = activeWalletAdminAccount?.address;
  const candidate = useMemo(
    () =>
      enabled
        ? getThirdwebRaterDelegationCandidate({
            activeWalletId: activeWallet?.id,
            adminAddress: activeWalletAdminAddress,
            connectedAddress: address,
            thirdwebAccountAddress: activeWalletAccountAddress,
          })
        : null,
    [activeWallet?.id, activeWalletAccountAddress, activeWalletAdminAddress, address, enabled],
  );
  const connectedIdentity = useRaterRegistryIdentity(enabled ? address : undefined);
  const holderIdentity = useRaterRegistryIdentity(candidate?.holderAddress);

  const canLink = Boolean(
    enabled &&
      candidate &&
      raterRegistryContract?.address &&
      publicClient &&
      chain?.id === targetNetwork.id &&
      !connectedIdentity.hasActiveHumanCredential &&
      holderIdentity.hasActiveHumanCredential &&
      holderIdentity.identityKey,
  );

  const isChecking =
    Boolean(candidate) &&
    (connectedIdentity.isLoading ||
      holderIdentity.isLoading ||
      !connectedIdentity.isResolved ||
      !holderIdentity.isResolved);

  const link = useCallback(async () => {
    if (!candidate || !raterRegistryContract?.address || !publicClient) {
      throw new Error("Rater identity linking is unavailable right now.");
    }

    if (chain?.id !== targetNetwork.id) {
      throw new Error(`Wallet is connected to the wrong network. Please switch to ${targetNetwork.name}.`);
    }

    if (typeof activeWalletAdminAccount?.signTypedData !== "function") {
      throw new Error("This thirdweb login cannot sign the identity-link authorization.");
    }

    setIsLinking(true);
    setError(null);
    try {
      const registryAddress = raterRegistryContract.address as `0x${string}`;
      const abi = raterRegistryContract.abi as Abi;
      const nonce = (await publicClient.readContract({
        address: registryAddress,
        abi,
        functionName: "delegateAuthorizationNonces",
        args: [candidate.holderAddress],
      })) as bigint;
      const deadline = getDefaultSignatureDeadline();
      const signature = (await activeWalletAdminAccount.signTypedData(
        buildRaterDelegateAuthorizationTypedData({
          chainId: targetNetwork.id,
          deadline,
          delegate: candidate.delegateAddress,
          holder: candidate.holderAddress,
          nonce,
          registryAddress,
        }) as never,
      )) as Hex;
      const args = [candidate.holderAddress, deadline, signature] as const;

      if (canUseBatchedDelegationLinkCalls) {
        flowToast.beginFlow({
          action: "rater identity link",
          sponsored: delegationLinkBatchSponsorshipMode === "sponsored",
        });
        const batchOptions = flowToast.getSponsoredBatchOptions({
          action: "rater identity link",
          sponsorshipMode: delegationLinkBatchSponsorshipMode,
        });
        try {
          const activeDelegateBefore = await publicClient
            .readContract({
              address: registryAddress,
              abi,
              functionName: "delegateTo",
              args: [candidate.holderAddress],
            } as never)
            .then(value => (typeof value === "string" ? value : null))
            .catch(() => null);
          const canWaitForPostcondition =
            activeDelegateBefore === null ||
            normalizeAddress(activeDelegateBefore) !== normalizeAddress(candidate.delegateAddress);

          if (canWaitForPostcondition) {
            await raceTransactionWithPostcondition({
              onPostconditionSuccessThenTransactionError: error => {
                console.warn("[rater-delegation-link] postcondition succeeded before thirdweb status settled.", error);
              },
              transaction: () =>
                executeSponsoredCalls(
                  [
                    {
                      abi,
                      address: registryAddress,
                      args,
                      functionName: "acceptDelegateWithSig",
                    },
                  ],
                  batchOptions,
                ),
              waitForPostcondition: shouldStop =>
                waitForTransactionPostcondition(
                  async () => {
                    const [delegateTo, delegateOf] = await Promise.all([
                      publicClient.readContract({
                        address: registryAddress,
                        abi,
                        functionName: "delegateTo",
                        args: [candidate.holderAddress],
                      } as never),
                      publicClient.readContract({
                        address: registryAddress,
                        abi,
                        functionName: "delegateOf",
                        args: [candidate.delegateAddress],
                      } as never),
                    ]);
                    return (
                      normalizeAddress(String(delegateTo)) === normalizeAddress(candidate.delegateAddress) &&
                      normalizeAddress(String(delegateOf)) === normalizeAddress(candidate.holderAddress)
                    );
                  },
                  "rater-delegation-link-postcondition",
                  {
                    pollingIntervalMs: getRaterDelegationPostconditionPollingInterval(targetNetwork.id),
                    shouldStop,
                  },
                ),
            });
          } else {
            await executeSponsoredCalls(
              [
                {
                  abi,
                  address: registryAddress,
                  args,
                  functionName: "acceptDelegateWithSig",
                },
              ],
              batchOptions,
            );
          }
        } finally {
          flowToast.endFlow();
        }
      } else {
        await (writeContractAsync as any)(
          {
            args,
            functionName: "acceptDelegateWithSig",
          },
          {
            action: "rater identity link",
          },
        );
      }

      await Promise.all([connectedIdentity.refetch(), holderIdentity.refetch()]);
    } catch (linkError) {
      const message = linkError instanceof Error ? linkError.message : "Could not link this wallet identity.";
      setError(message);
      throw linkError;
    } finally {
      setIsLinking(false);
    }
  }, [
    activeWalletAdminAccount,
    canUseBatchedDelegationLinkCalls,
    candidate,
    delegationLinkBatchSponsorshipMode,
    chain?.id,
    connectedIdentity,
    executeSponsoredCalls,
    flowToast,
    holderIdentity,
    publicClient,
    raterRegistryContract,
    targetNetwork.id,
    targetNetwork.name,
    writeContractAsync,
  ]);

  return {
    adminAddress: candidate?.holderAddress ?? null,
    canLink,
    connectedAddress: candidate?.delegateAddress ?? null,
    error,
    isChecking,
    isLinking: isLinking || isWriteMining,
    link,
  };
}
