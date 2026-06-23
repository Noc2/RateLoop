"use client";

import { useMemo } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import {
  type WalletTransactionReadinessParams,
  getWalletTransactionReadiness,
} from "~~/lib/walletTransactionReadiness";

type WalletAccountStatus = NonNullable<WalletTransactionReadinessParams["accountStatus"]>;

type WalletTransactionReadinessOptions = {
  accountChainId?: number | null;
  accountStatus?: WalletAccountStatus;
  address?: string | null;
  allowInAppSponsorshipSync?: boolean;
  canSponsorTransactions?: boolean;
  hasExecutableWalletClient?: boolean;
  includeExternalSendCalls?: boolean;
  isAwaitingFreeTransactionAllowance?: boolean;
  isAwaitingSelfFundedWallet?: boolean;
  isAwaitingSponsoredWallet?: boolean;
  isMissingGasBalance?: boolean;
  isRestoringWallet?: boolean;
  nativeTokenSymbol?: string;
  syncInAppSponsorship?: boolean;
  targetChainId?: number | null;
  targetChainName?: string | null;
  unavailableMessage?: string | null;
};

export function walletConnectorCanResolveChainId(connector: { getChainId?: unknown } | undefined) {
  return typeof connector?.getChainId === "function";
}

export function useWalletTransactionReadiness(options: WalletTransactionReadinessOptions = {}) {
  const { address, chain, connector, status: accountStatus } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { isRestoringWallet } = useWalletRestore();
  const { targetNetwork } = useTargetNetwork();
  const gasBalanceStatus = useGasBalanceStatus({
    allowInAppSponsorshipSync: options.allowInAppSponsorshipSync,
    includeExternalSendCalls: options.includeExternalSendCalls ?? true,
    syncInAppSponsorship: options.syncInAppSponsorship,
  });

  return useMemo(
    () =>
      getWalletTransactionReadiness({
        accountChainId: options.accountChainId ?? chain?.id,
        accountStatus: options.accountStatus ?? accountStatus,
        address: options.address ?? address,
        canSponsorTransactions: options.canSponsorTransactions ?? gasBalanceStatus.canSponsorTransactions,
        hasExecutableWalletClient:
          options.hasExecutableWalletClient ?? (Boolean(walletClient) || walletConnectorCanResolveChainId(connector)),
        isAwaitingFreeTransactionAllowance:
          options.isAwaitingFreeTransactionAllowance ?? gasBalanceStatus.isAwaitingFreeTransactionAllowance,
        isAwaitingSelfFundedWallet:
          options.isAwaitingSelfFundedWallet ?? gasBalanceStatus.isAwaitingSelfFundedWalletReconnect,
        isAwaitingSponsoredWallet:
          options.isAwaitingSponsoredWallet ?? gasBalanceStatus.isAwaitingSponsoredWalletReconnect,
        isMissingGasBalance: options.isMissingGasBalance ?? gasBalanceStatus.isMissingGasBalance,
        isRestoringWallet: options.isRestoringWallet ?? isRestoringWallet,
        nativeTokenSymbol: options.nativeTokenSymbol ?? gasBalanceStatus.nativeTokenSymbol,
        targetChainId: options.targetChainId ?? targetNetwork.id,
        targetChainName: options.targetChainName ?? targetNetwork.name,
        unavailableMessage: options.unavailableMessage,
      }),
    [
      accountStatus,
      address,
      chain?.id,
      connector,
      gasBalanceStatus.canSponsorTransactions,
      gasBalanceStatus.isAwaitingFreeTransactionAllowance,
      gasBalanceStatus.isAwaitingSelfFundedWalletReconnect,
      gasBalanceStatus.isAwaitingSponsoredWalletReconnect,
      gasBalanceStatus.isMissingGasBalance,
      gasBalanceStatus.nativeTokenSymbol,
      isRestoringWallet,
      options.accountChainId,
      options.accountStatus,
      options.address,
      options.canSponsorTransactions,
      options.hasExecutableWalletClient,
      options.isAwaitingFreeTransactionAllowance,
      options.isAwaitingSelfFundedWallet,
      options.isAwaitingSponsoredWallet,
      options.isMissingGasBalance,
      options.isRestoringWallet,
      options.nativeTokenSymbol,
      options.targetChainId,
      options.targetChainName,
      options.unavailableMessage,
      targetNetwork.id,
      targetNetwork.name,
      walletClient,
    ],
  );
}
